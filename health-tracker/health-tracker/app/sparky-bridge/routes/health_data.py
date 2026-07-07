"""
POST /health-data — bulk health data ingest from Sparky / Health Connect.
Writes directly to the same health_readings collection the HT API uses.
"""
import asyncio
from datetime import datetime
from fastapi import APIRouter, Body, Depends
from config import get_settings
from db_auth import require_user
from database import get_app_db, get_user_db
from mapping import HEALTH_DATA_TYPE_MAP
from sync import upsert_reading
import logger as slog

router = APIRouter()


def _item_to_readings(item: dict) -> list[dict]:
    """Convert one Sparky health-data item into HT-style reading dicts."""
    item_type = item.get("type", "")
    taken_at  = (item.get("start_date") or item.get("date") or "")[:19]

    if item_type in ("SleepSession", "sleep_session"):
        readings = []
        start = item.get("start_date", "")
        end   = item.get("end_date", "")
        if start and end:
            try:
                s = datetime.fromisoformat(start[:19])
                e = datetime.fromisoformat(end[:19])
                readings.append({
                    "metricKey": "sleep_duration",
                    "value":     round((e - s).total_seconds() / 60, 1),
                    "unit":      "min",
                    "takenAt":   start[:19],
                    "device":    "health_connect",
                })
            except ValueError:
                pass
        stage_map = {"deep": "sleep_deep", "rem": "sleep_rem",
                     "light": "sleep_light", "awake": "sleep_awake"}
        for stage in item.get("stages", []):
            key = stage_map.get(stage.get("type", "").lower())
            ss, se = stage.get("start_date", ""), stage.get("end_date", "")
            if key and ss and se:
                try:
                    mins = round(
                        (datetime.fromisoformat(se[:19]) - datetime.fromisoformat(ss[:19])).total_seconds() / 60, 1
                    )
                    readings.append({
                        "metricKey": key,
                        "value":     mins,
                        "unit":      "min",
                        "takenAt":   ss[:19],
                        "device":    "health_connect",
                    })
                except ValueError:
                    pass
        return readings

    mapping = HEALTH_DATA_TYPE_MAP.get(item_type)
    if not mapping or not taken_at:
        return []

    metric_key, default_unit = mapping
    value = item.get("value")
    if value is None:
        return []

    return [{
        "metricKey": metric_key,
        "value":     float(value),
        "unit":      item.get("unit") or default_unit,
        "takenAt":   taken_at,
        "device":    item.get("source_name", "health_connect"),
    }]


@router.post("/health-data")
async def ingest_health_data(body: list = Body(...), user_info=Depends(require_user)):
    user, user_id = user_info
    app_db  = get_app_db()
    user_db = get_user_db(user_id)

    # Build metricKey → metric_type_doc map (user types override global)
    app_types, usr_types = await asyncio.gather(
        app_db.health_metric_types.find({"deletedAt": None}).to_list(200),
        user_db.health_metric_types.find({"deletedAt": None}).to_list(200),
    )
    key_map: dict[str, dict] = {t["key"]: t for t in (app_types + usr_types)}

    raw_readings: list[dict] = []
    for item in body:
        raw_readings.extend(_item_to_readings(item))

    # Per-user preference (Settings → Sync Sources) wins; the IGNORED_METRICS
    # env var is only the default for users who never saved preferences.
    prefs = await user_db.sync_preferences.find_one({"_id": "sync_preferences"})
    if prefs and "sparkyIgnoredMetrics" in prefs:
        ignored = set(prefs.get("sparkyIgnoredMetrics") or [])
    else:
        ignored = get_settings().ignored_metric_keys
    if ignored:
        before = len(raw_readings)
        raw_readings = [r for r in raw_readings if r["metricKey"] not in ignored]
        dropped = before - len(raw_readings)
        if dropped:
            await slog.info(
                f"Ignored {dropped} reading(s) for metrics {sorted(ignored)} (sync preferences)",
                source="health-data", user_id=user_id, dropped=dropped,
            )

    if not raw_readings:
        await slog.debug("Health-data sync: 0 readings to process", source="health-data", user_id=user_id)
        return {"inserted": 0, "updated": 0, "noop": 0, "errors": []}

    await slog.info(
        f"Health-data sync started: {len(raw_readings)} reading(s) from {len(body)} item(s)",
        source="health-data", user_id=user_id, item_count=len(body), reading_count=len(raw_readings),
    )

    now = datetime.utcnow()
    inserted = updated = noop = 0
    errors: list[dict] = []

    for r in raw_readings:
        mt = key_map.get(r["metricKey"])
        if not mt:
            errors.append({"metricKey": r["metricKey"], "error": "Unknown metric key"})
            await slog.warning(
                f"Unknown metric key: {r['metricKey']}",
                source="health-data", user_id=user_id, metric_key=r["metricKey"],
            )
            continue

        try:
            taken_at = datetime.fromisoformat(r["takenAt"])
        except ValueError:
            errors.append({"metricKey": r["metricKey"], "error": f"Bad takenAt: {r['takenAt']}"})
            await slog.warning(
                f"Bad takenAt for {r['metricKey']}: {r['takenAt']}",
                source="health-data", user_id=user_id, metric_key=r["metricKey"],
            )
            continue

        outcome = await upsert_reading(
            user_db, user_id, mt,
            value=float(r["value"]),
            unit=r.get("unit") or mt.get("unit", ""),
            taken_at=taken_at,
            source="health_connect",
            device=r.get("device", "health_connect"),
            now=now,
        )
        if outcome == "inserted":
            inserted += 1
        elif outcome == "updated":
            updated += 1
        else:
            noop += 1

        await slog.debug(
            f"{r['metricKey']} = {r['value']} ({outcome})",
            source="health-data", user_id=user_id,
            metric_key=r["metricKey"], value=r["value"], outcome=outcome,
        )

    await slog.info(
        f"Health-data sync complete: {inserted} inserted, {updated} updated, {noop} noop, {len(errors)} error(s)",
        source="health-data", user_id=user_id,
        inserted=inserted, updated=updated, noop=noop, errors=len(errors),
    )

    return {"inserted": inserted, "updated": updated, "noop": noop, "errors": errors[:10]}
