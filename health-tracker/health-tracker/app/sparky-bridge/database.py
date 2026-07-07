"""
Direct MongoDB connection for the Sparky Bridge.
Shares the same database as the Health Tracker API — no HTTP hop needed.
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import get_settings

_client: AsyncIOMotorClient | None = None


async def connect(mongodb_url: str) -> None:
    global _client
    _client = AsyncIOMotorClient(mongodb_url, serverSelectionTimeoutMS=5000)
    # Verify connection
    await _client.admin.command("ping")


async def close() -> None:
    global _client
    if _client:
        _client.close()
        _client = None


def get_app_db() -> AsyncIOMotorDatabase:
    """Shared app database — users, api_tokens, food_items (global), metric_types (global)."""
    return _client[f"{get_settings().db_name}_app"]


def get_user_db(user_id: str) -> AsyncIOMotorDatabase:
    """Per-user database — food_logs, health_readings, food_meals, etc."""
    return _client[f"{get_settings().db_name}_u_{user_id}"]
