"""
Extracts the Bearer token from the Authorization header.

In API-key mode (recommended): Sparky sends the HT API token directly.
In session mode: we returned the HT API token at sign-in, so it arrives here
unchanged. Either way, we pass it straight to the HT API.
"""
from fastapi import HTTPException, Request


async def require_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")
    return token
