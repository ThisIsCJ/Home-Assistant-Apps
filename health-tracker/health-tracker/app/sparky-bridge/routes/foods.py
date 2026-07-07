"""
Food item search and CRUD — queries food_items directly from app_db / user_db.
"""
from datetime import datetime
from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from db_auth import require_user
from database import get_app_db, get_user_db
from mapping import ht_food_to_sparky, ht_food_to_sparky_variant, MEAL_TYPE_LIST
from serializer import to_dict

router = APIRouter()


async def _find_food(user_id: str, food_id: str) -> dict | None:
    """Look up a food item in user_db first, then app_db."""
    try:
        oid = ObjectId(food_id)
    except Exception:
        return None
    user_db = get_user_db(user_id)
    doc = await user_db.food_items.find_one({"_id": oid, "deletedAt": None})
    if not doc:
        doc = await get_app_db().food_items.find_one({"_id": oid, "deletedAt": None})
    return doc


async def _list_foods(user_id: str, q: str = "", limit: int = 50, skip: int = 0) -> list[dict]:
    """Merge global + user food items, optionally filtered by name."""
    app_db  = get_app_db()
    user_db = get_user_db(user_id)

    filt: dict = {"deletedAt": None}
    if q:
        filt["name"] = {"$regex": q, "$options": "i"}

    global_docs = await app_db.food_items.find({**filt, "scope": "global"}).to_list(limit)
    user_docs   = await user_db.food_items.find({**filt, "userId": user_id}).to_list(limit)

    seen, results = set(), []
    for doc in (user_docs + global_docs):
        sid = str(doc["_id"])
        if sid not in seen:
            seen.add(sid)
            results.append(doc)

    results.sort(key=lambda d: d.get("name", ""))
    return results[skip: skip + limit]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/foods")
async def recent_foods(user_info=Depends(require_user)):
    user, user_id = user_info
    items = await _list_foods(user_id, limit=20)
    foods = [ht_food_to_sparky(to_dict(f)) for f in items]
    return {"recentFoods": foods[:10], "topFoods": foods[10:]}


@router.get("/foods/foods-paginated")
async def search_foods(
    searchTerm: str = Query(""),
    currentPage: int = Query(1),
    itemsPerPage: int = Query(20),
    user_info=Depends(require_user),
):
    user, user_id = user_info
    skip  = (currentPage - 1) * itemsPerPage
    items = await _list_foods(user_id, q=searchTerm, limit=itemsPerPage, skip=skip)
    foods = [ht_food_to_sparky(to_dict(f)) for f in items]
    return {"foods": foods, "totalCount": len(foods)}


@router.get("/foods/food-variants")
async def food_variants(food_id: str = Query(...), user_info=Depends(require_user)):
    user, user_id = user_info
    doc = await _find_food(user_id, food_id)
    if not doc:
        return []
    return [ht_food_to_sparky_variant(to_dict(doc))]


@router.post("/foods")
async def create_food(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    user_db = get_user_db(user_id)
    now = datetime.utcnow()
    n = body.get("nutritionPerServing", {})
    doc = {
        "userId": user_id,
        "scope": "user",
        "name":  body.get("name", ""),
        "brand": body.get("brand"),
        "servingSize": {
            "amount": float(body.get("serving_size_value", 100)),
            "unit":   body.get("serving_size_unit", "g"),
        },
        "nutritionPerServing": {
            "calories":   float(n.get("calories", 0)),
            "proteinG":   float(n.get("protein", 0)),
            "carbsG":     float(n.get("carbs", 0)),
            "fatG":       float(n.get("fat", 0)),
            "fiberG":     float(n.get("fiber", 0)),
            "sugarG":     float(n.get("sugar", 0)),
            "sodiumMg":   float(n.get("sodium", 0)),
            "caffeineMg": float(n.get("caffeine", 0)),
        },
        "tags": [], "quickAction": False, "estimated": False, "customNutrition": {},
        "deletedAt": None, "createdAt": now, "updatedAt": now,
    }
    result = await user_db.food_items.insert_one(doc)
    doc["_id"] = result.inserted_id
    return ht_food_to_sparky(to_dict(doc))


@router.put("/foods/{food_id}")
async def update_food(food_id: str, body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    user_db = get_user_db(user_id)
    try:
        oid = ObjectId(food_id)
    except Exception:
        return {}
    update = {"updatedAt": datetime.utcnow()}
    if "name"  in body: update["name"]  = body["name"]
    if "brand" in body: update["brand"] = body["brand"]
    doc = await user_db.food_items.find_one_and_update(
        {"_id": oid, "userId": user_id, "deletedAt": None},
        {"$set": update}, return_document=True,
    )
    return ht_food_to_sparky(to_dict(doc)) if doc else {}


@router.delete("/foods/{food_id}")
async def delete_food(food_id: str, user_info=Depends(require_user)):
    user, user_id = user_info
    user_db = get_user_db(user_id)
    try:
        oid = ObjectId(food_id)
    except Exception:
        return {"message": "not found"}
    await user_db.food_items.update_one(
        {"_id": oid, "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    return {"message": "deleted"}


# ── Variant endpoints (HT has one serving size per item) ──────────────────────

@router.post("/foods/food-variants")
async def create_variant(body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    doc = await _find_food(user_id, body.get("food_id", ""))
    return ht_food_to_sparky_variant(to_dict(doc)) if doc else {}


@router.put("/foods/food-variants/{variant_id}")
async def update_variant(variant_id: str, body: dict, user_info=Depends(require_user)):
    user, user_id = user_info
    food_id = variant_id.removesuffix("_v")
    user_db = get_user_db(user_id)
    try:
        oid = ObjectId(food_id)
    except Exception:
        return {}
    update: dict = {"updatedAt": datetime.utcnow()}
    if "serving_size_value" in body or "serving_size_unit" in body:
        doc = await _find_food(user_id, food_id)
        ss  = (doc or {}).get("servingSize", {})
        update["servingSize"] = {
            "amount": float(body.get("serving_size_value", ss.get("amount", 100))),
            "unit":   body.get("serving_size_unit", ss.get("unit", "g")),
        }
    n_map = {"calories": "calories", "protein": "proteinG", "carbs": "carbsG",
              "fat": "fatG", "fiber": "fiberG", "sugar": "sugarG",
              "sodium": "sodiumMg", "caffeine": "caffeineMg"}
    nu_up = {ht_k: body[sp_k] for sp_k, ht_k in n_map.items() if sp_k in body}
    if nu_up:
        update["nutritionPerServing"] = nu_up
    doc = await user_db.food_items.find_one_and_update(
        {"_id": oid, "userId": user_id, "deletedAt": None},
        {"$set": update}, return_document=True,
    )
    return ht_food_to_sparky_variant(to_dict(doc)) if doc else {}


@router.delete("/foods/food-variants/{variant_id}")
async def delete_variant(variant_id: str, user_info=Depends(require_user)):
    return await delete_food(variant_id.removesuffix("_v"), user_info)


@router.get("/meal-types")
async def meal_types(user_info=Depends(require_user)):
    return MEAL_TYPE_LIST
