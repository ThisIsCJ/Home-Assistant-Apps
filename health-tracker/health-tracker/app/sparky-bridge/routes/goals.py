"""
Daily goals and summary — reads from food_logs and health_readings directly.
"""
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from db_auth import require_user
from database import get_user_db
from config import get_settings
from serializer import to_dict

router = APIRouter()


def _default_goals() -> dict:
    s = get_settings()
    return {
        "calories":  s.goal_calories,
        "protein":   s.goal_protein_g,
        "carbs":     s.goal_carbs_g,
        "fat":       s.goal_fat_g,
        "water_ml":  s.goal_water_ml,
        "steps":     s.goal_steps,
        "fiber":     25,
        "sugar":     50,
        "sodium":    2300,
        "caffeine":  400,
    }


@router.get("/goals/for-date")
async def goals_for_date(date: str = Query(...), user_info=Depends(require_user)):
    return _default_goals()


@router.get("/daily-summary")
async def daily_summary(date: str = Query(...), user_info=Depends(require_user)):
    user, user_id = user_info
    db = get_user_db(user_id)

    day_start = datetime.fromisoformat(date + "T00:00:00")
    day_end   = datetime.fromisoformat(date + "T23:59:59")

    logs_coro     = db.food_logs.find({"userId": user_id, "loggedAt": {"$gte": day_start, "$lte": day_end}, "deletedAt": None}).to_list(500)
    readings_coro = db.health_readings.find({"userId": user_id, "takenAt": {"$gte": day_start, "$lte": day_end}, "deletedAt": None}).to_list(100)

    logs, readings = await asyncio.gather(logs_coro, readings_coro)

    consumed = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "fiber": 0.0}
    for log in logs:
        snap = log.get("nutritionSnapshot") or {}
        consumed["calories"] += snap.get("calories", 0)
        consumed["protein"]  += snap.get("proteinG", 0)
        consumed["carbs"]    += snap.get("carbsG", 0)
        consumed["fat"]      += snap.get("fatG", 0)
        consumed["fiber"]    += snap.get("fiberG", 0)

    step_reading = next((r["value"] for r in readings if r.get("metricKey") == "steps"), 0)
    water_oz     = next((r["value"] for r in readings if r.get("metricKey") == "water_intake"), 0.0)

    goals = _default_goals()

    return {
        "goals":             goals,
        "food_entries":      [to_dict(l) for l in logs],
        "exercise_sessions": [],
        "water_intake": {
            "total_oz": water_oz,
            "total_ml": round(water_oz * 29.5735, 1),
        },
        "step_count":      step_reading,
        "calorie_balance": goals["calories"] - consumed["calories"],
        "consumed":        consumed,
    }
