import hashlib
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from bson import ObjectId
from auth.middleware import require_auth
from database import get_app_db
from lib.serializer import doc_to_dict

router = APIRouter()

_PREFIX = "ht_"


def _generate_token() -> str:
    return _PREFIX + secrets.token_hex(32)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public_token_doc(doc: dict) -> dict:
    data = doc_to_dict(doc)
    data.pop("tokenHash", None)
    data.pop("tokenValue", None)
    return data


class TokenCreate(BaseModel):
    name: str


@router.get("/tokens")
async def list_tokens(user: dict = Depends(require_auth)):
    db = get_app_db()
    user_id = str(user["_id"])
    await db.api_tokens.update_many(
        {"userId": user_id, "tokenValue": {"$exists": True}},
        {"$unset": {"tokenValue": ""}},
    )
    cursor = db.api_tokens.find({"userId": user_id, "revokedAt": None}).sort("createdAt", -1)
    tokens = await cursor.to_list(100)
    return [_public_token_doc(t) for t in tokens]


@router.post("/tokens", status_code=201)
async def create_token(body: TokenCreate, user: dict = Depends(require_auth)):
    db = get_app_db()
    user_id = str(user["_id"])
    token = _generate_token()
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "name": body.name.strip() or "API Token",
        "tokenHash": _hash_token(token),
        "prefix": token[:10] + "…",
        "revokedAt": None,
        "lastUsedAt": None,
        "createdAt": now,
    }
    result = await db.api_tokens.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {**_public_token_doc(doc), "token": token}


@router.delete("/tokens/{token_id}", status_code=204)
async def revoke_token(token_id: str, user: dict = Depends(require_auth)):
    db = get_app_db()
    user_id = str(user["_id"])
    if not ObjectId.is_valid(token_id):
        raise HTTPException(404, "Token not found")
    result = await db.api_tokens.update_one(
        {"_id": ObjectId(token_id), "userId": user_id, "revokedAt": None},
        {"$set": {"revokedAt": datetime.utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Token not found")
