"""Shared health reading upsert — single write path for all data sources."""
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorDatabase


async def upsert_reading(
    user_db: AsyncIOMotorDatabase,
    user_id: str,
    mt: dict,
    value: float,
    unit: str,
    taken_at: datetime,
    source: str,
    device: str | None = None,
    now: datetime | None = None,
) -> str:
    """
    Upsert one health reading keyed on (userId, metricKey, takenAt-to-second).

    First write inserts; repeat syncs update value/unit/device so cumulative
    metrics like step counts always reflect the latest figure for that timestamp.
    Returns 'inserted', 'updated', or 'noop'.
    """
    if now is None:
        now = datetime.utcnow()
    ts = taken_at.replace(tzinfo=None, microsecond=0)

    result = await user_db.health_readings.update_one(
        {"userId": user_id, "metricKey": mt["key"], "takenAt": ts, "deletedAt": None},
        {
            "$set": {
                "value":     value,
                "unit":      unit or mt.get("unit", ""),
                "device":    device or source,
                "source":    source,
                "updatedAt": now,
            },
            "$setOnInsert": {
                "metricTypeId": str(mt["_id"]),
                "metricName":   mt["displayName"],
                "notes":        None,
                "deletedAt":    None,
                "createdAt":    now,
                "createdBy":    user_id,
            },
        },
        upsert=True,
    )
    if result.upserted_id:
        return "inserted"
    if result.modified_count:
        return "updated"
    return "noop"
