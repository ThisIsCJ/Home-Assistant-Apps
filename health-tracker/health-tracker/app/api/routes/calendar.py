import calendar as cal_lib
from fastapi import APIRouter, Depends, Query
from datetime import datetime, timedelta
from auth.middleware import require_auth
from database import get_user_db

router = APIRouter()


@router.get("/month")
async def get_month_summary(
    year: int = Query(...),
    month: int = Query(...),
    tz_offset: int = Query(0),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)

    _, days_in_month = cal_lib.monthrange(year, month)

    # Convert local month boundaries to UTC for querying.
    # tz_offset = JS getTimezoneOffset() = minutes west of UTC (positive for UTC-N).
    # local_time + tz_offset_minutes = UTC time.
    local_start = datetime(year, month, 1, 0, 0, 0)
    local_end   = datetime(year, month, days_in_month, 23, 59, 59, 999999)
    start = local_start + timedelta(minutes=tz_offset)
    end   = local_end   + timedelta(minutes=tz_offset)

    result = {
        f"{year:04d}-{month:02d}-{d:02d}": {
            "calories": 0.0, "logCount": 0,
            "medsTaken": 0, "medsTotal": 0,
            "workouts": 0, "statsCount": 0,
        }
        for d in range(1, days_in_month + 1)
    }

    # Food logs — convert UTC timestamp to local date before bucketing
    async for log in db.food_logs.find(
        {"userId": user_id, "loggedAt": {"$gte": start, "$lte": end}, "deletedAt": None},
        {"loggedAt": 1, "nutritionSnapshot": 1},
    ):
        key = (log["loggedAt"] - timedelta(minutes=tz_offset)).strftime("%Y-%m-%d")
        if key in result:
            result[key]["calories"] += log.get("nutritionSnapshot", {}).get("calories", 0)
            result[key]["logCount"] += 1

    for v in result.values():
        v["calories"] = round(v["calories"])

    # Medication logs (scheduledFor is a YYYY-MM-DD local-date string — already timezone-safe)
    month_prefix = f"{year:04d}-{month:02d}"
    async for log in db.medication_logs.find(
        {"userId": user_id, "scheduledFor": {"$regex": f"^{month_prefix}"}},
        {"scheduledFor": 1, "status": 1},
    ):
        key = log.get("scheduledFor", "")[:10]
        if key in result:
            result[key]["medsTotal"] += 1
            if log.get("status") == "taken":
                result[key]["medsTaken"] += 1

    # Workout sessions — convert UTC startedAt to local date before bucketing
    async for s in db.workout_sessions.find(
        {"userId": user_id, "startedAt": {"$gte": start, "$lte": end}, "deletedAt": None},
        {"startedAt": 1},
    ):
        key = (s["startedAt"] - timedelta(minutes=tz_offset)).strftime("%Y-%m-%d")
        if key in result:
            result[key]["workouts"] += 1

    # Health readings — convert UTC takenAt to local date before bucketing
    async for r in db.health_readings.find(
        {"userId": user_id, "takenAt": {"$gte": start, "$lte": end}, "deletedAt": None},
        {"takenAt": 1},
    ):
        key = (r["takenAt"] - timedelta(minutes=tz_offset)).strftime("%Y-%m-%d")
        if key in result:
            result[key]["statsCount"] += 1

    return {"year": year, "month": month, "days": result}
