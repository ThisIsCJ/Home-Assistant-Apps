import asyncio
import csv
import io
import json
import re
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime, timedelta
from bson import ObjectId
from auth.middleware import require_auth
from database import get_app_db, get_user_db
from lib.audit import log_action
from lib.serializer import doc_to_dict
from lib.ai_client import call_ai
from lib.encryption import decrypt

router = APIRouter()


async def _find_duplicate(db, user_id: str, metric_type_id: str, taken_at: datetime):
    """Return an existing reading with the same user/metric within 1 second of taken_at, or None."""
    ts = taken_at.replace(microsecond=0)
    return await db.health_readings.find_one({
        "userId": user_id,
        "metricTypeId": metric_type_id,
        "takenAt": {"$gte": ts, "$lt": ts + timedelta(seconds=1)},
        "deletedAt": None,
    })


_DATE_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y.%m.%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
    "%Y.%m.%d",
    "%Y/%m/%d",
    "%d/%m/%Y %H:%M:%S",
    "%d-%m-%Y %H:%M:%S",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%m/%d/%Y",
]


def _parse_date(raw: str, preferred_format: str) -> datetime:
    for fmt in [preferred_format] + [f for f in _DATE_FORMATS if f != preferred_format]:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date '{raw}'")


# ── Pydantic models ───────────────────────────────────────────────────────────

class MetricTypeCreate(BaseModel):
    key: str
    displayName: str
    unit: str
    valueType: str = "number"           # number | string | boolean
    category: str = "custom"            # body | vitals | lab | sleep | activity | mood | custom
    normalRangeMin: Optional[float] = None
    normalRangeMax: Optional[float] = None
    color: Optional[str] = None
    description: Optional[str] = None


class MetricTypeUpdate(BaseModel):
    displayName: Optional[str] = None
    unit: Optional[str] = None
    normalRangeMin: Optional[float] = None
    normalRangeMax: Optional[float] = None
    color: Optional[str] = None
    description: Optional[str] = None


class ReadingCreate(BaseModel):
    metricTypeId: str
    value: Any                          # float for numbers, string for others
    unit: Optional[str] = None          # override unit if needed
    takenAt: Optional[datetime] = None
    notes: Optional[str] = None
    device: Optional[str] = None


class ReadingUpdate(BaseModel):
    value: Optional[Any] = None
    unit: Optional[str] = None
    takenAt: Optional[datetime] = None
    notes: Optional[str] = None


class ImportColumnMapping(BaseModel):
    column: str
    metricTypeId: str
    unit: Optional[str] = None


class ImportPreviewRequest(BaseModel):
    csvText: str


class ImportAISuggestRequest(BaseModel):
    csvText: str
    columns: list[str]
    preview: list[dict]


class ImportCommitRequest(BaseModel):
    csvText: str
    dateColumn: str
    dateFormat: str = "%Y-%m-%d"
    mappings: list[ImportColumnMapping]


# ── Metric types ──────────────────────────────────────────────────────────────

@router.get("/metric-types")
async def list_metric_types(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    app_db = get_app_db()
    user_db = get_user_db(user_id)

    # Fetch both global (app_db) and user-specific (user_db) metric types
    app_types, user_types = await asyncio.gather(
        app_db.health_metric_types.find({"deletedAt": None}).sort("displayName", 1).to_list(200),
        user_db.health_metric_types.find({"deletedAt": None}).sort("displayName", 1).to_list(200),
    )

    # Merge: user types first (they take precedence), then global
    seen = set()
    types = []
    for t in (user_types + app_types):
        sid = str(t["_id"])
        if sid not in seen:
            seen.add(sid)
            types.append(t)

    types.sort(key=lambda t: t.get("displayName", ""))
    return [doc_to_dict(t) for t in types]


@router.post("/metric-types", status_code=201)
async def create_metric_type(body: MetricTypeCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    exists = await user_db.health_metric_types.find_one({
        "key": body.key, "deletedAt": None
    })
    if exists:
        raise HTTPException(status_code=409, detail="A metric with this key already exists")

    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "scope": "user",
        **body.model_dump(),
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
    }
    result = await user_db.health_metric_types.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "metric_type.created", "health_metric_type",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/metric-types/{type_id}")
async def update_metric_type(type_id: str, body: MetricTypeUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    # User can only update their own metric types (user_db)
    existing = await user_db.health_metric_types.find_one(
        {"_id": ObjectId(type_id), "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Metric type not found or not editable")

    update = {"updatedAt": datetime.utcnow()}
    for k, v in body.model_dump(exclude_none=True).items():
        update[k] = v

    result = await user_db.health_metric_types.find_one_and_update(
        {"_id": ObjectId(type_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "metric_type.updated", "health_metric_type", type_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/metric-types/{type_id}", status_code=204)
async def delete_metric_type(type_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    result = await user_db.health_metric_types.find_one_and_update(
        {"_id": ObjectId(type_id), "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Metric type not found or not deletable")
    await log_action(user_id, "metric_type.deleted", "health_metric_type", type_id)


async def _find_metric_type(user_id: str, type_id: str) -> dict | None:
    """Look up a metric type in user_db first, then app_db."""
    user_db = get_user_db(user_id)
    doc = await user_db.health_metric_types.find_one(
        {"_id": ObjectId(type_id), "deletedAt": None}
    )
    if not doc:
        doc = await get_app_db().health_metric_types.find_one(
            {"_id": ObjectId(type_id), "deletedAt": None}
        )
    return doc


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard(user: dict = Depends(require_auth)):
    """For each metric type the user has readings for, return latest + previous reading."""
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    app_db = get_app_db()

    # Get all metric types accessible to this user (both dbs)
    app_types_list, user_types_list = await asyncio.gather(
        app_db.health_metric_types.find({"deletedAt": None}).to_list(200),
        user_db.health_metric_types.find({"deletedAt": None}).to_list(200),
    )
    all_types = {}
    for t in (app_types_list + user_types_list):
        all_types[str(t["_id"])] = t

    # Find metric types this user has readings for
    pipeline = [
        {"$match": {"userId": user_id, "deletedAt": None}},
        {"$sort": {"takenAt": -1}},
        {"$group": {
            "_id": "$metricTypeId",
            "latestReading": {"$first": "$$ROOT"},
            "readingCount": {"$sum": 1},
        }},
    ]
    results = await user_db.health_readings.aggregate(pipeline).to_list(100)

    cards = []
    for r in results:
        type_id = r["_id"]
        metric_type = all_types.get(type_id)
        if not metric_type:
            continue

        latest = r["latestReading"]

        # Get the second-most-recent reading for trend
        previous = await user_db.health_readings.find_one(
            {"userId": user_id, "metricTypeId": type_id, "deletedAt": None,
             "_id": {"$ne": latest["_id"]}},
            sort=[("takenAt", -1)],
        )

        # Compute trend
        trend = "flat"
        change = None
        if previous and isinstance(latest.get("value"), (int, float)) and isinstance(previous.get("value"), (int, float)):
            diff = latest["value"] - previous["value"]
            change = round(diff, 2)
            trend = "up" if diff > 0 else "down" if diff < 0 else "flat"

        cards.append({
            "type": doc_to_dict(metric_type),
            "latestReading": doc_to_dict(latest),
            "previousReading": doc_to_dict(previous),
            "readingCount": r["readingCount"],
            "trend": trend,
            "change": change,
        })

    # Sort: vitals first, then alphabetical
    category_order = {"vitals": 0, "body": 1, "lab": 2, "activity": 3, "sleep": 4, "mood": 5, "custom": 6}
    cards.sort(key=lambda c: (category_order.get(c["type"].get("category", "custom"), 9), c["type"].get("displayName", "")))
    return {"cards": cards}


# ── Trend ─────────────────────────────────────────────────────────────────────

@router.get("/trend")
async def get_trend(
    metric_type_id: str = Query(...),
    days: int = Query(30, ge=7, le=365),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    metric_type = await _find_metric_type(user_id, metric_type_id)
    if not metric_type:
        raise HTTPException(status_code=404, detail="Metric type not found")

    since = datetime.utcnow() - timedelta(days=days)
    cursor = user_db.health_readings.find({
        "userId": user_id,
        "metricTypeId": metric_type_id,
        "takenAt": {"$gte": since},
        "deletedAt": None,
    }).sort("takenAt", 1)
    readings = await cursor.to_list(1000)

    return {
        "metricType": doc_to_dict(metric_type),
        "readings": [doc_to_dict(r) for r in readings],
        "days": days,
    }


# ── Readings CRUD ─────────────────────────────────────────────────────────────

@router.get("/readings")
async def list_readings(
    metric_type_id: Optional[str] = Query(None),
    metric_keys: Optional[str] = Query(None),   # comma-separated metricKey values
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(100, le=5000),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}

    if metric_type_id:
        query["metricTypeId"] = metric_type_id
    if metric_keys:
        keys = [k.strip() for k in metric_keys.split(',') if k.strip()]
        if len(keys) == 1:
            query["metricKey"] = keys[0]
        elif keys:
            query["metricKey"] = {"$in": keys}
    if date_from or date_to:
        query["takenAt"] = {}
        if date_from:
            query["takenAt"]["$gte"] = datetime.fromisoformat(date_from)
        if date_to:
            query["takenAt"]["$lte"] = datetime.fromisoformat(date_to)

    cursor = db.health_readings.find(query).sort("takenAt", -1).limit(limit)
    readings = await cursor.to_list(length=limit)
    return [doc_to_dict(r) for r in readings]


@router.post("/readings", status_code=201)
async def create_reading(body: ReadingCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    metric_type = await _find_metric_type(user_id, body.metricTypeId)
    if not metric_type:
        raise HTTPException(status_code=404, detail="Metric type not found")

    now = datetime.utcnow()
    taken_at = body.takenAt or now

    existing = await _find_duplicate(user_db, user_id, body.metricTypeId, taken_at)
    if existing:
        return doc_to_dict(existing)

    doc = {
        "userId": user_id,
        "metricTypeId": body.metricTypeId,
        "metricKey": metric_type["key"],
        "metricName": metric_type["displayName"],
        "value": body.value,
        "unit": body.unit or metric_type.get("unit", ""),
        "takenAt": taken_at,
        "notes": body.notes,
        "device": body.device or "manual",
        "source": "manual",
        "deletedAt": None,
        "createdAt": now,
        "createdBy": user_id,
    }
    result = await user_db.health_readings.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "health_reading.created", "health_reading",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/readings/{reading_id}")
async def update_reading(reading_id: str, body: ReadingUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.health_readings.find_one(
        {"_id": ObjectId(reading_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Reading not found")

    update = {"updatedAt": datetime.utcnow()}
    for k, v in body.model_dump(exclude_none=True).items():
        update[k] = v

    result = await db.health_readings.find_one_and_update(
        {"_id": ObjectId(reading_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "health_reading.updated", "health_reading", reading_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/readings/by-type/{metric_key}")
async def clear_readings_by_type(metric_key: str, user: dict = Depends(require_auth)):
    """Soft-delete all health readings for a specific metric key."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.health_readings.update_many(
        {"userId": user_id, "metricKey": metric_key, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    await log_action(user_id, "health_readings.cleared_by_type", "health_reading",
                     None, after={"metricKey": metric_key, "count": result.modified_count})
    return {"deleted": result.modified_count, "metricKey": metric_key}


@router.delete("/readings/{reading_id}", status_code=204)
async def delete_reading(reading_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.health_readings.find_one_and_update(
        {"_id": ObjectId(reading_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Reading not found")
    await log_action(user_id, "health_reading.deleted", "health_reading", reading_id)


# ── CSV import ────────────────────────────────────────────────────────────────

@router.post("/import/preview")
async def preview_csv(body: ImportPreviewRequest, user: dict = Depends(require_auth)):
    """Parse CSV text and return column names + first 10 rows."""
    try:
        reader = csv.DictReader(io.StringIO(body.csvText))
        columns = reader.fieldnames or []
        rows = []
        for i, row in enumerate(reader):
            if i >= 10:
                break
            rows.append(dict(row))
        total_rows = body.csvText.count('\n')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {e}")

    return {"columns": list(columns), "preview": rows, "estimatedRows": total_rows}


@router.post("/import/ai-suggest")
async def ai_suggest_mappings(body: ImportAISuggestRequest, user: dict = Depends(require_auth)):
    """Use AI to suggest date column, date format, and column→metric mappings."""
    user_id = str(user["_id"])
    app_db = get_app_db()
    user_db = get_user_db(user_id)

    # Resolve AI provider from user_db
    user_doc = await app_db.users.find_one({"_id": user["_id"]})
    default_id = user_doc.get("preferences", {}).get("defaultAiProviderId") if user_doc else None
    provider = await user_db.ai_providers.find_one(
        {"_id": ObjectId(default_id), "userId": user_id, "enabled": True, "deletedAt": None}
    ) if default_id else None
    if not provider:
        provider = await user_db.ai_providers.find_one(
            {"userId": user_id, "enabled": True, "deletedAt": None},
            sort=[("createdAt", 1)],
        )
    if not provider:
        raise HTTPException(400, "No AI provider configured. Add one in Settings → AI Providers.")

    # Fetch metric types from both dbs
    app_types, user_types = await asyncio.gather(
        app_db.health_metric_types.find({"deletedAt": None}).to_list(200),
        user_db.health_metric_types.find({"deletedAt": None}).to_list(200),
    )
    metric_types = user_types + [t for t in app_types if str(t["_id"]) not in {str(u["_id"]) for u in user_types}]

    metric_list = "\n".join(
        f'- id="{str(mt["_id"])}" name="{mt["displayName"]}" unit="{mt.get("unit","")}" key="{mt["key"]}"'
        for mt in metric_types
    )

    sample_rows = "\n".join(
        ",".join(str(row.get(c, "")) for c in body.columns)
        for row in body.preview[:5]
    )

    prompt = f"""You are a health data import assistant. Analyse this CSV data and return mapping suggestions as JSON.

CSV columns: {json.dumps(body.columns)}

Sample rows (header + up to 5 data rows):
{",".join(body.columns)}
{sample_rows}

Available metric types:
{metric_list}

Return ONLY valid JSON in this exact structure — no markdown, no explanation:
{{
  "dateColumn": "<column name that contains dates>",
  "dateFormat": "<Python strptime format string, e.g. %Y-%m-%d or %Y.%m.%d %H:%M:%S>",
  "mappings": [
    {{"column": "<csv column name>", "metricTypeId": "<metric type id>", "confidence": 0.9}}
  ]
}}

Rules:
- dateColumn must be one of the column names exactly as given
- dateFormat must be a valid Python strptime string matching the sample date values
- Only include columns that clearly map to a metric type with confidence >= 0.5
- Do not map the date column in mappings
- metricTypeId must be an id from the available metric types list above"""

    try:
        provider_doc = {**provider, "apiKey": decrypt(provider["encryptedApiKey"])}
        raw = await call_ai(
            provider_doc,
            [{"role": "user", "content": prompt}],
            provider.get("model"),
            800,
        )
        # Strip markdown fences if present
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
        result = json.loads(clean)
    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(502, "AI returned invalid JSON. Try again.")
    except Exception as e:
        raise HTTPException(502, f"AI request failed: {e}")

    return result


@router.post("/import/commit")
async def commit_csv_import(body: ImportCommitRequest, user: dict = Depends(require_auth)):
    """Validate column mappings and insert readings from CSV."""
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    # Verify all metric types exist (check user_db first, then app_db)
    type_map = {}
    for mapping in body.mappings:
        mt = await _find_metric_type(user_id, mapping.metricTypeId)
        if not mt:
            raise HTTPException(status_code=404, detail=f"Metric type {mapping.metricTypeId} not found")
        type_map[mapping.metricTypeId] = mt

    try:
        reader = csv.DictReader(io.StringIO(body.csvText))
        rows = list(reader)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {e}")

    docs = []
    errors = []
    duplicates = 0
    now = datetime.utcnow()

    for row_idx, row in enumerate(rows):
        raw_date = row.get(body.dateColumn, "").strip()
        if not raw_date:
            errors.append({"row": row_idx + 2, "error": "Missing date value"})
            continue
        try:
            taken_at = _parse_date(raw_date, body.dateFormat)
        except ValueError as e:
            errors.append({"row": row_idx + 2, "error": str(e)})
            continue

        for mapping in body.mappings:
            raw_val = row.get(mapping.column, "").strip()
            if not raw_val:
                continue
            try:
                value = float(raw_val)
            except ValueError:
                errors.append({"row": row_idx + 2, "error": f"Cannot parse value '{raw_val}' in column '{mapping.column}'"})
                continue

            if await _find_duplicate(user_db, user_id, mapping.metricTypeId, taken_at):
                duplicates += 1
                continue

            mt = type_map[mapping.metricTypeId]
            docs.append({
                "userId": user_id,
                "metricTypeId": mapping.metricTypeId,
                "metricKey": mt["key"],
                "metricName": mt["displayName"],
                "value": value,
                "unit": mapping.unit or mt.get("unit", ""),
                "takenAt": taken_at,
                "notes": None,
                "device": "csv_import",
                "source": "import",
                "deletedAt": None,
                "createdAt": now,
                "createdBy": user_id,
            })

    if docs:
        await user_db.health_readings.insert_many(docs)
        await log_action(user_id, "health_readings.imported", "health_reading",
                         None, after={"count": len(docs)})

    return {
        "imported": len(docs),
        "duplicates": duplicates,
        "errors": errors[:20],
        "skipped": len(errors),
    }


# ── Health Connect batch sync ─────────────────────────────────────────────────

class SyncReadingItem(BaseModel):
    metricKey: str
    value: float
    unit: Optional[str] = None
    takenAt: datetime
    notes: Optional[str] = None
    device: Optional[str] = "health_connect"


class SyncBatchRequest(BaseModel):
    readings: list[SyncReadingItem]
    source: str = "health_connect"


@router.post("/sync")
async def sync_readings(body: SyncBatchRequest, user: dict = Depends(require_auth)):
    """Batch ingest readings by metricKey. Used by mobile companion apps."""
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    app_db = get_app_db()

    # Build key → metric type doc map (user types override global ones)
    app_types, user_types = await asyncio.gather(
        app_db.health_metric_types.find({"deletedAt": None}).to_list(200),
        user_db.health_metric_types.find({"deletedAt": None}).to_list(200),
    )
    key_map: dict[str, dict] = {}
    for t in (app_types + user_types):
        key_map[t["key"]] = t

    now = datetime.utcnow()
    errors = []
    inserted = 0
    updated = 0
    noop = 0

    for r in body.readings:
        mt = key_map.get(r.metricKey)
        if not mt:
            errors.append({"metricKey": r.metricKey, "error": "Unknown metric key"})
            continue

        # Strip timezone so storage is consistent with the rest of the app
        taken_at = r.takenAt.replace(tzinfo=None) if r.takenAt.tzinfo else r.takenAt
        type_id = str(mt["_id"])

        fields = {
            "userId": user_id,
            "metricTypeId": type_id,
            "metricKey": mt["key"],
            "metricName": mt["displayName"],
            "value": r.value,
            "unit": r.unit or mt.get("unit", ""),
            "takenAt": taken_at,
            "notes": r.notes,
            "device": r.device or body.source,
            "source": body.source,
            "deletedAt": None,
            "createdBy": user_id,
        }
        existing = await user_db.health_readings.find_one({
            "userId": user_id,
            "metricKey": mt["key"],
            "takenAt": taken_at,
        })
        if existing:
            changed = existing.get("deletedAt") is not None or any(existing.get(k) != v for k, v in fields.items())
            if changed:
                await user_db.health_readings.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {**fields, "updatedAt": now}},
                )
                updated += 1
            else:
                noop += 1
            continue

        await user_db.health_readings.insert_one({
            **fields,
            "createdAt": now,
        })
        inserted += 1

    changed_count = inserted + updated
    if changed_count:
        await log_action(user_id, "health_readings.synced", "health_reading",
                         None, after={"inserted": inserted, "updated": updated, "source": body.source})

    return {
        "imported": changed_count,
        "duplicates": noop,
        "inserted": inserted,
        "updated": updated,
        "noop": noop,
        "errors": errors,
    }
