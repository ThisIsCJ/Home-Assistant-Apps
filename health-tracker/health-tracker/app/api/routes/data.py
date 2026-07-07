import csv
import io
import zipfile
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from auth.middleware import require_auth
from database import get_app_db, get_user_db
import auth.middleware as _auth_mw

router = APIRouter()


def _s(v):
    if v is None:
        return ''
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def _write_csv(rows, fieldnames):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction='ignore')
    writer.writeheader()
    for row in rows:
        writer.writerow({k: _s(row.get(k)) for k in fieldnames})
    return buf.getvalue().encode('utf-8')


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '').replace('+00:00', ''))
    except Exception:
        return None


@router.get("/export")
async def export_data(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    app_db = get_app_db()
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:

        # food_items — global from app_db + user's personal from user_db
        rows = []
        seen_food_ids = set()
        for food_cursor in [
            app_db.food_items.find({"deletedAt": None}, {"_id": 1, "name": 1, "brand": 1, "servingSize": 1, "nutritionPerServing": 1}),
            user_db.food_items.find({"deletedAt": None}, {"_id": 1, "name": 1, "brand": 1, "servingSize": 1, "nutritionPerServing": 1}),
        ]:
            async for doc in food_cursor:
                sid = str(doc["_id"])
                if sid in seen_food_ids:
                    continue
                seen_food_ids.add(sid)
                ns = doc.get("nutritionPerServing") or {}
                ss = doc.get("servingSize") or {}
                rows.append({
                    "id": sid, "name": doc.get("name"), "brand": doc.get("brand"),
                    "servingAmount": ss.get("amount"), "servingUnit": ss.get("unit"),
                    "calories": ns.get("calories"), "proteinG": ns.get("proteinG"),
                    "carbsG": ns.get("carbsG"), "fatG": ns.get("fatG"),
                    "fiberG": ns.get("fiberG"), "sugarG": ns.get("sugarG"), "sodiumMg": ns.get("sodiumMg"),
                })
        zf.writestr("food_items.csv", _write_csv(rows, ["id", "name", "brand", "servingAmount", "servingUnit", "calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "sodiumMg"]))

        # food_logs
        rows = []
        async for doc in user_db.food_logs.find({"userId": user_id, "deletedAt": None}):
            ns = doc.get("nutritionSnapshot") or {}
            rows.append({
                "id": str(doc["_id"]), "foodName": doc.get("foodName"), "brand": doc.get("brand"),
                "loggedAt": doc.get("loggedAt"), "mealType": doc.get("mealType"),
                "quantity": doc.get("quantity"),
                "calories": ns.get("calories"), "proteinG": ns.get("proteinG"),
                "carbsG": ns.get("carbsG"), "fatG": ns.get("fatG"), "notes": doc.get("notes"),
            })
        zf.writestr("food_logs.csv", _write_csv(rows, ["id", "foodName", "brand", "loggedAt", "mealType", "quantity", "calories", "proteinG", "carbsG", "fatG", "notes"]))

        # medications
        rows = []
        async for doc in user_db.medications.find({"userId": user_id, "deletedAt": None}):
            rows.append({
                "id": str(doc["_id"]), "name": doc.get("name"), "genericName": doc.get("genericName"),
                "dose": doc.get("dose"), "form": doc.get("form"), "route": doc.get("route"),
                "frequency": doc.get("frequency"), "medType": doc.get("medType"),
                "startDate": doc.get("startDate"), "endDate": doc.get("endDate"),
                "active": doc.get("active"), "prescriber": doc.get("prescriber"),
                "pharmacy": doc.get("pharmacy"), "reason": doc.get("reason"), "notes": doc.get("notes"),
            })
        zf.writestr("medications.csv", _write_csv(rows, ["id", "name", "genericName", "dose", "form", "route", "frequency", "medType", "startDate", "endDate", "active", "prescriber", "pharmacy", "reason", "notes"]))

        # medication_logs
        rows = []
        async for doc in user_db.medication_logs.find({"userId": user_id}):
            rows.append({
                "id": str(doc["_id"]), "medicationId": doc.get("medicationId"),
                "status": doc.get("status"), "takenAt": doc.get("takenAt"),
                "scheduledFor": doc.get("scheduledFor"), "notes": doc.get("notes"),
            })
        zf.writestr("medication_logs.csv", _write_csv(rows, ["id", "medicationId", "status", "takenAt", "scheduledFor", "notes"]))

        # health_readings
        rows = []
        async for doc in user_db.health_readings.find({"userId": user_id, "deletedAt": None}):
            rows.append({
                "id": str(doc["_id"]), "metricName": doc.get("metricName"),
                "metricKey": doc.get("metricKey"), "value": doc.get("value"),
                "unit": doc.get("unit"), "takenAt": doc.get("takenAt"),
                "notes": doc.get("notes"), "device": doc.get("device"), "source": doc.get("source"),
            })
        zf.writestr("health_readings.csv", _write_csv(rows, ["id", "metricName", "metricKey", "value", "unit", "takenAt", "notes", "device", "source"]))

        # workout_sessions + workout_exercises (flattened sets)
        sessions = []
        exercise_rows = []
        async for doc in user_db.workout_sessions.find({"userId": user_id, "deletedAt": None}):
            sid = str(doc["_id"])
            sessions.append({
                "id": sid, "name": doc.get("name"), "startedAt": doc.get("startedAt"),
                "durationSeconds": doc.get("durationSeconds"), "notes": doc.get("notes"),
            })
            for ex in (doc.get("exercises") or []):
                for i, s in enumerate((ex.get("sets") or []), start=1):
                    exercise_rows.append({
                        "sessionId": sid, "sessionName": doc.get("name"),
                        "exerciseName": ex.get("name"), "setNumber": i,
                        "reps": s.get("reps"), "weight": s.get("weight"),
                        "weightUnit": s.get("weightUnit"),
                        "durationSeconds": s.get("durationSeconds"),
                        "distanceKm": s.get("distanceKm"), "notes": s.get("notes"),
                    })
        zf.writestr("workout_sessions.csv", _write_csv(sessions, ["id", "name", "startedAt", "durationSeconds", "notes"]))
        zf.writestr("workout_exercises.csv", _write_csv(exercise_rows, ["sessionId", "sessionName", "exerciseName", "setNumber", "reps", "weight", "weightUnit", "durationSeconds", "distanceKm", "notes"]))

    buf.seek(0)
    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="health_export_{ts}.zip"'},
    )


@router.post("/import")
async def import_data(
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    content = await file.read()
    fname = (file.filename or "").lower()
    stats = {}
    now = datetime.utcnow()

    all_errors: dict = {}
    if fname.endswith(".zip"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith(".csv"):
                        count, errors = await _import_csv(name, zf.read(name), user_id, db, now)
                        if count is not None:
                            key = name.split('/')[-1]
                            stats[key] = count
                            if errors:
                                all_errors[key] = errors
        except zipfile.BadZipFile:
            raise HTTPException(400, "Invalid ZIP file")
    elif fname.endswith(".csv"):
        count, errors = await _import_csv(fname, content, user_id, db, now)
        if count is not None:
            stats[fname] = count
            if errors:
                all_errors[fname] = errors
        else:
            raise HTTPException(400, f"Unrecognized CSV: {fname}. Expected one of: food_logs, health_readings, medications, food_items")
    else:
        raise HTTPException(400, "File must be a .zip or .csv")

    result: dict = {"imported": stats}
    if all_errors:
        result["errors"] = all_errors
    return result


async def _import_csv(name, raw, user_id, db, now):
    base = name.split('/')[-1].lower()
    text = raw.decode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(text)))

    if base == "food_logs.csv":
        docs = []
        errors = []
        for i, r in enumerate(rows, start=2):
            try:
                ns = doc_ns(r)
                docs.append({
                    "userId": user_id,
                    "foodName": r.get("foodName") or r.get("name") or "",
                    "brand": r.get("brand") or None,
                    "mealType": r.get("mealType") or "other",
                    "quantity": float(r["quantity"]) if r.get("quantity") else 1.0,
                    "nutritionSnapshot": ns,
                    "notes": r.get("notes") or None,
                    "loggedAt": _parse_dt(r.get("loggedAt")) or now,
                    "deletedAt": None, "createdAt": now, "updatedAt": now,
                })
            except Exception as e:
                errors.append({"row": i, "reason": str(e)})
        if docs:
            await db.food_logs.insert_many(docs)
        return len(docs), errors

    elif base == "health_readings.csv":
        # Build metricKey → metric_type_doc map so imported readings get metricTypeId
        app_db = get_app_db()
        app_types = await app_db.health_metric_types.find({"deletedAt": None}).to_list(200)
        usr_types = await db.health_metric_types.find({"deletedAt": None}).to_list(200)
        key_map = {t["key"]: t for t in (app_types + usr_types)}

        inserted = updated = 0
        errors = []
        for i, r in enumerate(rows, start=2):
            try:
                metric_key = r.get("metricKey") or None
                mt         = key_map.get(metric_key) if metric_key else None
                taken_at   = (_parse_dt(r.get("takenAt")) or now).replace(microsecond=0)
                value      = float(r["value"]) if r.get("value") else 0.0
                unit       = r.get("unit") or (mt.get("unit", "") if mt else "")

                result = await db.health_readings.update_one(
                    {"userId": user_id, "metricKey": metric_key, "takenAt": taken_at, "deletedAt": None},
                    {
                        "$set": {
                            "value":  value,
                            "unit":   unit,
                            "device": r.get("device") or None,
                            "source": r.get("source") or "csv_import",
                            "updatedAt": now,
                        },
                        "$setOnInsert": {
                            "metricTypeId": str(mt["_id"]) if mt else None,
                            "metricName":   r.get("metricName") or (mt["displayName"] if mt else ""),
                            "notes":        r.get("notes") or None,
                            "deletedAt":    None,
                            "createdAt":    now,
                        },
                    },
                    upsert=True,
                )
                if result.upserted_id:
                    inserted += 1
                elif result.modified_count:
                    updated += 1
            except Exception as e:
                errors.append({"row": i, "reason": str(e)})
        return inserted + updated, errors

    elif base == "medications.csv":
        docs = []
        errors = []
        for i, r in enumerate(rows, start=2):
            try:
                active_val = r.get("active", "True")
                docs.append({
                    "userId": user_id,
                    "name": r.get("name") or "",
                    "genericName": r.get("genericName") or None,
                    "dose": r.get("dose") or None,
                    "form": r.get("form") or None,
                    "route": r.get("route") or None,
                    "frequency": r.get("frequency") or None,
                    "medType": r.get("medType") or "otc",
                    "startDate": r.get("startDate") or None,
                    "endDate": r.get("endDate") or None,
                    "active": str(active_val).lower() not in ("false", "0", ""),
                    "prescriber": r.get("prescriber") or None,
                    "pharmacy": r.get("pharmacy") or None,
                    "reason": r.get("reason") or None,
                    "notes": r.get("notes") or None,
                    "deletedAt": None, "createdAt": now, "updatedAt": now,
                })
            except Exception as e:
                errors.append({"row": i, "reason": str(e)})
        if docs:
            await db.medications.insert_many(docs)
        return len(docs), errors

    elif base == "food_items.csv":
        docs = []
        errors = []
        for i, r in enumerate(rows, start=2):
            try:
                docs.append({
                    "userId": user_id,
                    "scope": "personal",
                    "name": r.get("name") or "",
                    "brand": r.get("brand") or None,
                    "servingSize": {
                        "amount": float(r["servingAmount"]) if r.get("servingAmount") else 100,
                        "unit": r.get("servingUnit") or "g",
                    },
                    "nutritionPerServing": doc_ns(r),
                    "deletedAt": None, "createdAt": now, "updatedAt": now,
                })
            except Exception as e:
                errors.append({"row": i, "reason": str(e)})
        if docs:
            await db.food_items.insert_many(docs)
        return len(docs), errors

    return None, []  # unrecognized — skip silently in ZIP context


def doc_ns(r):
    def f(k):
        v = r.get(k)
        return float(v) if v else 0.0
    return {
        "calories": f("calories"), "proteinG": f("proteinG"),
        "carbsG": f("carbsG"), "fatG": f("fatG"),
        "fiberG": f("fiberG"), "sugarG": f("sugarG"), "sodiumMg": f("sodiumMg"),
    }


# ── Refresh / reseed ──────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_database(user: dict = Depends(require_auth)):
    """
    Force-update all global reference data and flush caches.

    Unlike startup seeding (which uses $setOnInsert and skips existing docs),
    this uses $set so every metric type gets its latest displayName, color,
    unit, and normalRange values even if it already exists in the database.
    """
    from main import SEED_METRIC_TYPES, _seed_global_exercises, _seed_global_foods

    db  = get_app_db()
    now = datetime.utcnow()

    # Force-update every global metric type — overwrites displayName, color,
    # unit, and ranges so the UI always shows current values after an app update.
    for m in SEED_METRIC_TYPES:
        await db.health_metric_types.update_one(
            {"key": m["key"], "scope": "global"},
            {
                "$set": {
                    **m,
                    "userId":         None,
                    "scope":          "global",
                    "valueType":      "number",
                    "normalRangeMin": m.get("normalRangeMin"),
                    "normalRangeMax": m.get("normalRangeMax"),
                    "description":    None,
                    "deletedAt":      None,
                    "updatedAt":      now,
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )

    # Exercises and foods: additive only (insert missing, skip existing)
    await _seed_global_exercises()
    await _seed_global_foods()

    # Flush the JWKS signing-key cache so the next request fetches fresh keys
    _auth_mw._jwks_cache      = {}
    _auth_mw._jwks_fetched_at = None
    _auth_mw._jwks_uri        = None

    metric_count   = await db.health_metric_types.count_documents({"scope": "global", "deletedAt": None})
    food_count     = await db.food_items.count_documents({"scope": "global", "deletedAt": None})
    exercise_count = await db.exercises.count_documents({"scope": "global", "deletedAt": None})

    return {
        "ok":          True,
        "metricTypes": metric_count,
        "foods":       food_count,
        "exercises":   exercise_count,
    }
