from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
from bson import ObjectId
from auth.middleware import require_auth
from database import get_user_db
from lib.serializer import doc_to_dict

router = APIRouter()


class ReminderSchedule(BaseModel):
    mode: str = "daily"          # daily | weekly | once
    time: str = "09:00"          # HH:MM
    days: Optional[List[int]] = None   # 0=Mon … 6=Sun (weekly only)
    date: Optional[str] = None   # YYYY-MM-DD (once only)


class ReminderCreate(BaseModel):
    title: str
    body: Optional[str] = None
    reminderType: str = "custom"  # custom | medication | medication_bundle
    entityId: Optional[str] = None
    schedule: ReminderSchedule
    snoozeMinutes: int = 10
    enabled: bool = True


class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    reminderType: Optional[str] = None
    schedule: Optional[ReminderSchedule] = None
    snoozeMinutes: Optional[int] = None
    enabled: Optional[bool] = None


@router.get("")
async def list_reminders(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    docs = await db.reminders.find({"userId": user_id, "deletedAt": None}).sort("createdAt", -1).to_list(500)
    return [doc_to_dict(d) for d in docs]


@router.post("", status_code=201)
async def create_reminder(body: ReminderCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "title": body.title.strip(),
        "body": body.body,
        "reminderType": body.reminderType,
        "entityId": body.entityId,
        "schedule": body.schedule.model_dump(),
        "snoozeMinutes": body.snoozeMinutes,
        "enabled": body.enabled,
        "snoozedUntil": None,
        "lastAcknowledgedDate": None,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db.reminders.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc_to_dict(doc)


@router.put("/{reminder_id}")
async def update_reminder(reminder_id: str, body: ReminderUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.reminders.find_one({"_id": ObjectId(reminder_id), "userId": user_id, "deletedAt": None})
    if not existing:
        raise HTTPException(404, "Reminder not found")

    upd: dict = {"updatedAt": datetime.utcnow()}
    if body.title is not None:
        upd["title"] = body.title.strip()
    if body.body is not None:
        upd["body"] = body.body
    if body.reminderType is not None:
        upd["reminderType"] = body.reminderType
    if body.schedule is not None:
        upd["schedule"] = body.schedule.model_dump()
    if body.snoozeMinutes is not None:
        upd["snoozeMinutes"] = body.snoozeMinutes
    if body.enabled is not None:
        upd["enabled"] = body.enabled

    await db.reminders.update_one({"_id": ObjectId(reminder_id)}, {"$set": upd})
    doc = await db.reminders.find_one({"_id": ObjectId(reminder_id)})
    return doc_to_dict(doc)


@router.delete("/{reminder_id}", status_code=204)
async def delete_reminder(reminder_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.reminders.update_one(
        {"_id": ObjectId(reminder_id), "userId": user_id},
        {"$set": {"deletedAt": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Reminder not found")


@router.post("/{reminder_id}/acknowledge")
async def acknowledge_reminder(reminder_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    await db.reminders.update_one(
        {"_id": ObjectId(reminder_id), "userId": user_id},
        {"$set": {"lastAcknowledgedDate": today, "snoozedUntil": None, "updatedAt": datetime.utcnow()}}
    )
    return {"ok": True}


@router.post("/{reminder_id}/snooze")
async def snooze_reminder(reminder_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    reminder = await db.reminders.find_one({"_id": ObjectId(reminder_id), "userId": user_id, "deletedAt": None})
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    snooze_until = datetime.utcnow() + timedelta(minutes=reminder.get("snoozeMinutes", 10))
    await db.reminders.update_one(
        {"_id": ObjectId(reminder_id)},
        {"$set": {"snoozedUntil": snooze_until, "updatedAt": datetime.utcnow()}}
    )
    return {"snoozedUntil": snooze_until.isoformat()}


@router.get("/due")
async def get_due_reminders(user: dict = Depends(require_auth)):
    """Return reminders whose scheduled time falls within the last 5 minutes and haven't been acknowledged today."""
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    now_minutes = now.hour * 60 + now.minute
    current_weekday = now.weekday()  # 0=Mon, 6=Sun

    docs = await db.reminders.find({
        "userId": user_id,
        "enabled": True,
        "deletedAt": None,
    }).to_list(500)

    due = []
    for r in docs:
        # Skip if snoozed
        if r.get("snoozedUntil") and r["snoozedUntil"] > now:
            continue

        schedule = r.get("schedule", {})
        mode = schedule.get("mode", "daily")
        sched_time = schedule.get("time", "09:00")

        try:
            sh, sm = map(int, sched_time.split(":"))
        except Exception:
            continue
        sched_minutes = sh * 60 + sm

        # Check 5-minute window
        if not (0 <= now_minutes - sched_minutes < 5):
            continue

        if r.get("lastAcknowledgedDate") == today:
            continue

        if mode == "daily":
            due.append(doc_to_dict(r))
        elif mode == "weekly":
            if current_weekday in (schedule.get("days") or []):
                due.append(doc_to_dict(r))
        elif mode == "once":
            if schedule.get("date") == today:
                due.append(doc_to_dict(r))

    return due
