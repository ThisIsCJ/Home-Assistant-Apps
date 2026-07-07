from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from bson import ObjectId
from auth.middleware import require_auth
from database import get_app_db, get_user_db
from lib.serializer import doc_to_dict
from lib.audit import log_action

router = APIRouter()


class FoodPlanCreate(BaseModel):
    foodItemId: str
    quantity: float = 1.0
    mealType: str = "other"
    plannedDate: str    # YYYY-MM-DD
    plannedTime: str    # HH:MM
    notes: Optional[str] = None


class FoodPlanUpdate(BaseModel):
    quantity: Optional[float] = None
    mealType: Optional[str] = None
    plannedDate: Optional[str] = None
    plannedTime: Optional[str] = None
    notes: Optional[str] = None


class FoodPlanLogBody(BaseModel):
    quantity: Optional[float] = None   # override if modified
    mealType: Optional[str] = None


@router.get("")
async def list_food_plans(
    date: Optional[str] = Query(None),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}
    if date:
        query["plannedDate"] = date
    docs = await db.food_plans.find(query).sort("plannedTime", 1).to_list(500)
    return [doc_to_dict(d) for d in docs]


@router.post("", status_code=201)
async def create_food_plan(body: FoodPlanCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    # Dual-db lookup for food item
    item = await user_db.food_items.find_one({"_id": ObjectId(body.foodItemId), "deletedAt": None})
    if not item:
        item = await get_app_db().food_items.find_one({"_id": ObjectId(body.foodItemId), "deletedAt": None})
    if not item:
        raise HTTPException(404, "Food item not found")

    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "foodItemId": body.foodItemId,
        "foodName": item["name"],
        "brand": item.get("brand"),
        "quantity": body.quantity,
        "mealType": body.mealType,
        "plannedDate": body.plannedDate,
        "plannedTime": body.plannedTime,
        "notes": body.notes,
        "status": "pending",
        "foodLogId": None,
        "nutritionPerServing": item.get("nutritionPerServing", {}),
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await user_db.food_plans.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc_to_dict(doc)


@router.put("/{plan_id}")
async def update_food_plan(plan_id: str, body: FoodPlanUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.food_plans.find_one({"_id": ObjectId(plan_id), "userId": user_id, "deletedAt": None})
    if not existing:
        raise HTTPException(404, "Plan not found")

    upd: dict = {"updatedAt": datetime.utcnow()}
    for field in ("quantity", "mealType", "plannedDate", "plannedTime", "notes"):
        val = getattr(body, field)
        if val is not None:
            upd[field] = val

    await db.food_plans.update_one({"_id": ObjectId(plan_id)}, {"$set": upd})
    doc = await db.food_plans.find_one({"_id": ObjectId(plan_id)})
    return doc_to_dict(doc)


@router.delete("/{plan_id}", status_code=204)
async def delete_food_plan(plan_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.food_plans.update_one(
        {"_id": ObjectId(plan_id), "userId": user_id},
        {"$set": {"deletedAt": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Plan not found")


@router.post("/{plan_id}/log")
async def log_food_plan(plan_id: str, body: FoodPlanLogBody = FoodPlanLogBody(), user: dict = Depends(require_auth)):
    """Mark food plan as eaten and create a food_log entry."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    plan = await db.food_plans.find_one({"_id": ObjectId(plan_id), "userId": user_id, "deletedAt": None})
    if not plan:
        raise HTTPException(404, "Plan not found")

    qty = body.quantity if body.quantity is not None else plan["quantity"]
    meal_type = body.mealType or plan["mealType"]
    n = plan.get("nutritionPerServing") or {}
    snapshot = {k: round(v * qty, 2) for k, v in n.items()} if n else {}

    now = datetime.utcnow()
    log_doc = {
        "userId": user_id,
        "foodItemId": plan["foodItemId"],
        "foodName": plan["foodName"],
        "brand": plan.get("brand"),
        "loggedAt": now,
        "mealType": meal_type,
        "quantity": qty,
        "servingUnit": "serving",
        "nutritionSnapshot": snapshot,
        "notes": plan.get("notes") or "",
        "source": "food_plan",
        "foodPlanId": plan_id,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
    }
    result = await db.food_logs.insert_one(log_doc)
    await log_action(user_id, "food_log.created", "food_log", str(result.inserted_id), after=doc_to_dict(log_doc))

    await db.food_plans.update_one(
        {"_id": ObjectId(plan_id)},
        {"$set": {"status": "logged", "foodLogId": str(result.inserted_id), "updatedAt": now}}
    )
    return {"ok": True, "foodLogId": str(result.inserted_id)}


@router.post("/{plan_id}/skip")
async def skip_food_plan(plan_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    await db.food_plans.update_one(
        {"_id": ObjectId(plan_id), "userId": user_id},
        {"$set": {"status": "skipped", "updatedAt": datetime.utcnow()}}
    )
    return {"ok": True}


@router.get("/due")
async def get_due_food_plans(user: dict = Depends(require_auth)):
    """Return pending food plans whose planned time is within the last 10 minutes."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    now_minutes = now.hour * 60 + now.minute

    docs = await db.food_plans.find({
        "userId": user_id,
        "plannedDate": today,
        "status": "pending",
        "deletedAt": None,
    }).to_list(100)

    due = []
    for p in docs:
        try:
            ph, pm = map(int, p["plannedTime"].split(":"))
            plan_minutes = ph * 60 + pm
            if 0 <= now_minutes - plan_minutes < 10:
                due.append(doc_to_dict(p))
        except Exception:
            continue
    return due
