"""
Bearer-token validation against the shared MongoDB database.
Replaces the old auth_dep.py + HTTP call pattern — no HTTP hop needed.
"""
import hashlib
from datetime import datetime
from bson import ObjectId
from fastapi import HTTPException, Request
from database import get_app_db


async def require_user(request: Request) -> tuple[dict, str]:
    """
    Validate the incoming ht_ Bearer token.
    Returns (user_doc, user_id_str) on success, raises 401 on failure.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")
    if not token.startswith("ht_"):
        raise HTTPException(status_code=401, detail="Invalid token format — use a ht_ API key from Settings → API Tokens")

    app_db = get_app_db()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    token_doc = await app_db.api_tokens.find_one({"tokenHash": token_hash, "revokedAt": None})
    if not token_doc:
        raise HTTPException(status_code=401, detail="Invalid or revoked API token")

    user = await app_db.users.find_one({"_id": ObjectId(token_doc["userId"])})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Touch lastUsedAt (fire-and-forget — don't await, don't block)
    await app_db.api_tokens.update_one(
        {"_id": token_doc["_id"]},
        {"$set": {"lastUsedAt": datetime.utcnow()}},
    )

    return user, str(user["_id"])
