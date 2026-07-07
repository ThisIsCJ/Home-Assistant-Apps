"""
Cookbook integration — syncs recipes from the cookbook API as food items.

Each recipe becomes one food item:
  name    = recipe title
  brand   = link to the recipe in the cookbook app ({base_url}/recipe/{id})
  nutrition = parsed from response fields (estimated if absent)

Endpoint: GET {base_url}/api/cookbook/recipes → {"recipes": [...]}
Auth:      Authorization: Bearer <key>
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime
from auth.middleware import require_auth
from database import get_user_db
from lib.encryption import encrypt, decrypt

router = APIRouter()


# ── Pydantic models ───────────────────────────────────────────────────────────

class CookbookConfigBody(BaseModel):
    url: str
    apiKey: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_raw_config(user_id: str) -> dict | None:
    return await get_user_db(user_id).cookbook_config.find_one({"userId": user_id})


async def _fetch_recipes(base_url: str, api_key: str) -> list[dict]:
    url = base_url.rstrip("/") + "/api/cookbook/recipes"
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        try:
            r = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        except httpx.ConnectError as e:
            raise HTTPException(502, f"Could not connect to cookbook API: {e}")
        except httpx.TimeoutException:
            raise HTTPException(504, "Cookbook API timed out")

        if r.status_code == 401:
            raise HTTPException(401, "Cookbook API rejected the key — check your API key")
        if r.status_code == 403:
            raise HTTPException(403, "Cookbook API denied access (403)")
        if not r.is_success:
            raise HTTPException(502, f"Cookbook API returned {r.status_code}")

        data = r.json()
        if not isinstance(data, dict) or "recipes" not in data:
            raise HTTPException(502, "Unexpected response shape from cookbook API")
        return data["recipes"]


def _pick(d: dict, *keys, default=None):
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return default


def _num(d: dict, *keys) -> float:
    v = _pick(d, *keys, default=0)
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def _parse_nutrition(recipe: dict) -> tuple[dict, bool]:
    """
    Try to extract per-serving nutrition from any common field layout.
    Returns (nutrition_dict, is_estimated) where is_estimated=True when no
    real values were found.
    """
    n = (_pick(recipe, "nutrition_per_serving", "nutritionPerServing",
               "nutrition", "macros", "nutrients") or {})
    if not isinstance(n, dict):
        n = {}

    nutrition = {
        "calories":   _num(n, "calories", "kcal", "energy")
                      or _num(recipe, "calories", "kcal"),
        "proteinG":   _num(n, "protein", "proteinG", "protein_g")
                      or _num(recipe, "protein"),
        "carbsG":     _num(n, "carbs", "carbsG", "carbohydrates", "carbs_g", "carbohydrates_g")
                      or _num(recipe, "carbs"),
        "fatG":       _num(n, "fat", "fatG", "fat_g", "total_fat")
                      or _num(recipe, "fat"),
        "fiberG":     _num(n, "fiber", "fiberG", "fiber_g")
                      or _num(recipe, "fiber"),
        "sugarG":     _num(n, "sugar", "sugarG", "sugars", "sugar_g"),
        "sodiumMg":   _num(n, "sodium", "sodiumMg", "sodium_mg")
                      or _num(recipe, "sodium"),
        "caffeineMg": 0.0,
    }
    estimated = not any(v > 0 for v in nutrition.values())
    return nutrition, estimated


def _parse_servings(recipe: dict) -> float:
    raw = recipe.get("servings") or "1"
    try:
        return max(1.0, float(str(raw).split()[0]))
    except (TypeError, ValueError):
        return 1.0


# ── Config endpoints ──────────────────────────────────────────────────────────

@router.get("/config")
async def get_config(user: dict = Depends(require_auth)):
    doc = await _get_raw_config(str(user["_id"]))
    if not doc:
        return None
    return {
        "url":           doc.get("url", ""),
        "hasApiKey":     bool(doc.get("encryptedApiKey")),
        "lastSyncedAt":  doc.get("lastSyncedAt"),
        "lastSyncStats": doc.get("lastSyncStats"),
    }


@router.put("/config", status_code=204)
async def save_config(body: CookbookConfigBody, user: dict = Depends(require_auth)):
    if not body.url.strip():
        raise HTTPException(400, "URL is required")
    if not body.apiKey.strip():
        raise HTTPException(400, "API key is required")
    user_id = str(user["_id"])
    now = datetime.utcnow()
    await get_user_db(user_id).cookbook_config.update_one(
        {"userId": user_id},
        {"$set": {
            "url":             body.url.rstrip("/"),
            "encryptedApiKey": encrypt(body.apiKey),
            "updatedAt":       now,
        }, "$setOnInsert": {"userId": user_id, "createdAt": now}},
        upsert=True,
    )


@router.delete("/config", status_code=204)
async def delete_config(user: dict = Depends(require_auth)):
    await get_user_db(str(user["_id"])).cookbook_config.delete_one({"userId": str(user["_id"])})


# ── Test connection ───────────────────────────────────────────────────────────

@router.post("/test")
async def test_connection(user: dict = Depends(require_auth)):
    doc = await _get_raw_config(str(user["_id"]))
    if not doc:
        raise HTTPException(400, "No cookbook configured — save a URL and API key first")
    recipes = await _fetch_recipes(doc["url"], decrypt(doc["encryptedApiKey"]))
    return {"ok": True, "recipeCount": len(recipes)}


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/import")
async def import_recipes(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    doc = await _get_raw_config(user_id)
    if not doc:
        raise HTTPException(400, "No cookbook configured")

    recipes = await _fetch_recipes(doc["url"], decrypt(doc["encryptedApiKey"]))

    db = get_user_db(user_id)
    now = datetime.utcnow()
    created = updated = skipped = 0
    errors: list[str] = []

    for recipe in recipes:
        try:
            title = (recipe.get("title") or "").strip()
            if not title:
                skipped += 1
                continue

            external_id  = str(recipe.get("id") or "").strip()
            tags         = list(recipe.get("tags") or [])
            servings     = _parse_servings(recipe)
            nutrition, estimated = _parse_nutrition(recipe)

            # Brand = link to this recipe in the cookbook app
            cookbook_url = f"{doc['url']}/recipe/{external_id}" if external_id else None

            # Match existing food item by cookbook external ID, fall back to name
            query = (
                {"userId": user_id, "deletedAt": None, "cookbookExternalId": external_id}
                if external_id else
                {"userId": user_id, "deletedAt": None, "name": title, "source": "cookbook"}
            )
            existing = await db.food_items.find_one(query)

            item_fields = {
                "name":                title,
                "brand":               cookbook_url,
                "servingSize":         {"amount": servings, "unit": "serving"},
                "nutritionPerServing": nutrition,
                "tags":                ["cookbook"] + tags,
                "source":              "cookbook",
                "scope":               "user",
                "cookbookExternalId":  external_id or title,
                "quickAction":         False,
                "estimated":           estimated,
                "customNutrition":     {},
                "deletedAt":           None,
                "updatedAt":           now,
                "userId":              user_id,
            }

            if existing:
                await db.food_items.update_one({"_id": existing["_id"]}, {"$set": item_fields})
                updated += 1
            else:
                item_fields["createdAt"] = now
                await db.food_items.insert_one(item_fields)
                created += 1

        except Exception as e:
            errors.append(f"{recipe.get('title') or '?'}: {e}")

    stats = {"created": created, "updated": updated, "skipped": skipped}
    await db.cookbook_config.update_one(
        {"userId": user_id},
        {"$set": {"lastSyncedAt": now, "lastSyncStats": stats}},
    )
    return {**stats, "errors": errors[:10]}
