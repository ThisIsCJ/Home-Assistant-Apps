"""
Auth endpoints for the Sparky companion app.

API-key mode (recommended): user pastes their ht_ token directly into Sparky —
no login flow needed, these endpoints are never called.

Session mode: Sparky POSTs email/password here, bridge validates against
BRIDGE_EMAIL / BRIDGE_PASSWORD env vars, returns ht_api_token as the session
token. Subsequent requests work identically to API-key mode.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import get_settings

router = APIRouter()


class SignInBody(BaseModel):
    email: str
    password: str


@router.get("/auth/settings")
async def auth_settings():
    return {}


@router.get("/auth/mfa-factors")
async def mfa_factors(email: str = ""):
    return {"mfa_totp_enabled": False, "mfa_email_enabled": False}


@router.post("/auth/sign-in/email")
async def sign_in(body: SignInBody):
    s = get_settings()
    if body.email != s.bridge_email or body.password != s.bridge_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not s.ht_api_token:
        raise HTTPException(status_code=500, detail="HT_API_TOKEN not configured for session mode")
    return {
        "token": s.ht_api_token,
        "user":  {"email": body.email, "role": "user"},
    }


@router.post("/auth/sign-out")
async def sign_out():
    return {}
