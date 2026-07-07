"""Admin-only endpoints for system management."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from auth.middleware import require_admin
from database import get_app_db

router = APIRouter()

_VALID_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR"}
_LEVEL_NUMS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}


class SparkyConfigUpdate(BaseModel):
    logLevel: str


# ── Sparky Bridge logs ────────────────────────────────────────────────────────

@router.get("/sparky/logs")
async def get_sparky_logs(
    level: str = Query(None, description="Minimum level: DEBUG, INFO, WARNING, ERROR"),
    source: str = Query(None, description="Filter by source (e.g. health-data, startup)"),
    limit: int = Query(100, le=500),
    skip: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
):
    db = get_app_db()
    query: dict = {}
    if level:
        level_num = _LEVEL_NUMS.get(level.upper())
        if level_num is not None:
            query["levelNum"] = {"$gte": level_num}
    if source:
        query["source"] = source

    total = await db.sparky_logs.count_documents(query)
    cursor = db.sparky_logs.find(query).sort("timestamp", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)

    return {
        "logs": [
            {
                "id": str(doc["_id"]),
                "timestamp": doc["timestamp"].isoformat() + "Z",
                "level": doc.get("level", "INFO"),
                "levelNum": doc.get("levelNum", 20),
                "source": doc.get("source", "sparky-bridge"),
                "message": doc.get("message", ""),
                "details": doc.get("details"),
            }
            for doc in docs
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.delete("/sparky/logs", status_code=204)
async def clear_sparky_logs(user: dict = Depends(require_admin)):
    db = get_app_db()
    await db.sparky_logs.delete_many({})


# ── Sparky Bridge config ──────────────────────────────────────────────────────

@router.get("/sparky/config")
async def get_sparky_config(user: dict = Depends(require_admin)):
    db = get_app_db()
    doc = await db.sparky_config.find_one({"_id": "log_config"})
    return {
        "logLevel": doc.get("logLevel", "INFO") if doc else "INFO",
        "updatedAt": doc["updatedAt"].isoformat() + "Z" if doc and doc.get("updatedAt") else None,
    }


@router.put("/sparky/config")
async def update_sparky_config(body: SparkyConfigUpdate, user: dict = Depends(require_admin)):
    level = body.logLevel.upper()
    if level not in _VALID_LEVELS:
        raise HTTPException(400, f"Invalid log level. Must be one of: {', '.join(sorted(_VALID_LEVELS))}")
    db = get_app_db()
    now = datetime.utcnow()
    await db.sparky_config.update_one(
        {"_id": "log_config"},
        {"$set": {"logLevel": level, "updatedAt": now}},
        upsert=True,
    )
    return {"logLevel": level, "updatedAt": now.isoformat() + "Z"}
