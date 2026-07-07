import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sparky-bridge")

from config import get_settings
import database
import logger as slog
from routes import auth, system, users, foods, food_entries, measurements, health_data, goals, stubs

_ROUTERS = [
    system.router,
    auth.router,
    users.router,
    foods.router,
    food_entries.router,
    measurements.router,
    health_data.router,
    goals.router,
    stubs.router,
]


def _resolve_mongodb_url(fallback: str) -> str:
    """Use the API's saved DB config override if present, otherwise fall back to env var."""
    import json
    from pathlib import Path
    cfg = Path("/data/config/db-config.json")
    try:
        if cfg.exists():
            url = json.loads(cfg.read_text()).get("mongodbUrl") or ""
            if url:
                return url
    except Exception:
        pass
    return fallback


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    url = _resolve_mongodb_url(s.mongodb_url)
    log.info("Connecting to MongoDB at %s …", url.split("@")[-1])
    await database.connect(url)
    log.info("MongoDB ready.")
    await slog.ensure_indexes()
    await slog.info("Sparky Bridge started", source="startup")
    yield
    await slog.info("Sparky Bridge shutting down", source="startup")
    await database.close()
    log.info("MongoDB connection closed.")


def _add_request_logging(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_log(request: Request, call_next):
        import asyncio
        body = await request.body()
        body_preview = body[:300].decode(errors="replace") if body else ""

        response = await call_next(request)
        status = response.status_code
        source = request.url.path.strip("/").split("/")[0] or "root"

        if status >= 500:
            asyncio.create_task(slog.error(
                f"{request.method} {request.url.path} → {status}",
                source=source,
                body=body_preview or None,
            ))
        elif status >= 400:
            asyncio.create_task(slog.warning(
                f"{request.method} {request.url.path} → {status}",
                source=source,
            ))
        else:
            asyncio.create_task(slog.debug(
                f"{request.method} {request.url.path} → {status}",
                source=source,
                body=body_preview or None,
            ))
        return response


ROOT_PATH = os.getenv("ROOT_PATH", "").rstrip("/")

if ROOT_PATH:
    # NPM forwards /sparky/… WITHOUT stripping the prefix — the bridge mounts
    # at ROOT_PATH so FastAPI routes to the correct handlers.
    # The lifespan MUST be on the outer app; Starlette doesn't propagate it to
    # mounted sub-applications.
    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    bridge = FastAPI(title="Sparky → Health Tracker Bridge", version="2.0.0")
    _add_request_logging(bridge)
    for router in _ROUTERS:
        bridge.include_router(router)

    app.mount(ROOT_PATH, bridge)

else:
    # Prefix stripped before reaching us — serve at root.
    app = FastAPI(
        title="Sparky → Health Tracker Bridge",
        version="2.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    _add_request_logging(app)
    for router in _ROUTERS:
        app.include_router(router)
