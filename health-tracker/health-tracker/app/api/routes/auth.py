import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from auth import ha
from database import get_app_db, ensure_user_indexes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


class HaLoginRequest(BaseModel):
    code: str
    client_id: str


async def _upsert_ha_user(ha_user: dict) -> dict:
    """Create/refresh the local user for a Home Assistant identity.

    HA accounts have no email or avatar, so those are only initialized on
    insert and stay editable in the app. Admin status follows HA: admins
    (and the owner) get the admin role added — never removed — so roles
    granted in the app survive an HA demotion.
    """
    db = get_app_db()
    subject = f"ha:{ha_user['id']}"
    is_admin = bool(ha_user.get("is_admin") or ha_user.get("is_owner"))
    groups = ["admin"] if is_admin else []

    now = datetime.utcnow()
    user = await db.users.find_one_and_update(
        {"externalSubject": subject},
        {
            "$set": {
                "displayName": ha_user.get("name") or "Home Assistant User",
                "groups": groups,
                "updatedAt": now,
            },
            "$setOnInsert": {
                "externalSubject": subject,
                "email": "",
                "avatarUrl": "",
                "roles": ["user"],
                "status": "active",
                "preferences": {
                    "timezone": "America/New_York",
                    "units": "imperial",
                    "defaultAiProviderId": None,
                    "aiModels": {
                        "vision": "gemini-1.5-pro",
                        "analysis": "gemini-1.5-flash",
                    },
                },
                "createdAt": now,
            },
        },
        upsert=True,
        return_document=True,
    )
    if is_admin and "admin" not in user.get("roles", []):
        user = await db.users.find_one_and_update(
            {"_id": user["_id"]},
            {"$addToSet": {"roles": "admin"}},
            return_document=True,
        )
    task = asyncio.create_task(ensure_user_indexes(str(user["_id"])))
    task.add_done_callback(
        lambda t: logger.error("User index creation failed: %s", t.exception()) if t.exception() else None
    )
    return user


@router.post("/ha/login")
async def ha_login(body: HaLoginRequest):
    tokens = await ha.exchange_code(body.code, body.client_id)
    try:
        ha_user = await ha.fetch_current_user(tokens["access_token"])
    finally:
        if tokens.get("refresh_token"):
            await ha.revoke_token(tokens["refresh_token"])

    user = await _upsert_ha_user(ha_user)
    session_token = ha.mint_session_token(user)
    name = user.get("displayName", "User")
    return {
        "token": session_token,
        "profile": {
            "sub": user["externalSubject"],
            "name": name,
            "email": user.get("email", ""),
            "avatarUrl": user.get("avatarUrl", ""),
            "groups": user.get("groups", []),
            "initials": "".join(p[0] for p in name.split()[:2]).upper() or "U",
        },
    }
