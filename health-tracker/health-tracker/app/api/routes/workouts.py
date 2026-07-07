from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from bson import ObjectId
from auth.middleware import require_auth
import asyncio
from database import get_app_db, get_user_db
from lib.audit import log_action
from lib.serializer import doc_to_dict

router = APIRouter()

_IMG_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"


# ── Pydantic models ───────────────────────────────────────────────────────────

class ExerciseCreate(BaseModel):
    name: str
    category: str = "strength"
    primaryMuscles: list[str] = []
    secondaryMuscles: list[str] = []
    equipment: str = "bodyweight"
    difficulty: str = "beginner"
    instructions: Optional[str] = None
    imageUrl: Optional[str] = None
    images: list[str] = []
    force: Optional[str] = None
    mechanic: Optional[str] = None


class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    primaryMuscles: Optional[list[str]] = None
    secondaryMuscles: Optional[list[str]] = None
    equipment: Optional[str] = None
    difficulty: Optional[str] = None
    instructions: Optional[str] = None
    imageUrl: Optional[str] = None
    images: Optional[list[str]] = None
    force: Optional[str] = None
    mechanic: Optional[str] = None


class SetData(BaseModel):
    setNumber: int
    completed: bool = False
    reps: Optional[int] = None
    weight: Optional[float] = None
    weightUnit: str = "lb"
    rpe: Optional[float] = None
    durationSeconds: Optional[int] = None
    distance: Optional[float] = None
    distanceUnit: str = "mi"
    averageHeartRate: Optional[int] = None
    calories: Optional[float] = None


class SessionExercise(BaseModel):
    exerciseId: str
    exerciseName: str
    category: str
    sets: list[SetData] = []
    notes: Optional[str] = None


class WorkoutSessionCreate(BaseModel):
    name: Optional[str] = None
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    durationSeconds: Optional[int] = None
    notes: Optional[str] = None
    exercises: list[SessionExercise] = []
    templateId: Optional[str] = None


class WorkoutSessionUpdate(BaseModel):
    name: Optional[str] = None
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    durationSeconds: Optional[int] = None
    notes: Optional[str] = None
    exercises: Optional[list[SessionExercise]] = None


class TemplateExercise(BaseModel):
    exerciseId: str
    exerciseName: str
    category: str
    targetSets: int = 3
    targetReps: Optional[int] = None
    targetWeight: Optional[float] = None
    weightUnit: str = "lb"
    targetDurationSeconds: Optional[int] = None
    notes: Optional[str] = None


class TemplateGroup(BaseModel):
    id: Optional[str] = None
    name: str = ''
    exercises: list[TemplateExercise] = []


class WorkoutTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    exercises: list[TemplateExercise] = []
    groups: list[TemplateGroup] = []
    quickAction: bool = False


class WorkoutTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    exercises: Optional[list[TemplateExercise]] = None
    groups: Optional[list[TemplateGroup]] = None
    quickAction: Optional[bool] = None


# ── Exercises ─────────────────────────────────────────────────────────────────

@router.get("/exercises")
async def list_exercises(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    equipment: Optional[str] = Query(None),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    app_db = get_app_db()
    user_db = get_user_db(user_id)

    app_filter: dict = {"deletedAt": None}
    user_filter: dict = {"deletedAt": None}
    if category:
        app_filter["category"] = category
        user_filter["category"] = category
    if equipment:
        app_filter["equipment"] = equipment
        user_filter["equipment"] = equipment
    if search:
        app_filter["$text"] = {"$search": search}
        user_filter["$text"] = {"$search": search}

    app_exercises, user_exercises = await asyncio.gather(
        app_db.exercises.find(app_filter).sort("name", 1).to_list(500),
        user_db.exercises.find(user_filter).sort("name", 1).to_list(500),
    )
    # personal exercises first, then global
    seen = set()
    exercises = []
    for ex in (user_exercises + app_exercises):
        sid = str(ex["_id"])
        if sid not in seen:
            seen.add(sid)
            exercises.append(ex)
    exercises.sort(key=lambda e: e.get("name", ""))
    result = []
    for e in exercises:
        d = doc_to_dict(e)
        if not d.get("imageUrl") and d.get("images"):
            d["imageUrl"] = _IMG_BASE + d["images"][0]
        result.append(d)
    return result


@router.get("/exercises/{exercise_id}")
async def get_exercise(exercise_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    doc = await get_user_db(user_id).exercises.find_one(
        {"_id": ObjectId(exercise_id), "deletedAt": None}
    )
    if not doc:
        doc = await get_app_db().exercises.find_one(
            {"_id": ObjectId(exercise_id), "deletedAt": None}
        )
    if not doc:
        raise HTTPException(status_code=404, detail="Exercise not found")
    d = doc_to_dict(doc)
    if not d.get("imageUrl") and d.get("images"):
        d["imageUrl"] = _IMG_BASE + d["images"][0]
    return d


@router.post("/exercises", status_code=201)
async def create_exercise(body: ExerciseCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "scope": "user",
        **body.model_dump(),
        "source": "user",
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db.exercises.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "exercise.created", "exercise",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.put("/exercises/{exercise_id}")
async def update_exercise(exercise_id: str, body: ExerciseUpdate,
                          user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.exercises.find_one(
        {"_id": ObjectId(exercise_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Exercise not found or not editable")
    update = {"updatedAt": datetime.utcnow()}
    for k, v in body.model_dump(exclude_none=True).items():
        update[k] = v
    result = await db.exercises.find_one_and_update(
        {"_id": ObjectId(exercise_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "exercise.updated", "exercise", exercise_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/exercises/{exercise_id}", status_code=204)
async def delete_exercise(exercise_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.exercises.find_one_and_update(
        {"_id": ObjectId(exercise_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Exercise not found or not deletable")
    await log_action(user_id, "exercise.deleted", "exercise", exercise_id)


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_workout_dashboard(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    week_start = now - timedelta(days=7)
    month_start = now - timedelta(days=30)

    week_sessions_cursor = db.workout_sessions.find({
        "userId": user_id, "deletedAt": None, "startedAt": {"$gte": week_start}
    }).sort("startedAt", -1)
    week_sessions = await week_sessions_cursor.to_list(100)

    total_duration = 0
    total_volume = 0
    for s in week_sessions:
        total_duration += s.get("durationSeconds", 0) or 0
        for ex in s.get("exercises", []):
            for set_data in ex.get("sets", []):
                if set_data.get("completed"):
                    w = set_data.get("weight", 0) or 0
                    r = set_data.get("reps", 0) or 0
                    total_volume += w * r

    month_count = await db.workout_sessions.count_documents({
        "userId": user_id, "deletedAt": None, "startedAt": {"$gte": month_start}
    })

    recent_cursor = db.workout_sessions.find({
        "userId": user_id, "deletedAt": None,
    }).sort("startedAt", -1).limit(10)
    recent = await recent_cursor.to_list(10)

    return {
        "weekSessions": len(week_sessions),
        "weekVolumeLb": round(total_volume, 1),
        "weekDurationSeconds": total_duration,
        "monthSessions": month_count,
        "recentSessions": [doc_to_dict(s) for s in recent],
    }


# ── Progress ─────────────────────────────────────────────────────────────────

@router.get("/progress")
async def get_exercise_progress(
    exercise_id: str = Query(...),
    days: int = Query(90, ge=7, le=365),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    since = datetime.utcnow() - timedelta(days=days)

    cursor = db.workout_sessions.find({
        "userId": user_id,
        "deletedAt": None,
        "startedAt": {"$gte": since},
        "exercises.exerciseId": exercise_id,
    }).sort("startedAt", 1)
    sessions = await cursor.to_list(500)

    data_points = []
    for s in sessions:
        for ex in s.get("exercises", []):
            if ex.get("exerciseId") != exercise_id:
                continue
            completed_sets = [st for st in ex.get("sets", []) if st.get("completed")]
            weight_sets = [st for st in completed_sets if st.get("weight")]
            if not completed_sets:
                continue
            max_weight = max((st.get("weight", 0) for st in weight_sets), default=0)
            total_reps = sum(st.get("reps", 0) or 0 for st in completed_sets)
            volume = sum((st.get("weight", 0) or 0) * (st.get("reps", 0) or 0)
                         for st in completed_sets)
            data_points.append({
                "date": s["startedAt"].isoformat() + "Z",
                "maxWeight": max_weight,
                "totalReps": total_reps,
                "volume": round(volume, 1),
                "sets": len(completed_sets),
            })

    return {"exerciseId": exercise_id, "days": days, "data": data_points}


# ── Workout Sessions ──────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions(
    limit: int = Query(20, le=500),
    offset: int = Query(0),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}
    if date_from or date_to:
        query["startedAt"] = {}
        if date_from:
            query["startedAt"]["$gte"] = datetime.fromisoformat(date_from)
        if date_to:
            query["startedAt"]["$lte"] = datetime.fromisoformat(date_to)
    cursor = db.workout_sessions.find(query).sort("startedAt", -1).skip(offset).limit(limit)
    sessions = await cursor.to_list(length=limit)
    total = await db.workout_sessions.count_documents(query)
    return {"sessions": [doc_to_dict(s) for s in sessions], "total": total}


@router.post("/sessions", status_code=201)
async def create_session(body: WorkoutSessionCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    name = body.name or f"Workout — {now.strftime('%b %d, %Y')}"
    doc = {
        "userId": user_id,
        "name": name,
        "startedAt": body.startedAt or now,
        "completedAt": body.completedAt,
        "durationSeconds": body.durationSeconds,
        "notes": body.notes,
        "exercises": [ex.model_dump() for ex in body.exercises],
        "templateId": body.templateId,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db.workout_sessions.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "workout_session.created", "workout_session",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    session = await db.workout_sessions.find_one(
        {"_id": ObjectId(session_id), "userId": user_id, "deletedAt": None}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return doc_to_dict(session)


@router.put("/sessions/{session_id}")
async def update_session(session_id: str, body: WorkoutSessionUpdate,
                         user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.workout_sessions.find_one(
        {"_id": ObjectId(session_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Session not found")
    update = {"updatedAt": datetime.utcnow()}
    for k, v in body.model_dump(exclude_none=True).items():
        update[k] = v
    result = await db.workout_sessions.find_one_and_update(
        {"_id": ObjectId(session_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "workout_session.updated", "workout_session", session_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.workout_sessions.find_one_and_update(
        {"_id": ObjectId(session_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Session not found")
    await log_action(user_id, "workout_session.deleted", "workout_session", session_id)


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    cursor = db.workout_templates.find(
        {"userId": user_id, "deletedAt": None}
    ).sort("name", 1)
    templates = await cursor.to_list(200)
    return [doc_to_dict(t) for t in templates]


@router.post("/templates", status_code=201)
async def create_template(body: WorkoutTemplateCreate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        **body.model_dump(),
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db.workout_templates.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(user_id, "workout_template.created", "workout_template",
                     str(result.inserted_id), after=doc_to_dict(doc))
    return doc_to_dict(doc)


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    template = await db.workout_templates.find_one(
        {"_id": ObjectId(template_id), "userId": user_id, "deletedAt": None}
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc_to_dict(template)


@router.put("/templates/{template_id}")
async def update_template(template_id: str, body: WorkoutTemplateUpdate,
                          user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.workout_templates.find_one(
        {"_id": ObjectId(template_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    update = {"updatedAt": datetime.utcnow()}
    for k, v in body.model_dump(exclude_none=True).items():
        update[k] = v
    result = await db.workout_templates.find_one_and_update(
        {"_id": ObjectId(template_id)}, {"$set": update}, return_document=True
    )
    await log_action(user_id, "workout_template.updated", "workout_template", template_id,
                     before=doc_to_dict(existing), after=doc_to_dict(result))
    return doc_to_dict(result)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.workout_templates.find_one_and_update(
        {"_id": ObjectId(template_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Template not found")
    await log_action(user_id, "workout_template.deleted", "workout_template", template_id)
