"""
Food diary CRUD — reads/writes food_logs directly to user_db.
"""
import asyncio
from datetime import datetime
from bson import ObjectId
from fastapi import APIRouter, Depends
from db_auth import require_user
from database import get_app_db, get_user_db
from mapping import MEAL_ID_TO_STR, MEAL_STR_TO_ID, ht_log_to_sparky_entry
from serializer import to_dict

router = APIRouter()


async def _find_food(user_id: str, food_id: str) -> dict | None:
    try:
        oid = ObjectId(food_id)
    except Exception:
        return None
    user_db = get_user_db(user_id)
    doc = await user_db.food_items.find_one({"_id": oid, "deletedAt": None})
    if not doc:
        doc = await get_app_db().food_items.find_one({"_id": oid, "deletedAt": None})
    return doc


def _build_snapshot(food: dict, quantity: float) -> dict:
    n = food.get("nutritionPerServing", {})
    return {k: round(float(v or 0) * quantity, 2) for k, v in n.items()
            if isinstance(v, (int, float))}


async def _enrich(log: dict, user_id: str) -> dict:
    food_id = log.get("foodItemId", "")
    food    = await _find_food(user_id, food_id) or {"id": food_id, "name": log.get("foodName", ""), "nutritionPerServing": {}}
    return ht_log_to_sparky_entry(to_dict(log), to_dict(food) or food, user_id)


@router.get("/food-entries/by-date/{date}")
async def get_food_entries(date: str, user_info=Depends(require_user)):
    user, user_id = user_info
    db = get_user_db(user_id)
    cursor = db.food_logs.find({
        "userId":    user_id,
        "loggedAt":  {"$gte": datetime.fromisoformat(date + "T00:00:00"),
                      "$lte": datetime.fromisoformat(date + "T23:59:59")},
        "deletedAt": None,
    })
    logs = await cursor.to_list(500)
    entries = await asyncio.gather(*[_enrich(log, user_id) for log in logs])
    return list(entries)


@router.post("/food-entries/")
async def create_food_entry(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    db = get_user_db(user_id)
    food_id    = body.get("food_id", "")
    meal_int   = body.get("meal_type_id", 7)
    entry_date = body.get("entry_date", "")
    servings   = float(body.get("servings", 1.0))

    food = await _find_food(user_id, food_id)
    now  = datetime.utcnow()
    doc  = {
        "userId":            user_id,
        "foodItemId":        food_id,
        "foodName":          (food or {}).get("name", ""),
        "brand":             (food or {}).get("brand"),
        "mealType":          MEAL_ID_TO_STR.get(meal_int, "other"),
        "quantity":          servings,
        "servingUnit":       "serving",
        "loggedAt":          datetime.fromisoformat(entry_date + "T12:00:00") if entry_date else now,
        "nutritionSnapshot": _build_snapshot(food or {}, servings),
        "notes":             "",
        "deletedAt":         None,
        "createdAt":         now,
        "updatedAt":         now,
        "createdBy":         user_id,
    }
    result = await db.food_logs.insert_one(doc)
    doc["_id"] = result.inserted_id
    return await _enrich(doc, user_id)


@router.put("/food-entries/{entry_id}")
async def update_food_entry(entry_id: str, body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    db = get_user_db(user_id)
    try:
        oid = ObjectId(entry_id)
    except Exception:
        return {}

    existing = await db.food_logs.find_one({"_id": oid, "userId": user_id, "deletedAt": None})
    if not existing:
        return {}

    update: dict = {"updatedAt": datetime.utcnow()}
    if "meal_type_id" in body:
        update["mealType"] = MEAL_ID_TO_STR.get(body["meal_type_id"], "other")
    if "servings" in body:
        new_qty = float(body["servings"])
        update["quantity"] = new_qty
        food = await _find_food(user_id, existing.get("foodItemId", ""))
        if food:
            update["nutritionSnapshot"] = _build_snapshot(food, new_qty)
    if "entry_date" in body:
        update["loggedAt"] = datetime.fromisoformat(body["entry_date"] + "T12:00:00")

    doc = await db.food_logs.find_one_and_update(
        {"_id": oid}, {"$set": update}, return_document=True
    )
    return await _enrich(doc, user_id)


@router.delete("/food-entries/{entry_id}")
async def delete_food_entry(entry_id: str, user_info=Depends(require_user)):
    user, user_id = user_info
    db = get_user_db(user_id)
    try:
        oid = ObjectId(entry_id)
    except Exception:
        return
    await db.food_logs.update_one(
        {"_id": oid, "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
