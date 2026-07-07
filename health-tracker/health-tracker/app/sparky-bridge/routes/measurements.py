"""
Body check-ins and water intake — reads/writes health_readings directly.
"""
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends
from db_auth import require_user
from database import get_user_db
from mapping import CHECKIN_TO_METRIC, METRIC_TO_CHECKIN

router = APIRouter()

_DEFAULT_CONTAINER = {
    "id": "1",
    "name": "Glass (8 fl oz)",
    "size_ml": 240,
    "size_oz": 8.0,
}


async def _get_user_metric_map(user_id: str) -> dict[str, dict]:
    """Return metricKey → metric_type_doc for this user (global + user-scoped)."""
    from database import get_app_db
    import asyncio
    app_db  = get_app_db()
    user_db = get_user_db(user_id)
    app_types, usr_types = await asyncio.gather(
        app_db.health_metric_types.find({"deletedAt": None}).to_list(200),
        user_db.health_metric_types.find({"deletedAt": None}).to_list(200),
    )
    key_map: dict[str, dict] = {}
    for t in (app_types + usr_types):
        key_map[t["key"]] = t
    return key_map


async def _readings_for_date(user_id: str, date: str) -> list[dict]:
    db = get_user_db(user_id)
    cursor = db.health_readings.find({
        "userId":    user_id,
        "takenAt":   {"$gte": datetime.fromisoformat(date + "T00:00:00"),
                      "$lte": datetime.fromisoformat(date + "T23:59:59")},
        "deletedAt": None,
    })
    return await cursor.to_list(100)


def _readings_to_checkin(date: str, readings: list[dict]) -> dict:
    result: dict = {"id": date, "user_id": None, "entry_date": date}
    for r in readings:
        ck = METRIC_TO_CHECKIN.get(r.get("metricKey", ""))
        if ck:
            result[ck] = r.get("value")
    return result


async def _sync_readings(user_id: str, readings_dicts: list[dict], source: str = "sparky_companion") -> None:
    """Upsert a list of reading dicts into health_readings via the shared upsert helper."""
    from sync import upsert_reading
    key_map = await _get_user_metric_map(user_id)
    user_db = get_user_db(user_id)
    now     = datetime.utcnow()

    for r in readings_dicts:
        mt = key_map.get(r["metricKey"])
        if not mt:
            continue
        taken_at = datetime.fromisoformat(r["takenAt"]).replace(tzinfo=None)
        await upsert_reading(
            user_db, user_id, mt,
            value=float(r["value"]),
            unit=r.get("unit") or mt.get("unit", ""),
            taken_at=taken_at,
            source=source,
            device=r.get("device", source),
            now=now,
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/measurements/check-in/{date}")
async def get_check_in(date: str, user_info=Depends(require_user)):
    user, user_id = user_info
    readings = await _readings_for_date(user_id, date)
    return _readings_to_checkin(date, readings)


@router.get("/measurements/check-in-measurements-range/{start}/{end}")
async def get_check_in_range(start: str, end: str, user_info=Depends(require_user)):
    user, user_id = user_info
    db = get_user_db(user_id)
    cursor = db.health_readings.find({
        "userId":    user_id,
        "takenAt":   {"$gte": datetime.fromisoformat(start + "T00:00:00"),
                      "$lte": datetime.fromisoformat(end   + "T23:59:59")},
        "deletedAt": None,
    })
    readings = await cursor.to_list(1000)

    by_date: dict[str, list] = {}
    for r in readings:
        d = r["takenAt"].strftime("%Y-%m-%d") if isinstance(r["takenAt"], datetime) else str(r["takenAt"])[:10]
        by_date.setdefault(d, []).append(r)

    return [_readings_to_checkin(d, rs) for d, rs in sorted(by_date.items())]


@router.post("/measurements/check-in")
async def create_check_in(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    entry_date = body.get("entry_date", "")
    readings_to_sync = []

    for sparky_key, (metric_key, unit) in CHECKIN_TO_METRIC.items():
        value = body.get(sparky_key)
        if value is not None:
            readings_to_sync.append({
                "metricKey": metric_key,
                "value":     float(value),
                "unit":      unit,
                "takenAt":   entry_date + "T00:00:00",
                "device":    "sparky_companion",
            })

    if readings_to_sync:
        await _sync_readings(user_id, readings_to_sync)

    readings = await _readings_for_date(user_id, entry_date)
    return _readings_to_checkin(entry_date, readings)


@router.get("/measurements/water-intake/{date}")
async def get_water_intake(date: str, user_info=Depends(require_user)):
    user, user_id = user_info
    readings = await _readings_for_date(user_id, date)
    oz = next((r["value"] for r in readings if r.get("metricKey") == "water_intake"), 0.0)
    return {
        "entry_date":        date,
        "total_ml":          round(oz * 29.5735, 1),
        "total_oz":          oz,
        "drinks":            round(oz / _DEFAULT_CONTAINER["size_oz"], 1) if oz else 0,
        "container_id":      _DEFAULT_CONTAINER["id"],
        "container_size_ml": _DEFAULT_CONTAINER["size_ml"],
    }


@router.post("/measurements/water-intake")
async def update_water_intake(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    entry_date   = body.get("entry_date", "")
    change       = float(body.get("change_drinks", 0))
    container_id = body.get("container_id", "1")

    readings   = await _readings_for_date(user_id, entry_date)
    current_oz = next((r["value"] for r in readings if r.get("metricKey") == "water_intake"), 0.0)
    new_oz     = max(0.0, current_oz + change * _DEFAULT_CONTAINER["size_oz"])

    await _sync_readings(user_id, [{
        "metricKey": "water_intake",
        "value":     new_oz,
        "unit":      "oz",
        "takenAt":   entry_date + "T00:00:00",
        "device":    "sparky_companion",
    }])

    return {
        "entry_date":        entry_date,
        "total_oz":          new_oz,
        "total_ml":          round(new_oz * 29.5735, 1),
        "drinks":            round(new_oz / _DEFAULT_CONTAINER["size_oz"], 1),
        "container_id":      container_id,
        "container_size_ml": _DEFAULT_CONTAINER["size_ml"],
    }


@router.get("/water-containers")
async def water_containers(user_info=Depends(require_user)):
    return [_DEFAULT_CONTAINER]
