from fastapi import APIRouter
from fastapi.responses import JSONResponse
from database import get_db

router = APIRouter()


@router.get("/health")
async def health_check():
    try:
        db = get_db()
        await db.command("ping")
        db_status = "ok"
    except Exception:
        db_status = "error"
    if db_status != "ok":
        return JSONResponse(status_code=503, content={"status": "degraded", "db": db_status})
    return {"status": "ok", "db": db_status}
