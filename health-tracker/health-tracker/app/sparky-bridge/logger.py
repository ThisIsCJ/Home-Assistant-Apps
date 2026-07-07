"""
Structured logger for the Sparky Bridge.

Writes entries to app_db.sparky_logs.  The active log level is read from
app_db.sparky_config (cached 30 s) so the admin UI change takes effect quickly.
Entries carry a 7-day TTL via a MongoDB index created at startup.
"""
import logging
from datetime import datetime
from typing import Any

_LEVELS: dict[str, int] = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}

_current_level: int = _LEVELS["INFO"]
_level_checked_at: datetime | None = None
_LEVEL_TTL_SECONDS = 30

_stdlib = logging.getLogger("sparky-bridge")


async def _maybe_refresh_level() -> None:
    global _current_level, _level_checked_at
    now = datetime.utcnow()
    if _level_checked_at and (now - _level_checked_at).total_seconds() < _LEVEL_TTL_SECONDS:
        return
    try:
        from database import get_app_db
        doc = await get_app_db().sparky_config.find_one({"_id": "log_config"})
        if doc:
            name = (doc.get("logLevel") or "INFO").upper()
            _current_level = _LEVELS.get(name, _LEVELS["INFO"])
        _level_checked_at = now
    except Exception:
        pass  # keep current level if DB unavailable


async def log(
    level: str,
    message: str,
    details: dict[str, Any] | None = None,
    source: str = "sparky-bridge",
) -> None:
    level_upper = level.upper()
    level_num = _LEVELS.get(level_upper, _LEVELS["INFO"])

    await _maybe_refresh_level()
    if level_num < _current_level:
        return

    _stdlib.log(level_num, "[%s] %s", source, message)

    try:
        from database import get_app_db
        doc: dict[str, Any] = {
            "timestamp": datetime.utcnow(),
            "level": level_upper,
            "levelNum": level_num,
            "source": source,
            "message": message,
        }
        if details:
            doc["details"] = details
        await get_app_db().sparky_logs.insert_one(doc)
    except Exception as exc:
        _stdlib.warning("Failed to persist log entry: %s", exc)


async def debug(message: str, source: str = "sparky-bridge", **details: Any) -> None:
    await log("DEBUG", message, details or None, source)

async def info(message: str, source: str = "sparky-bridge", **details: Any) -> None:
    await log("INFO", message, details or None, source)

async def warning(message: str, source: str = "sparky-bridge", **details: Any) -> None:
    await log("WARNING", message, details or None, source)

async def error(message: str, source: str = "sparky-bridge", **details: Any) -> None:
    await log("ERROR", message, details or None, source)


async def ensure_indexes() -> None:
    """Create TTL index on sparky_logs (7 days) and index on sparky_config."""
    from datetime import timedelta
    try:
        from database import get_app_db
        db = get_app_db()
        await db.sparky_logs.create_index(
            "timestamp",
            expireAfterSeconds=int(timedelta(days=7).total_seconds()),
            background=True,
        )
        await db.sparky_logs.create_index([("levelNum", -1), ("timestamp", -1)], background=True)
    except Exception as exc:
        _stdlib.warning("sparky_logs index creation failed: %s", exc)
