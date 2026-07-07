"""
User identity and preferences — reads/writes directly from/to app_db.users.
"""
from datetime import datetime
from fastapi import APIRouter, Depends
from db_auth import require_user
from database import get_app_db
from config import get_settings

router = APIRouter()


def _user_to_sparky(user: dict, user_id: str) -> dict:
    return {
        "id":           user_id,
        "email":        user.get("email", ""),
        "display_name": user.get("displayName", ""),
        "role":         "user",
    }


@router.get("/auth/user")
async def identity_user(user_info=Depends(require_user)):
    user, user_id = user_info
    return _user_to_sparky(user, user_id)


@router.get("/auth/profiles")
async def identity_profiles(user_info=Depends(require_user)):
    user, user_id = user_info
    prefs = user.get("preferences", {})
    return {
        "id":           user_id,
        "user_id":      user_id,
        "display_name": user.get("displayName", ""),
        "avatar_url":   user.get("avatarUrl"),
        "timezone":     prefs.get("timezone", "America/New_York"),
    }


@router.get("/user-preferences")
async def get_preferences(user_info=Depends(require_user)):
    user, user_id = user_info
    s     = get_settings()
    prefs = user.get("preferences", {})
    return {
        "id":               user_id,
        "user_id":          user_id,
        "timezone":         prefs.get("timezone", "America/New_York"),
        "units":            prefs.get("units", "imperial"),
        "calorie_goal":     s.goal_calories,
        "protein_goal":     s.goal_protein_g,
        "carb_goal":        s.goal_carbs_g,
        "fat_goal":         s.goal_fat_g,
        "water_goal_ml":    s.goal_water_ml,
        "step_goal":        s.goal_steps,
        "weight_unit":      "lbs",
        "measurement_unit": "in",
    }


@router.put("/user-preferences")
async def update_preferences(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    if "timezone" in body:
        await get_app_db().users.update_one(
            {"_id": user["_id"]},
            {"$set": {"preferences.timezone": body["timezone"], "updatedAt": datetime.utcnow()}},
        )
    # Re-fetch and return updated prefs
    updated = await get_app_db().users.find_one({"_id": user["_id"]})
    return await get_preferences.__wrapped__((updated or user, user_id)) if False else \
           await _build_prefs(updated or user, user_id)


@router.post("/user-preferences/bootstrap-timezone")
async def bootstrap_timezone(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    if tz := body.get("timezone"):
        await get_app_db().users.update_one(
            {"_id": user["_id"]},
            {"$set": {"preferences.timezone": tz, "updatedAt": datetime.utcnow()}},
        )
    return await _build_prefs(user, user_id)


async def _build_prefs(user: dict, user_id: str) -> dict:
    s     = get_settings()
    prefs = user.get("preferences", {})
    return {
        "id":               user_id,
        "user_id":          user_id,
        "timezone":         prefs.get("timezone", "America/New_York"),
        "units":            prefs.get("units", "imperial"),
        "calorie_goal":     s.goal_calories,
        "protein_goal":     s.goal_protein_g,
        "carb_goal":        s.goal_carbs_g,
        "fat_goal":         s.goal_fat_g,
        "water_goal_ml":    s.goal_water_ml,
        "step_goal":        s.goal_steps,
        "weight_unit":      "lbs",
        "measurement_unit": "in",
    }
