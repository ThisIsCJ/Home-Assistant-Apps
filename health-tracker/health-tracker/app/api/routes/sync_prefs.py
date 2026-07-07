"""
Per-user sync source preferences.

Controls which pipeline may write which metrics when multiple sources overlap:
- sparkyIgnoredMetrics: metric keys the Sparky bridge must not write for this
  user (read by sparky-bridge at ingest time — applies immediately).
- gdriveFileVariant: which Health Sync CSV variant to import when both a
  "… Samsung Health.csv" and "… Health Connect.csv" file exist for a metric.
"""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth.middleware import require_auth
from database import get_user_db

router = APIRouter()

_DEFAULTS = {"sparkyIgnoredMetrics": [], "gdriveFileVariant": "both"}


class SyncPreferences(BaseModel):
    sparkyIgnoredMetrics: list[str] = Field(default_factory=list, max_length=100)
    gdriveFileVariant: Literal["samsung_health", "health_connect", "both"] = "both"


@router.get("")
async def get_sync_preferences(user: dict = Depends(require_auth)):
    doc = await get_user_db(str(user["_id"])).sync_preferences.find_one({"_id": "sync_preferences"})
    if not doc:
        return _DEFAULTS
    return {
        "sparkyIgnoredMetrics": doc.get("sparkyIgnoredMetrics", []),
        "gdriveFileVariant": doc.get("gdriveFileVariant", "both"),
    }


@router.put("")
async def save_sync_preferences(body: SyncPreferences, user: dict = Depends(require_auth)):
    await get_user_db(str(user["_id"])).sync_preferences.update_one(
        {"_id": "sync_preferences"},
        {"$set": {**body.model_dump(), "updatedAt": datetime.utcnow()}},
        upsert=True,
    )
    return {"ok": True}
