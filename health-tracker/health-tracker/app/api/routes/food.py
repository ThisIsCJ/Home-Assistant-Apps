import asyncio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timedelta
from bson import ObjectId
from auth.middleware import require_auth
from database import get_app_db, get_user_db
from lib.audit import log_action
from lib.serializer import doc_to_dict
from config import get_settings

router = APIRouter()


# ── Pydantic models ───────────────────────────────────────────────────────────

class ServingSize(BaseModel):
    amount: float
    unit: str = "g"


class Nutrition(BaseModel):
    calories: float = 0
    proteinG: float = 0
    carbsG: float = 0
    fatG: float = 0
    fiberG: float = 0
    sugarG: float = 0
    sodiumMg: float = 0
    caffeineMg: float = 0


class FoodItemCreate(BaseModel):
    name: str
    brand: Optional[str] = None
    servingSize: ServingSize
    nutritionPerServing: Nutrition
    tags: list[str] = []
    quickAction: bool = False
    estimated: bool = False
    customNutrition: Optional[dict] = {}


class FoodItemUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    servingSize: Optional[ServingSize] = None
    nutritionPerServing: Optional[Nutrition] = None
    tags: Optional[list[str]] = None
    quickAction: Optional[bool] = None
    estimated: Optional[bool] = None
    customNutrition: Optional[dict] = None


class FoodMealItem(BaseModel):
    foodItemId: str
    quantity: float = 1.0
    foodName: Optional[str] = None


class FoodMealCreate(BaseModel):
    name: str
    description: Optional[str] = None
    mealType: str = "other"
    items: list[FoodMealItem] = []
    quickAction: bool = False


class FoodMealUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    mealType: Optional[str] = None
    items: Optional[list[FoodMealItem]] = None
    quickAction: Optional[bool] = None


class LogMealBody(BaseModel):
    loggedAt: Optional[datetime] = None
    mealType: Optional[str] = None


class FoodLogCreate(BaseModel):
    foodItemId: str
    loggedAt: Optional[datetime] = None
    mealType: str = "other"
    quantity: float = 1.0
    servingUnit: str = "serving"
    notes: str = ""


class FoodLogUpdate(BaseModel):
    mealType: Optional[str] = None
    quantity: Optional[float] = None
    servingUnit: Optional[str] = None
    notes: Optional[str] = None
    loggedAt: Optional[datetime] = None


# ── Food items ────────────────────────────────────────────────────────────────

@router.get("/items")
async def search_food_items(
    q: str = Query("", max_length=200),
    scope: str = Query("all"),
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    app_db = get_app_db()
    user_db = get_user_db(user_id)

    if scope == "global":
        q_filter = {"deletedAt": None}
        if q:
            q_filter["$text"] = {"$search": q}
        items = await app_db.food_items.find(q_filter).skip(skip).limit(limit).to_list(limit)
    elif scope == "user":
        q_filter = {"deletedAt": None}
        if q:
            q_filter["$text"] = {"$search": q}
        items = await user_db.food_items.find(q_filter).skip(skip).limit(limit).to_list(limit)
    else:  # all
        app_filter = {"deletedAt": None}
        user_filter = {"deletedAt": None}
        if q:
            app_filter["$text"] = {"$search": q}
            user_filter["$text"] = {"$search": q}
        app_items, user_items = await asyncio.gather(
            app_db.food_items.find(app_filter).limit(limit).to_list(limit),
            user_db.food_items.find(user_filter).limit(limit).to_list(limit),
        )
        # personal items first, then global
        seen = set()
        items = []
        for item in (user_items + app_items):
            sid = str(item["_id"])
            if sid not in seen:
                seen.add(sid)
                items.append(item)
        items = items[:limit]

    return [doc_to_dict(i) for i in items]


@router.post("/items", status_code=201)
async def create_food_item(body: FoodItemCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "scope": "user",
        "name": body.name,
        "brand": body.brand,
        "servingSize": body.servingSize.model_dump(),
        "nutritionPerServing": body.nutritionPerServing.model_dump(),
        "tags": body.tags,
        "quickAction": body.quickAction,
        "estimated": body.estimated,
        "source": "manual",
        "confidence": 1.0,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
        "updatedBy": user_id,
    }
    result = await db.food_items.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "food_item.created", "food_item", str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


def _validate_object_id(id_str: str) -> None:
    try:
        ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID format")


@router.get("/items/{item_id}")
async def get_food_item(item_id: str, user: dict = Depends(require_auth)):
    _validate_object_id(item_id)
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    doc = await user_db.food_items.find_one({"_id": ObjectId(item_id), "deletedAt": None})
    if not doc:
        doc = await get_app_db().food_items.find_one({"_id": ObjectId(item_id), "deletedAt": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Food item not found")
    return doc_to_dict(doc)


@router.put("/items/{item_id}")
async def update_food_item(item_id: str, body: FoodItemUpdate, user: dict = Depends(require_auth)):
    _validate_object_id(item_id)
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    existing = await user_db.food_items.find_one({"_id": ObjectId(item_id), "deletedAt": None})
    if not existing:
        if await get_app_db().food_items.find_one({"_id": ObjectId(item_id), "deletedAt": None}):
            raise HTTPException(status_code=403, detail="Global food items cannot be modified by users")
        raise HTTPException(status_code=404, detail="Food item not found")

    update: dict = {"updatedAt": datetime.utcnow(), "updatedBy": user_id}
    if body.name is not None:
        update["name"] = body.name
    if body.brand is not None:
        update["brand"] = body.brand
    if body.servingSize is not None:
        update["servingSize"] = body.servingSize.model_dump()
    if body.nutritionPerServing is not None:
        update["nutritionPerServing"] = body.nutritionPerServing.model_dump()
    if body.tags is not None:
        update["tags"] = body.tags
    if body.quickAction is not None:
        update["quickAction"] = body.quickAction
    if body.estimated is not None:
        update["estimated"] = body.estimated

    result = await user_db.food_items.find_one_and_update(
        {"_id": ObjectId(item_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "food_item.updated", "food_item", item_id, before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/items/{item_id}", status_code=204)
async def delete_food_item(item_id: str, user: dict = Depends(require_auth)):
    _validate_object_id(item_id)
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    result = await user_db.food_items.find_one_and_update(
        {"_id": ObjectId(item_id), "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        if await get_app_db().food_items.find_one({"_id": ObjectId(item_id), "deletedAt": None}):
            raise HTTPException(status_code=403, detail="Global food items cannot be deleted by users")
        raise HTTPException(status_code=404, detail="Food item not found")
    await log_action(user_id, "food_item.deleted", "food_item", item_id)


# ── Food logs ─────────────────────────────────────────────────────────────────

@router.get("/logs")
async def get_food_logs(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    meal_type: Optional[str] = Query(None),
    limit: int = 100,
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}

    if date_from or date_to:
        query["loggedAt"] = {}
        if date_from:
            query["loggedAt"]["$gte"] = datetime.fromisoformat(date_from)
        if date_to:
            query["loggedAt"]["$lte"] = datetime.fromisoformat(date_to)
    if meal_type:
        query["mealType"] = meal_type

    cursor = db.food_logs.find(query).sort("loggedAt", -1).limit(limit)
    logs = await cursor.to_list(length=limit)
    return [doc_to_dict(l) for l in logs]


@router.post("/logs", status_code=201)
async def create_food_log(body: FoodLogCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    # Dual-db lookup for food item
    item = await user_db.food_items.find_one({"_id": ObjectId(body.foodItemId), "deletedAt": None})
    if not item:
        item = await get_app_db().food_items.find_one({"_id": ObjectId(body.foodItemId), "deletedAt": None})
    if not item:
        raise HTTPException(status_code=404, detail="Food item not found")

    # Scale nutrition by quantity
    n = item["nutritionPerServing"]
    qty = body.quantity
    snapshot = {k: round(v * qty, 2) for k, v in n.items()}

    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "foodItemId": body.foodItemId,
        "foodName": item["name"],
        "brand": item.get("brand"),
        "loggedAt": body.loggedAt or now,
        "mealType": body.mealType,
        "quantity": body.quantity,
        "servingUnit": body.servingUnit,
        "nutritionSnapshot": snapshot,
        "notes": body.notes,
        "source": "manual",
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
    }
    result = await user_db.food_logs.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "food_log.created", "food_log", str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/logs/{log_id}")
async def update_food_log(log_id: str, body: FoodLogUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.food_logs.find_one({"_id": ObjectId(log_id), "userId": user_id, "deletedAt": None})
    if not existing:
        raise HTTPException(status_code=404, detail="Log entry not found")

    update: dict = {"updatedAt": datetime.utcnow()}
    if body.mealType is not None:
        update["mealType"] = body.mealType
    if body.notes is not None:
        update["notes"] = body.notes
    if body.loggedAt is not None:
        update["loggedAt"] = body.loggedAt

    if body.quantity is not None:
        update["quantity"] = body.quantity
        # Recalculate nutrition snapshot — try user_db first, then app_db
        item = await db.food_items.find_one({"_id": ObjectId(existing["foodItemId"])})
        if not item:
            item = await get_app_db().food_items.find_one({"_id": ObjectId(existing["foodItemId"])})
        if item:
            n = item["nutritionPerServing"]
            update["nutritionSnapshot"] = {k: round(v * body.quantity, 2) for k, v in n.items()}

    result = await db.food_logs.find_one_and_update(
        {"_id": ObjectId(log_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "food_log.updated", "food_log", log_id, before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/logs/{log_id}", status_code=204)
async def delete_food_log(log_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.food_logs.find_one_and_update(
        {"_id": ObjectId(log_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Log entry not found")
    await log_action(user_id, "food_log.deleted", "food_log", log_id)


@router.get("/summary")
async def get_nutrition_summary(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    tz_offset: int = Query(0, description="Browser getTimezoneOffset() value (minutes west of UTC)"),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)

    # Convert the local-date boundaries to UTC.
    # JS getTimezoneOffset() is minutes *west* of UTC (positive for UTC-N, negative for UTC+N).
    # local midnight → UTC = local midnight + tz_offset minutes.
    day_local_midnight = datetime.fromisoformat(date).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = day_local_midnight + timedelta(minutes=tz_offset)
    day_end   = day_start + timedelta(days=1) - timedelta(microseconds=1)

    cursor = db.food_logs.find({
        "userId": user_id,
        "loggedAt": {"$gte": day_start, "$lte": day_end},
        "deletedAt": None,
    })
    logs = await cursor.to_list(length=500)

    totals = {"calories": 0, "proteinG": 0, "carbsG": 0, "fatG": 0, "fiberG": 0, "sugarG": 0, "sodiumMg": 0, "caffeineMg": 0}
    meals: dict = {"breakfast": [], "lunch": [], "dinner": [], "snack": [], "other": []}

    for log in logs:
        snap = log.get("nutritionSnapshot", {})
        for k in totals:
            totals[k] = round(totals[k] + snap.get(k, 0), 2)
        meal = log.get("mealType", "other")
        if meal not in meals:
            meal = "other"
        meals[meal].append(doc_to_dict(log))

    return {"date": date, "totals": totals, "meals": meals, "logCount": len(logs)}


@router.get("/weekly")
async def get_weekly_summary(
    week_start: Optional[str] = Query(None, description="Monday date YYYY-MM-DD; defaults to current week"),
    tz_offset: int = Query(0, description="Browser getTimezoneOffset() value (minutes west of UTC)"),
    user: dict = Depends(require_auth),
):
    """Return 7-day nutrition totals starting from week_start (Monday)."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)

    if week_start:
        start_local = datetime.fromisoformat(week_start).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        # Derive current local date from UTC + offset
        today_local = datetime.utcnow() - timedelta(minutes=tz_offset)
        start_local = (today_local - timedelta(days=today_local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

    # Convert local week boundaries to UTC
    start_utc = start_local + timedelta(minutes=tz_offset)
    end_utc   = start_utc + timedelta(days=7)

    logs = await db.food_logs.find({
        "userId": user_id,
        "loggedAt": {"$gte": start_utc, "$lt": end_utc},
        "deletedAt": None,
    }).to_list(5000)

    days = []
    for i in range(7):
        day_local = start_local + timedelta(days=i)
        day_str   = day_local.strftime("%Y-%m-%d")
        day_label = day_local.strftime("%a")
        totals = {"calories": 0.0, "proteinG": 0.0, "carbsG": 0.0, "fatG": 0.0}
        for log in logs:
            # Convert stored UTC loggedAt back to local date for grouping
            log_local_date = (log["loggedAt"] - timedelta(minutes=tz_offset)).strftime("%Y-%m-%d")
            if log_local_date == day_str:
                snap = log.get("nutritionSnapshot", {})
                for k in totals:
                    totals[k] = round(totals[k] + snap.get(k, 0), 1)
        days.append({"date": day_str, "label": day_label, "totals": totals})

    avg = {k: round(sum(d["totals"][k] for d in days) / 7, 1) for k in ("calories", "proteinG", "carbsG", "fatG")}
    return {"weekStart": start_local.strftime("%Y-%m-%d"), "days": days, "weeklyAvg": avg}


# ── Food meals (templates) ────────────────────────────────────────────────────

@router.get("/meals")
async def list_food_meals(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    cursor = db.food_meals.find({"userId": user_id, "deletedAt": None}).sort("name", 1)
    meals = await cursor.to_list(200)
    return [doc_to_dict(m) for m in meals]


@router.post("/meals", status_code=201)
async def create_food_meal(body: FoodMealCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "name": body.name,
        "description": body.description,
        "mealType": body.mealType,
        "items": [i.model_dump() for i in body.items],
        "quickAction": body.quickAction,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
    }
    result = await db.food_meals.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "food_meal.created", "food_meal", str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/meals/{meal_id}")
async def update_food_meal(meal_id: str, body: FoodMealUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.food_meals.find_one({"_id": ObjectId(meal_id), "userId": user_id, "deletedAt": None})
    if not existing:
        raise HTTPException(status_code=404, detail="Meal not found")

    update: dict = {"updatedAt": datetime.utcnow()}
    if body.name is not None:
        update["name"] = body.name
    if body.description is not None:
        update["description"] = body.description
    if body.mealType is not None:
        update["mealType"] = body.mealType
    if body.items is not None:
        update["items"] = [i.model_dump() for i in body.items]
    if body.quickAction is not None:
        update["quickAction"] = body.quickAction

    result = await db.food_meals.find_one_and_update(
        {"_id": ObjectId(meal_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "food_meal.updated", "food_meal", meal_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/meals/{meal_id}", status_code=204)
async def delete_food_meal(meal_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.food_meals.find_one_and_update(
        {"_id": ObjectId(meal_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Meal not found")
    await log_action(user_id, "food_meal.deleted", "food_meal", meal_id)


# ── USDA FoodData Central integration ────────────────────────────────────────

_USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

# Nutrient IDs we care about in the USDA database
_NUTRIENT_MAP = {
    1008: "calories",    # Energy (kcal)
    1003: "proteinG",
    1005: "carbsG",      # Carbohydrates, by difference
    1004: "fatG",        # Total lipid (fat)
    1079: "fiberG",      # Fiber, total dietary
    2000: "sugarG",      # Sugars, total
    1093: "sodiumMg",
    1057: "caffeineMg",
}

# Also catch "Total Sugars" nutrient id 1063 used in some data types
_NUTRIENT_MAP[1063] = "sugarG"


def _extract_nutrients(food_nutrients: list) -> dict:
    """Pull nutrition values from a USDA nutrients list."""
    out = {v: 0.0 for v in _NUTRIENT_MAP.values()}
    for n in food_nutrients:
        nid = n.get("nutrientId") or n.get("nutrient", {}).get("id")
        val = n.get("value") or n.get("amount") or 0
        if nid in _NUTRIENT_MAP:
            out[_NUTRIENT_MAP[nid]] = round(float(val), 2)
    return out


class USDAImportBody(BaseModel):
    fdcId: int


@router.get("/usda/search")
async def usda_search(
    q: str = Query(..., min_length=2, max_length=200),
    user: dict = Depends(require_auth),
):
    api_key = get_settings().usda_api_key
    if not api_key:
        raise HTTPException(503, "USDA API key not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{_USDA_BASE}/foods/search",
            params={"query": q, "api_key": api_key, "pageSize": 25, "dataType": "Branded,Foundation,SR Legacy"},
        )
    if resp.status_code != 200:
        raise HTTPException(502, "USDA API error")
    data = resp.json()
    results = []
    for f in data.get("foods", []):
        nutrients = _extract_nutrients(f.get("foodNutrients", []))
        results.append({
            "fdcId": f["fdcId"],
            "name": f.get("description", ""),
            "brand": f.get("brandOwner") or f.get("brandName") or None,
            "dataType": f.get("dataType", ""),
            "servingSize": f.get("servingSize"),
            "servingSizeUnit": f.get("servingSizeUnit") or "g",
            "nutrients": nutrients,
        })
    return results


@router.post("/usda/import", status_code=201)
async def usda_import(body: USDAImportBody, user: dict = Depends(require_auth)):
    """Fetch full USDA food detail and save as a user food item."""
    api_key = get_settings().usda_api_key
    if not api_key:
        raise HTTPException(503, "USDA API key not configured")
    user_id = str(user["_id"])
    db = get_user_db(user_id)

    # Check if already imported
    existing = await db.food_items.find_one({"fdcId": body.fdcId, "userId": user_id, "deletedAt": None})
    if existing:
        return doc_to_dict(existing)

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_USDA_BASE}/food/{body.fdcId}", params={"api_key": api_key})
    if resp.status_code != 200:
        raise HTTPException(502, "USDA API error fetching food detail")
    f = resp.json()

    nutrients = _extract_nutrients(f.get("foodNutrients", []))

    # Determine serving size — prefer labelNutrients householdServingFullText or portions
    serving_amount = 100.0
    serving_unit = "g"
    portions = f.get("foodPortions") or []
    if portions:
        p = portions[0]
        serving_amount = round(float(p.get("gramWeight", 100)), 1)
        serving_unit = p.get("measureUnit", {}).get("abbreviation") or p.get("portionDescription") or "g"
        if len(serving_unit) > 20:
            serving_unit = "serving"
    elif f.get("servingSize"):
        serving_amount = round(float(f["servingSize"]), 1)
        serving_unit = (f.get("servingSizeUnit") or "g").lower()

    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "scope": "user",
        "name": f.get("description", "Unknown"),
        "brand": f.get("brandOwner") or f.get("brandName") or None,
        "servingSize": {"amount": serving_amount, "unit": serving_unit},
        "nutritionPerServing": nutrients,
        "tags": [],
        "quickAction": False,
        "estimated": False,
        "source": "usda",
        "fdcId": body.fdcId,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": user_id,
        "updatedBy": user_id,
    }
    result = await db.food_items.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "food_item.imported", "food_item", str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.post("/meals/{meal_id}/log", status_code=201)
async def log_food_meal(meal_id: str, body: LogMealBody = None, user: dict = Depends(require_auth)):
    """Log all food items in a meal template at once."""
    if body is None:
        body = LogMealBody()
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    app_db = get_app_db()
    meal = await user_db.food_meals.find_one({"_id": ObjectId(meal_id), "userId": user_id, "deletedAt": None})
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")

    now = body.loggedAt or datetime.utcnow()
    meal_type = body.mealType or meal.get("mealType", "other")
    logged = []

    for item in meal.get("items", []):
        try:
            oid = ObjectId(item["foodItemId"])
        except Exception:
            continue

        # Dual-db lookup for food item
        food_item = await user_db.food_items.find_one({"_id": oid, "deletedAt": None})
        if not food_item:
            food_item = await app_db.food_items.find_one({"_id": oid, "deletedAt": None})
        if not food_item:
            continue

        qty = item.get("quantity", 1.0)
        n = food_item["nutritionPerServing"]
        snapshot = {k: round(v * qty, 2) for k, v in n.items()}

        doc = {
            "userId": user_id,
            "foodItemId": item["foodItemId"],
            "foodName": food_item["name"],
            "brand": food_item.get("brand"),
            "loggedAt": now,
            "mealType": meal_type,
            "quantity": qty,
            "servingUnit": "serving",
            "nutritionSnapshot": snapshot,
            "notes": f"Logged via meal: {meal['name']}",
            "mealTemplateId": meal_id,
            "source": "manual",
            "deletedAt": None,
            "createdAt": now,
            "updatedAt": now,
            "createdBy": user_id,
        }
        result = await user_db.food_logs.insert_one(doc)
        doc["_id"] = result.inserted_id
        await log_action(user_id, "food_log.created", "food_log", str(result.inserted_id), after=doc_to_dict(doc))
        logged.append(item["foodItemId"])

    return {"mealName": meal["name"], "logged": len(logged)}
