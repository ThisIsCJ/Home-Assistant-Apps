"""Thin async wrapper around the Health Tracker API."""
import httpx
from config import get_settings


def _base() -> str:
    return get_settings().ht_server_url.rstrip("/")


def _hdrs(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def ht_get(path: str, token: str, params: dict | None = None) -> dict | list:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{_base()}{path}", headers=_hdrs(token), params=params or {})
        r.raise_for_status()
        if not r.content:
            return {}
        return r.json()


async def ht_post(path: str, token: str, body: dict) -> dict | list:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{_base()}{path}", headers=_hdrs(token), json=body)
        r.raise_for_status()
        if not r.content:
            return {}
        return r.json()


async def ht_put(path: str, token: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.put(f"{_base()}{path}", headers=_hdrs(token), json=body)
        r.raise_for_status()
        return r.json()


async def ht_delete(path: str, token: str) -> None:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(f"{_base()}{path}", headers=_hdrs(token))
        r.raise_for_status()
