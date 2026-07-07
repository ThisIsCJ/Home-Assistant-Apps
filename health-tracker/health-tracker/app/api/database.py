import json
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import get_settings
from typing import Optional

_client: Optional[AsyncIOMotorClient] = None
_active_url: Optional[str] = None

_APP_DB = "healthtracker_app"
_USER_DB_PREFIX = "healthtracker_u_"


# ── Config-file helpers ────────────────────────────────────────────────────────

def _config_file() -> Path:
    return Path(get_settings().config_dir) / "db-config.json"


def load_config_url() -> Optional[str]:
    """Return the saved MongoDB URL override, or None if not set."""
    try:
        f = _config_file()
        if f.exists():
            return json.loads(f.read_text()).get("mongodbUrl") or None
    except Exception:
        pass
    return None


def save_config_url(url: Optional[str]) -> None:
    """Persist a URL override to disk. Pass None to clear it."""
    f = _config_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    if url:
        f.write_text(json.dumps({"mongodbUrl": url}))
    elif f.exists():
        f.unlink()


def get_active_url() -> str:
    """Return the MongoDB URL currently in use."""
    return _active_url or get_settings().mongodb_url


def mask_url(url: str) -> str:
    """Return the URL with the password replaced by ****."""
    try:
        p = urlparse(url)
        if p.password:
            masked_netloc = p.netloc.replace(f":{p.password}@", ":****@")
            return urlunparse(p._replace(netloc=masked_netloc))
    except Exception:
        pass
    return url


# ── Connection lifecycle ───────────────────────────────────────────────────────

async def connect_db():
    global _client, _active_url
    url = load_config_url() or get_settings().mongodb_url
    _active_url = url
    _client = AsyncIOMotorClient(url)
    await _ensure_app_indexes()


async def close_db():
    global _client
    if _client:
        _client.close()
        _client = None


async def test_connection(url: str) -> dict:
    """Probe a URL without affecting the live connection. Returns {ok, version, error}."""
    try:
        probe = AsyncIOMotorClient(url, serverSelectionTimeoutMS=6000)
        await probe.admin.command("ping")
        info = await probe.admin.command("buildInfo")
        probe.close()
        return {"ok": True, "version": info.get("version", "unknown"), "error": None}
    except Exception as e:
        return {"ok": False, "version": None, "error": str(e)}


async def reconnect_db(new_url: str) -> None:
    """Switch the live connection to new_url and persist it to disk."""
    global _client, _active_url
    new_client = AsyncIOMotorClient(new_url, serverSelectionTimeoutMS=6000)
    await new_client.admin.command("ping")   # verify before swapping
    old_client = _client
    _client = new_client
    _active_url = new_url
    save_config_url(new_url)
    await _ensure_app_indexes()
    if old_client:
        old_client.close()


async def reset_db_config() -> None:
    """Remove config override and reconnect to the env-var URL."""
    global _client, _active_url
    url = get_settings().mongodb_url
    new_client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=6000)
    await new_client.admin.command("ping")
    old_client = _client
    _client = new_client
    _active_url = url
    save_config_url(None)
    await _ensure_app_indexes()
    if old_client:
        old_client.close()


# ── DB accessors ───────────────────────────────────────────────────────────────

def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("Database not connected")
    return _client


def get_app_db() -> AsyncIOMotorDatabase:
    return get_client()[_APP_DB]


def get_user_db(user_id: str) -> AsyncIOMotorDatabase:
    return get_client()[f"{_USER_DB_PREFIX}{user_id}"]


def get_db() -> AsyncIOMotorDatabase:
    return get_app_db()


# ── Index setup ────────────────────────────────────────────────────────────────

async def _ensure_app_indexes():
    db = get_app_db()
    await db.users.create_index("externalSubject", unique=True)
    await db.users.create_index("email")
    await db.food_items.create_index([("name", "text"), ("brand", "text")])
    await db.exercises.create_index([("name", "text"), ("category", "text")])
    await db.health_metric_types.create_index("key", unique=True)
    await db.medication_list.create_index([("name", "text"), ("genericName", "text")])
    await db.api_tokens.create_index("tokenHash", unique=True)


async def ensure_user_indexes(user_id: str):
    db = get_user_db(user_id)
    await db.food_items.create_index([("name", "text"), ("brand", "text")])
    await db.food_logs.create_index([("userId", 1), ("loggedAt", -1)])
    await db.food_meals.create_index([("userId", 1)])
    await db.medications.create_index([("userId", 1), ("active", 1)])
    await db.medications.create_index([("userId", 1), ("name", 1)])
    await db.medication_logs.create_index([("userId", 1), ("takenAt", -1)])
    await db.medication_logs.create_index([("userId", 1), ("medicationId", 1)])
    await db.health_metric_types.create_index("key")
    await db.health_readings.create_index([("userId", 1), ("takenAt", -1)])
    await db.health_readings.create_index([("userId", 1), ("metricTypeId", 1), ("takenAt", -1)])
    await db.health_readings.create_index([("userId", 1), ("metricKey", 1), ("takenAt", -1)])
    await db.exercises.create_index([("name", "text")])
    await db.workout_sessions.create_index([("userId", 1), ("startedAt", -1)])
    await db.workout_templates.create_index([("userId", 1)])
    await db.reminders.create_index([("userId", 1), ("enabled", 1)])
    await db.custom_fields.create_index([("userId", 1), ("entity", 1)])
    await db.ai_providers.create_index([("userId", 1)])
    await db.audit_logs.create_index([("userId", 1), ("createdAt", -1)])
