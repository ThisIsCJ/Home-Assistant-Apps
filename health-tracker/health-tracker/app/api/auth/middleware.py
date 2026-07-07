import hashlib
import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import httpx
from datetime import datetime, timedelta
from config import get_settings
from database import get_app_db, ensure_user_indexes
from bson import ObjectId

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer()

_jwks_cache: dict = {}
_jwks_fetched_at: datetime | None = None
_jwks_uri: str | None = None
_JWKS_TTL_SECONDS = 3600


async def _get_jwks_uri() -> str:
    global _jwks_uri
    if _jwks_uri:
        return _jwks_uri
    settings = get_settings()
    discovery_url = f"{settings.oidc_authority.rstrip('/')}/.well-known/openid-configuration"
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.get(discovery_url, timeout=10)
        r.raise_for_status()
        _jwks_uri = r.json()["jwks_uri"]
    return _jwks_uri


async def _get_jwks() -> dict:
    global _jwks_cache, _jwks_fetched_at
    now = datetime.utcnow()
    if _jwks_fetched_at is None or (now - _jwks_fetched_at).total_seconds() > _JWKS_TTL_SECONDS:
        jwks_uri = await _get_jwks_uri()
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(jwks_uri, timeout=10)
            r.raise_for_status()
            _jwks_cache = r.json()
            _jwks_fetched_at = now
    return _jwks_cache


async def _decode_oidc_token(token: str, header: dict) -> dict:
    global _jwks_fetched_at, _jwks_uri
    settings = get_settings()
    if not settings.oidc_authority:
        raise HTTPException(status_code=401, detail="OIDC auth is not configured")

    kid = header.get("kid")
    jwks = await _get_jwks()
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not key:
        _jwks_fetched_at = None  # force refresh on next call
        _jwks_uri = None
        raise HTTPException(status_code=401, detail="Token key not found")

    audience = settings.oidc_audience or settings.oidc_client_id or None
    decode_options = {"verify_exp": True, "verify_aud": bool(audience)}
    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audience,
            options=decode_options,
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {e}")

    return payload


async def _get_or_create_user(payload: dict) -> dict:
    import asyncio
    db = get_app_db()
    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    email = payload.get("email", "")
    name = payload.get("name") or payload.get("preferred_username") or email
    avatar = payload.get("picture") or payload.get("avatar", "")
    groups = payload.get("groups", [])

    now = datetime.utcnow()
    result = await db.users.find_one_and_update(
        {"externalSubject": subject},
        {
            "$set": {
                "email": email,
                "displayName": name,
                "avatarUrl": avatar,
                "groups": groups,
                "updatedAt": now,
            },
            "$setOnInsert": {
                "externalSubject": subject,
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
    task = asyncio.create_task(ensure_user_indexes(str(result["_id"])))
    task.add_done_callback(
        lambda t: logger.error("User index creation failed: %s", t.exception()) if t.exception() else None
    )
    return result


_DEV_TOKEN = "dev-token-local"
_DEV_PAYLOAD = {
    "sub": "dev-user-local",
    "email": "dev@localhost",
    "name": "Dev User",
    "groups": ["admin"],
}


async def _check_api_token(token: str) -> dict | None:
    """Look up an ht_ prefixed API token. Returns the user doc or None."""
    if not token.startswith("ht_"):
        return None
    db = get_app_db()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    doc = await db.api_tokens.find_one({"tokenHash": token_hash, "revokedAt": None})
    if not doc:
        return None
    await db.api_tokens.update_one({"_id": doc["_id"]}, {"$set": {"lastUsedAt": datetime.utcnow()}})
    user = await db.users.find_one({"_id": ObjectId(doc["userId"])})
    return user


async def _get_session_user(token: str) -> dict:
    """Resolve a session JWT we issued (Home Assistant login) to its user."""
    from auth.ha import verify_session_token

    payload = verify_session_token(token)
    db = get_app_db()
    user = await db.users.find_one({"externalSubject": payload.get("sub")})
    if not user:
        raise HTTPException(status_code=401, detail="Session user no longer exists — sign in again")
    return user


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    settings = get_settings()
    token = credentials.credentials
    if settings.environment == "development" and token == _DEV_TOKEN:
        return await _get_or_create_user(_DEV_PAYLOAD)
    if token.startswith("ht_"):
        user = await _check_api_token(token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid or revoked API token")
        return user

    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token format")

    # Our own session tokens (Home Assistant login) are HS256; OIDC access
    # tokens are RS256 — the algorithm routes the token to its verifier.
    if header.get("alg") == "HS256":
        return await _get_session_user(token)
    payload = await _decode_oidc_token(token, header)
    user = await _get_or_create_user(payload)
    return user


async def require_admin(user: dict = Depends(require_auth)) -> dict:
    if "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
