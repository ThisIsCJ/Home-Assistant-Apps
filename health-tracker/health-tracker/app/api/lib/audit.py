from datetime import datetime
from database import get_user_db
from bson import ObjectId


async def log_action(
    user_id: str,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    source: str = "web",
    before: dict | None = None,
    after: dict | None = None,
    ip_address: str = "",
    user_agent: str = "",
):
    db = get_user_db(user_id)
    await db.audit_logs.insert_one({
        "userId": user_id,
        "actorUserId": user_id,
        "action": action,
        "entityType": entity_type,
        "entityId": entity_id,
        "source": source,
        "before": before,
        "after": after,
        "ipAddress": ip_address,
        "userAgent": user_agent,
        "createdAt": datetime.utcnow(),
    })
