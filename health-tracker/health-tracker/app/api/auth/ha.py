"""Home Assistant authentication.

Login flow (HA's native OAuth2 / IndieAuth flow, same as the companion apps):
  1. The SPA redirects the browser to <ha_url>/auth/authorize.
  2. HA redirects back to /auth/callback with an authorization code.
  3. The SPA posts the code to /api/auth/ha/login.
  4. We exchange the code at <ha>/auth/token (server-side, no CORS),
     fetch the user's identity over HA's WebSocket API (auth/current_user),
     then mint our own HS256 session JWT signed with SECRET_KEY.
  5. The SPA uses that session JWT as its Bearer token; the HA tokens are
     revoked immediately — HA is only the identity provider.
"""

import json
import logging
from datetime import datetime, timedelta

import httpx
import websockets
from fastapi import HTTPException
from jose import jwt, JWTError

from config import get_settings

logger = logging.getLogger(__name__)

SESSION_ISSUER = "health-tracker"


def _ha_base_url() -> str:
    settings = get_settings()
    url = (settings.ha_internal_url or settings.ha_url).rstrip("/")
    if not url:
        raise HTTPException(status_code=503, detail="Home Assistant auth is not configured (ha_url)")
    return url


async def exchange_code(code: str, client_id: str) -> dict:
    """Exchange an authorization code for HA access/refresh tokens.

    client_id must be the exact value the SPA used at /auth/authorize
    (its origin URL) — HA binds the code to it.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.post(
            f"{_ha_base_url()}/auth/token",
            data={"grant_type": "authorization_code", "code": code, "client_id": client_id},
            timeout=15,
        )
    if r.status_code != 200:
        logger.warning("HA token exchange failed (%s): %s", r.status_code, r.text[:200])
        raise HTTPException(status_code=401, detail="Home Assistant rejected the authorization code")
    return r.json()


async def revoke_token(refresh_token: str) -> None:
    """Best-effort revoke — we only needed the token to identify the user."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            await client.post(
                f"{_ha_base_url()}/auth/token",
                data={"action": "revoke", "token": refresh_token},
                timeout=10,
            )
    except Exception as e:  # noqa: BLE001 — revocation failure must not block login
        logger.warning("HA token revoke failed: %s", e)


async def fetch_current_user(access_token: str) -> dict:
    """Identify the token's user via HA's WebSocket API (no REST equivalent).

    Returns HA's auth/current_user result: {id, name, is_owner, is_admin, ...}.
    """
    base = _ha_base_url()
    ws_url = base.replace("http", "ws", 1) + "/api/websocket"
    try:
        async with websockets.connect(ws_url, open_timeout=10, close_timeout=5) as ws:
            msg = json.loads(await ws.recv())
            if msg.get("type") != "auth_required":
                raise HTTPException(status_code=502, detail="Unexpected Home Assistant handshake")
            await ws.send(json.dumps({"type": "auth", "access_token": access_token}))
            msg = json.loads(await ws.recv())
            if msg.get("type") != "auth_ok":
                raise HTTPException(status_code=401, detail="Home Assistant rejected the access token")
            await ws.send(json.dumps({"id": 1, "type": "auth/current_user"}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == 1 and msg.get("type") == "result":
                    if not msg.get("success"):
                        raise HTTPException(status_code=502, detail="Home Assistant current_user query failed")
                    return msg["result"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error("HA websocket user lookup failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach Home Assistant to identify the user")


def mint_session_token(user: dict) -> str:
    """Issue our own session JWT for a user document."""
    settings = get_settings()
    now = datetime.utcnow()
    payload = {
        "iss": SESSION_ISSUER,
        "sub": user["externalSubject"],
        "name": user.get("displayName", ""),
        "iat": now,
        "exp": now + timedelta(days=settings.session_ttl_days),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def verify_session_token(token: str) -> dict:
    """Validate a session JWT we issued. Raises 401 on any failure."""
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            issuer=SESSION_ISSUER,
            options={"verify_aud": False},
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Session token invalid: {e}")
