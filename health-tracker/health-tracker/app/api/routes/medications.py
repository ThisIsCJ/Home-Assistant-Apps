from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timezone
from bson import ObjectId
from auth.middleware import require_auth
from database import get_user_db
from lib.audit import log_action
from lib.serializer import doc_to_dict

router = APIRouter()

DISCLAIMER = (
    "This information is for personal tracking only and is NOT medical advice. "
    "Always consult a qualified clinician or pharmacist before making any changes "
    "to your medications."
)


# ── Pydantic models ───────────────────────────────────────────────────────────

class IngredientItem(BaseModel):
    name: str
    amount: Optional[str] = None
    unit: Optional[str] = None


class MedicationCreate(BaseModel):
    name: str
    genericName: Optional[str] = None
    dose: Optional[str] = None
    form: Optional[str] = "tablet"          # tablet|capsule|liquid|injection|patch|other
    route: Optional[str] = "oral"           # oral|topical|injection|inhaled|other
    frequency: Optional[str] = None         # e.g. "Once daily", "Twice daily"
    startDate: Optional[str] = None         # YYYY-MM-DD
    endDate: Optional[str] = None
    active: bool = True
    medType: Optional[str] = None           # prescribed|otc|supplement
    prescriber: Optional[str] = None
    pharmacy: Optional[str] = None
    reason: Optional[str] = None
    sideEffects: Optional[str] = None
    refillInfo: Optional[str] = None
    notes: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = []
    customFields: Optional[dict] = {}
    quickAction: bool = False


class MedicationUpdate(BaseModel):
    name: Optional[str] = None
    genericName: Optional[str] = None
    dose: Optional[str] = None
    form: Optional[str] = None
    route: Optional[str] = None
    frequency: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    active: Optional[bool] = None
    medType: Optional[str] = None
    prescriber: Optional[str] = None
    pharmacy: Optional[str] = None
    reason: Optional[str] = None
    sideEffects: Optional[str] = None
    refillInfo: Optional[str] = None
    notes: Optional[str] = None
    ingredients: Optional[list[IngredientItem]] = None
    customFields: Optional[dict] = None
    quickAction: Optional[bool] = None


class BundleItem(BaseModel):
    medicationId: str
    doseOverride: Optional[str] = None
    instructions: Optional[str] = None


class BundleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    items: list[BundleItem] = []
    quickAction: bool = False


class BundleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    items: Optional[list[BundleItem]] = None
    quickAction: Optional[bool] = None


class MedLogCreate(BaseModel):
    medicationId: str
    status: str = "taken"               # taken|skipped|snoozed
    takenAt: Optional[datetime] = None
    scheduledFor: Optional[str] = None  # YYYY-MM-DD
    notes: Optional[str] = None


class MedLogUpdate(BaseModel):
    status: Optional[str] = None
    takenAt: Optional[datetime] = None
    scheduledFor: Optional[str] = None
    notes: Optional[str] = None


# ── Medications CRUD ──────────────────────────────────────────────────────────

@router.get("")
async def list_medications(
    active_only: bool = Query(False),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}
    if active_only:
        query["active"] = True
    cursor = db.medications.find(query).sort("name", 1)
    meds = await cursor.to_list(length=500)
    return [doc_to_dict(m) for m in meds]


@router.post("", status_code=201)
async def create_medication(body: MedicationCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        **body.model_dump(),
        "source": "manual",
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
        "updatedBy": user_id,
    }
    result = await db.medications.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "medication.created", "medication", str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.get("/today")
async def get_today_status(
    date_str: Optional[str] = Query(None, alias="date"),
    user: dict = Depends(require_auth),
):
    """Return all active medications with their log status for the given date."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    target = date_str or datetime.utcnow().strftime("%Y-%m-%d")

    meds = await db.medications.find({"userId": user_id, "active": True, "deletedAt": None}).to_list(500)
    logs = await db.medication_logs.find({
        "userId": user_id,
        "scheduledFor": target,
        "deletedAt": None,
    }).to_list(500)

    log_by_med = {}
    for lg in logs:
        log_by_med.setdefault(lg["medicationId"], []).append(doc_to_dict(lg))

    return {
        "date": target,
        "items": [
            {
                "medication": doc_to_dict(m),
                "logs": log_by_med.get(str(m["_id"]), []),
                "status": (
                    "taken" if any(lg["status"] == "taken" for lg in log_by_med.get(str(m["_id"]), []))
                    else "skipped" if log_by_med.get(str(m["_id"]))
                    else "pending"
                ),
            }
            for m in meds
        ],
    }


@router.get("/interactions")
async def check_interactions(user: dict = Depends(require_auth)):
    """Return a structured interaction note for the user's active medications."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    meds = await db.medications.find({"userId": user_id, "active": True, "deletedAt": None}).to_list(500)
    med_names = [m["name"] + (f" {m['dose']}" if m.get("dose") else "") for m in meds]

    # Phase 1: return placeholder — AI integration (Gemini) is wired in Phase 2
    return {
        "checkedAt": datetime.utcnow().isoformat() + "Z",
        "medications": med_names,
        "summary": (
            "Interaction checking via AI is coming in the next release. "
            "This list shows your current active medications for review."
        ),
        "possibleInteractions": [],
        "questionsForClinician": [
            "Are any of my current medications known to interact with each other?",
            "Do any of my medications require special timing relative to meals or other medications?",
            "Are there any duplications or redundancies in my current regimen?",
        ],
        "disclaimer": DISCLAIMER,
        "source": "placeholder",
    }


def _validate_object_id(id_str: str) -> None:
    try:
        ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID format")


@router.get("/{med_id}")
async def get_medication(med_id: str, user: dict = Depends(require_auth)):
    _validate_object_id(med_id)
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    doc = await db.medications.find_one({"_id": ObjectId(med_id), "userId": user_id, "deletedAt": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Medication not found")
    return doc_to_dict(doc)


@router.put("/{med_id}")
async def update_medication(med_id: str, body: MedicationUpdate, user: dict = Depends(require_auth)):
    _validate_object_id(med_id)
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.medications.find_one({"_id": ObjectId(med_id), "userId": user_id, "deletedAt": None})
    if not existing:
        raise HTTPException(status_code=404, detail="Medication not found")

    update = {"updatedAt": datetime.utcnow(), "updatedBy": user_id}
    for k, v in body.model_dump(exclude_none=True).items():
        update[k] = v

    result = await db.medications.find_one_and_update(
        {"_id": ObjectId(med_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "medication.updated", "medication", med_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/{med_id}", status_code=204)
async def delete_medication(med_id: str, user: dict = Depends(require_auth)):
    _validate_object_id(med_id)
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.medications.find_one_and_update(
        {"_id": ObjectId(med_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow(), "active": False}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Medication not found")
    await log_action(user_id, "medication.deleted", "medication", med_id)


# ── Bundles ───────────────────────────────────────────────────────────────────

@router.get("/bundles/list")
async def list_bundles(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    cursor = db.medication_bundles.find({"userId": user_id, "deletedAt": None}).sort("name", 1)
    bundles = await cursor.to_list(200)
    return [doc_to_dict(b) for b in bundles]


@router.post("/bundles", status_code=201)
async def create_bundle(body: BundleCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "name": body.name,
        "description": body.description,
        "items": [i.model_dump() for i in body.items],
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
    }
    result = await db.medication_bundles.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "medication_bundle.created", "medication_bundle",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/bundles/{bundle_id}")
async def update_bundle(bundle_id: str, body: BundleUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.medication_bundles.find_one(
        {"_id": ObjectId(bundle_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Bundle not found")

    update = {"updatedAt": datetime.utcnow()}
    if body.name is not None:
        update["name"] = body.name
    if body.description is not None:
        update["description"] = body.description
    if body.items is not None:
        update["items"] = [i.model_dump() for i in body.items]

    result = await db.medication_bundles.find_one_and_update(
        {"_id": ObjectId(bundle_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "medication_bundle.updated", "medication_bundle", bundle_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/bundles/{bundle_id}", status_code=204)
async def delete_bundle(bundle_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.medication_bundles.find_one_and_update(
        {"_id": ObjectId(bundle_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Bundle not found")
    await log_action(user_id, "medication_bundle.deleted", "medication_bundle", bundle_id)


# ── Bundle log (log all meds in a bundle at once) ────────────────────────────

class BundleLogRequest(BaseModel):
    status: str = "taken"   # taken|skipped


@router.post("/bundles/{bundle_id}/log", status_code=201)
async def log_bundle(bundle_id: str, body: BundleLogRequest = BundleLogRequest(), user: dict = Depends(require_auth)):
    """Log all medications in a bundle at once. Skips meds already logged as taken today."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    bundle = await db.medication_bundles.find_one(
        {"_id": ObjectId(bundle_id), "userId": user_id, "deletedAt": None}
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    logged_ids, skipped_ids = [], []

    for item in bundle.get("items", []):
        med_id = item["medicationId"]
        try:
            oid = ObjectId(med_id)
        except Exception:
            continue

        already = await db.medication_logs.find_one({
            "userId": user_id,
            "medicationId": med_id,
            "status": "taken",
            "takenAt": {"$gte": day_start, "$lte": day_end},
            "deletedAt": None,
        })
        if already:
            skipped_ids.append(med_id)
            continue

        med = await db.medications.find_one({"_id": oid, "userId": user_id, "deletedAt": None})
        if not med:
            continue

        doc = {
            "userId": user_id,
            "medicationId": med_id,
            "medicationName": med["name"],
            "dose": item.get("doseOverride") or med.get("dose"),
            "status": body.status,
            "takenAt": now,
            "scheduledFor": today,
            "notes": f"Logged via bundle: {bundle['name']}",
            "bundleId": bundle_id,
            "bundleName": bundle["name"],
            "deletedAt": None,
            "createdAt": now,
        }
        result = await db.medication_logs.insert_one(doc)
        doc["_id"] = result.inserted_id
        await log_action(user_id, f"medication.{body.status}", "medication_log",
                         str(result.inserted_id), after=doc_to_dict(doc))
        logged_ids.append(med_id)

    return {
        "bundleName": bundle["name"],
        "logged": len(logged_ids),
        "skipped": len(skipped_ids),
    }


# ── Medication logs ───────────────────────────────────────────────────────────

@router.get("/logs/list")
async def list_med_logs(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    medication_id: Optional[str] = Query(None),
    limit: int = 100,
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}
    if date_from or date_to:
        query["takenAt"] = {}
        if date_from:
            query["takenAt"]["$gte"] = datetime.fromisoformat(date_from)
        if date_to:
            query["takenAt"]["$lte"] = datetime.fromisoformat(date_to)
    if medication_id:
        query["medicationId"] = medication_id
    cursor = db.medication_logs.find(query).sort("takenAt", -1).limit(limit)
    logs = await cursor.to_list(length=limit)
    return [doc_to_dict(lg) for lg in logs]


@router.post("/logs", status_code=201)
async def log_medication(body: MedLogCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    med = await db.medications.find_one(
        {"_id": ObjectId(body.medicationId), "userId": user_id, "deletedAt": None}
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medication not found")

    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "medicationId": body.medicationId,
        "medicationName": med["name"],
        "dose": med.get("dose"),
        "status": body.status,
        "takenAt": body.takenAt or now,
        "scheduledFor": body.scheduledFor or now.strftime("%Y-%m-%d"),
        "notes": body.notes,
        "deletedAt": None,
        "createdAt": now,
    }
    result = await db.medication_logs.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, f"medication.{body.status}", "medication_log",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/logs/{log_id}")
async def update_med_log(log_id: str, body: MedLogUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.medication_logs.find_one(
        {"_id": ObjectId(log_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Log entry not found")
    update: dict = {"updatedAt": datetime.utcnow()}
    if body.status is not None:
        update["status"] = body.status
    if body.takenAt is not None:
        update["takenAt"] = body.takenAt
    if body.scheduledFor is not None:
        update["scheduledFor"] = body.scheduledFor
    if body.notes is not None:
        update["notes"] = body.notes
    result = await db.medication_logs.find_one_and_update(
        {"_id": ObjectId(log_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "medication_log.updated", "medication_log", log_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/logs/{log_id}", status_code=204)
async def delete_med_log(log_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.medication_logs.find_one_and_update(
        {"_id": ObjectId(log_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Log entry not found")
    await log_action(user_id, "medication_log.deleted", "medication_log", log_id)
