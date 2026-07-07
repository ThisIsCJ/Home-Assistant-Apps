from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime
from auth.middleware import require_admin
from database import (
    get_active_url, mask_url, load_config_url, get_app_db,
    test_connection, reconnect_db, reset_db_config,
)

router = APIRouter()


class URLBody(BaseModel):
    url: str


async def _refresh_reference_data() -> dict:
    from main import SEED_METRIC_TYPES, _seed_global_exercises, _seed_global_foods

    db = get_app_db()
    now = datetime.utcnow()
    for m in SEED_METRIC_TYPES:
        await db.health_metric_types.update_one(
            {"key": m["key"], "scope": "global"},
            {
                "$set": {
                    **m,
                    "userId": None,
                    "scope": "global",
                    "valueType": "number",
                    "normalRangeMin": m.get("normalRangeMin"),
                    "normalRangeMax": m.get("normalRangeMax"),
                    "description": None,
                    "deletedAt": None,
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )
    await _seed_global_foods()
    await _seed_global_exercises()
    return {
        "metricTypes": await db.health_metric_types.count_documents({"scope": "global", "deletedAt": None}),
        "foods": await db.food_items.count_documents({"scope": "global", "deletedAt": None}),
        "exercises": await db.exercises.count_documents({"scope": "global", "deletedAt": None}),
    }


@router.get("")
async def get_db_config(user: dict = Depends(require_admin)):
    has_override = load_config_url() is not None
    return {
        "source": "config" if has_override else "env",
        "hasOverride": has_override,
        "maskedUrl": mask_url(get_active_url()),
    }


@router.post("/test")
async def test_db_url(body: URLBody, user: dict = Depends(require_admin)):
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "URL is required")
    return await test_connection(url)


@router.put("")
async def save_db_config(body: URLBody, user: dict = Depends(require_admin)):
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "URL is required")
    result = await test_connection(url)
    if not result["ok"]:
        raise HTTPException(400, f"Connection failed: {result['error']}")
    await reconnect_db(url)
    reference_data = await _refresh_reference_data()
    return {
        "ok": True,
        "source": "config",
        "maskedUrl": mask_url(url),
        "version": result["version"],
        "referenceData": reference_data,
    }


@router.delete("")
async def clear_db_config(user: dict = Depends(require_admin)):
    await reset_db_config()
    reference_data = await _refresh_reference_data()
    return {
        "ok": True,
        "source": "env",
        "maskedUrl": mask_url(get_active_url()),
        "referenceData": reference_data,
    }
