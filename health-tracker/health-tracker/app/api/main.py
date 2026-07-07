import json
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from database import connect_db, close_db, get_app_db
from routes.auth import router as auth_router
from routes.health import router as health_router
from routes.users import router as users_router
from routes.food import router as food_router
from routes.medications import router as medications_router
from routes.health_stats import router as health_stats_router
from routes.workouts import router as workouts_router
from routes.ai import router as ai_router
from routes.tokens import router as tokens_router
from routes.custom_fields import router as custom_fields_router
from routes.reminders import router as reminders_router
from routes.food_plans import router as food_plans_router
from routes.calendar import router as calendar_router
from routes.data import router as data_router
from routes.db_config import router as db_config_router
from routes.cookbook import router as cookbook_router
from routes.health_import import router as health_import_router
from routes.admin import router as admin_router
from routes.gdrive import router as gdrive_router
from routes.sync_prefs import router as sync_prefs_router
from datetime import datetime
from config import get_settings


SEED_FOODS = [
    {"name": "Chicken Breast (cooked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 165, "proteinG": 31, "carbsG": 0, "fatG": 3.6, "fiberG": 0, "sugarG": 0, "sodiumMg": 74}},
    {"name": "Brown Rice (cooked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 112, "proteinG": 2.6, "carbsG": 23.5, "fatG": 0.9, "fiberG": 1.8, "sugarG": 0.4, "sodiumMg": 5}},
    {"name": "Whole Egg", "brand": None, "servingSize": {"amount": 50, "unit": "g"},
     "nutritionPerServing": {"calories": 72, "proteinG": 6.3, "carbsG": 0.4, "fatG": 4.8, "fiberG": 0, "sugarG": 0.2, "sodiumMg": 71}},
    {"name": "Banana", "brand": None, "servingSize": {"amount": 118, "unit": "g"},
     "nutritionPerServing": {"calories": 105, "proteinG": 1.3, "carbsG": 27, "fatG": 0.4, "fiberG": 3.1, "sugarG": 14.4, "sodiumMg": 1}},
    {"name": "Greek Yogurt (plain, full fat)", "brand": None, "servingSize": {"amount": 170, "unit": "g"},
     "nutritionPerServing": {"calories": 130, "proteinG": 11, "carbsG": 5, "fatG": 7, "fiberG": 0, "sugarG": 4, "sodiumMg": 50}},
    {"name": "Oats (dry)", "brand": None, "servingSize": {"amount": 40, "unit": "g"},
     "nutritionPerServing": {"calories": 150, "proteinG": 5, "carbsG": 27, "fatG": 2.5, "fiberG": 4, "sugarG": 0.5, "sodiumMg": 0}},
    {"name": "Salmon (cooked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 208, "proteinG": 20, "carbsG": 0, "fatG": 13, "fiberG": 0, "sugarG": 0, "sodiumMg": 59}},
    {"name": "Broccoli (cooked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 35, "proteinG": 2.4, "carbsG": 7.2, "fatG": 0.4, "fiberG": 3.3, "sugarG": 1.7, "sodiumMg": 41}},
    {"name": "Almonds", "brand": None, "servingSize": {"amount": 28, "unit": "g"},
     "nutritionPerServing": {"calories": 164, "proteinG": 6, "carbsG": 6.1, "fatG": 14.2, "fiberG": 3.5, "sugarG": 1.2, "sodiumMg": 0}},
    {"name": "Apple", "brand": None, "servingSize": {"amount": 182, "unit": "g"},
     "nutritionPerServing": {"calories": 95, "proteinG": 0.5, "carbsG": 25, "fatG": 0.3, "fiberG": 4.4, "sugarG": 19, "sodiumMg": 2}},
    {"name": "Whole Milk", "brand": None, "servingSize": {"amount": 240, "unit": "ml"},
     "nutritionPerServing": {"calories": 149, "proteinG": 8, "carbsG": 12, "fatG": 8, "fiberG": 0, "sugarG": 12, "sodiumMg": 107}},
    {"name": "Bread (whole wheat, 1 slice)", "brand": None, "servingSize": {"amount": 28, "unit": "g"},
     "nutritionPerServing": {"calories": 69, "proteinG": 3.6, "carbsG": 11.6, "fatG": 1.1, "fiberG": 1.9, "sugarG": 1.4, "sodiumMg": 132}},
    {"name": "Pasta (cooked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 131, "proteinG": 5, "carbsG": 25, "fatG": 1.1, "fiberG": 1.8, "sugarG": 0.6, "sodiumMg": 1}},
    {"name": "Olive Oil", "brand": None, "servingSize": {"amount": 14, "unit": "g"},
     "nutritionPerServing": {"calories": 119, "proteinG": 0, "carbsG": 0, "fatG": 13.5, "fiberG": 0, "sugarG": 0, "sodiumMg": 0}},
    {"name": "Black Beans (cooked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 132, "proteinG": 8.9, "carbsG": 23.7, "fatG": 0.5, "fiberG": 8.7, "sugarG": 0.3, "sodiumMg": 1}},
    {"name": "Sweet Potato (baked)", "brand": None, "servingSize": {"amount": 100, "unit": "g"},
     "nutritionPerServing": {"calories": 90, "proteinG": 2, "carbsG": 20.7, "fatG": 0.1, "fiberG": 3.3, "sugarG": 6.5, "sodiumMg": 36}},
    {"name": "Cheddar Cheese", "brand": None, "servingSize": {"amount": 28, "unit": "g"},
     "nutritionPerServing": {"calories": 113, "proteinG": 7, "carbsG": 0.4, "fatG": 9.3, "fiberG": 0, "sugarG": 0.1, "sodiumMg": 174}},
    {"name": "Coffee (black)", "brand": None, "servingSize": {"amount": 240, "unit": "ml"},
     "nutritionPerServing": {"calories": 2, "proteinG": 0.3, "carbsG": 0, "fatG": 0, "fiberG": 0, "sugarG": 0, "sodiumMg": 5}},
    {"name": "Orange", "brand": None, "servingSize": {"amount": 131, "unit": "g"},
     "nutritionPerServing": {"calories": 62, "proteinG": 1.2, "carbsG": 15.4, "fatG": 0.2, "fiberG": 3.1, "sugarG": 12.2, "sodiumMg": 0}},
    {"name": "Peanut Butter", "brand": None, "servingSize": {"amount": 32, "unit": "g"},
     "nutritionPerServing": {"calories": 188, "proteinG": 8, "carbsG": 7, "fatG": 16, "fiberG": 2, "sugarG": 3, "sodiumMg": 152}},
]


_EXERCISES_FILE = Path(__file__).parent / "data" / "exercises.json"

# Equipment normalisation: free-exercise-db → our schema
_EQUIP_MAP = {
    "body only": "bodyweight",
    "bands": "band",
    "kettlebells": "kettlebell",
    "e-z curl bar": "barbell",
    "exercise ball": "other",
    "foam roll": "other",
    "medicine ball": "other",
}
# Level → difficulty
_DIFF_MAP = {"beginner": "beginner", "intermediate": "intermediate", "expert": "advanced"}


def _load_external_exercises() -> list:
    if not _EXERCISES_FILE.exists():
        return []
    raw = json.loads(_EXERCISES_FILE.read_text())
    out = []
    for e in raw:
        instructions = e.get("instructions") or []
        out.append({
            "name": e["name"],
            "category": e.get("category", "strength"),
            "primaryMuscles": e.get("primaryMuscles") or [],
            "secondaryMuscles": e.get("secondaryMuscles") or [],
            "equipment": _EQUIP_MAP.get(e.get("equipment", ""), e.get("equipment") or "other"),
            "difficulty": _DIFF_MAP.get(e.get("level", "beginner"), "beginner"),
            "instructions": "\n".join(instructions) if isinstance(instructions, list) else (instructions or ""),
            "images": e.get("images") or [],
            "imageUrl": None,
            "force": e.get("force"),
            "mechanic": e.get("mechanic"),
            "externalId": e.get("id"),
        })
    return out


# Legacy small seed list kept only as fallback (replaced by SEED_EXERCISES = [
_SEED_EXERCISES_LEGACY = [
    # Strength — barbell
    {"name": "Barbell Bench Press", "category": "strength", "primaryMuscles": ["chest"], "secondaryMuscles": ["triceps", "shoulders"], "equipment": "barbell", "difficulty": "intermediate", "instructions": "Lie on a flat bench, grip the bar slightly wider than shoulder-width, lower to your chest, press up."},
    {"name": "Barbell Back Squat", "category": "strength", "primaryMuscles": ["quads", "glutes"], "secondaryMuscles": ["hamstrings", "core"], "equipment": "barbell", "difficulty": "intermediate", "instructions": "Bar on upper traps, feet shoulder-width, squat until thighs are parallel to floor, drive through heels."},
    {"name": "Conventional Deadlift", "category": "strength", "primaryMuscles": ["hamstrings", "glutes", "back"], "secondaryMuscles": ["core", "traps"], "equipment": "barbell", "difficulty": "intermediate", "instructions": "Hinge at hips, grip bar outside legs, keep back flat, drive hips forward to stand."},
    {"name": "Overhead Press (Barbell)", "category": "strength", "primaryMuscles": ["shoulders"], "secondaryMuscles": ["triceps", "core"], "equipment": "barbell", "difficulty": "intermediate", "instructions": "Bar at collarbone, press directly overhead until arms lock out, lower under control."},
    {"name": "Barbell Row", "category": "strength", "primaryMuscles": ["back"], "secondaryMuscles": ["biceps", "rear delts"], "equipment": "barbell", "difficulty": "intermediate", "instructions": "Hinge forward 45°, pull bar to lower chest, squeeze shoulder blades, lower with control."},
    {"name": "Romanian Deadlift", "category": "strength", "primaryMuscles": ["hamstrings", "glutes"], "secondaryMuscles": ["lower back"], "equipment": "barbell", "difficulty": "intermediate", "instructions": "Hip hinge with soft knees, lower bar down legs until stretch in hamstrings, return to standing."},
    # Strength — dumbbell
    {"name": "Dumbbell Bicep Curl", "category": "strength", "primaryMuscles": ["biceps"], "secondaryMuscles": ["forearms"], "equipment": "dumbbell", "difficulty": "beginner", "instructions": "Stand with dumbbells at sides, curl up to shoulder height, squeeze, lower slowly."},
    {"name": "Dumbbell Lateral Raise", "category": "strength", "primaryMuscles": ["shoulders"], "secondaryMuscles": [], "equipment": "dumbbell", "difficulty": "beginner", "instructions": "Raise arms to sides to shoulder height with slight elbow bend, lower slowly."},
    {"name": "Dumbbell Shoulder Press", "category": "strength", "primaryMuscles": ["shoulders"], "secondaryMuscles": ["triceps"], "equipment": "dumbbell", "difficulty": "beginner", "instructions": "Dumbbells at ear level, press overhead until arms extend, lower with control."},
    {"name": "Incline Dumbbell Press", "category": "strength", "primaryMuscles": ["chest"], "secondaryMuscles": ["triceps", "shoulders"], "equipment": "dumbbell", "difficulty": "intermediate", "instructions": "On incline bench (~30–45°), press dumbbells up and slightly in, lower to chest."},
    {"name": "Goblet Squat", "category": "strength", "primaryMuscles": ["quads", "glutes"], "secondaryMuscles": ["core"], "equipment": "dumbbell", "difficulty": "beginner", "instructions": "Hold dumbbell at chest, feet shoulder-width, squat deep keeping torso upright."},
    # Strength — bodyweight
    {"name": "Push-up", "category": "strength", "primaryMuscles": ["chest"], "secondaryMuscles": ["triceps", "shoulders", "core"], "equipment": "bodyweight", "difficulty": "beginner", "instructions": "Hands slightly wider than shoulders, lower chest to floor, press back up."},
    {"name": "Pull-up", "category": "strength", "primaryMuscles": ["back", "biceps"], "secondaryMuscles": ["shoulders", "core"], "equipment": "bodyweight", "difficulty": "intermediate", "instructions": "Overhand grip on bar, pull until chin clears bar, lower fully."},
    {"name": "Dip", "category": "strength", "primaryMuscles": ["triceps", "chest"], "secondaryMuscles": ["shoulders"], "equipment": "bodyweight", "difficulty": "intermediate", "instructions": "Support on parallel bars, lower until upper arms are parallel to floor, press back up."},
    {"name": "Plank", "category": "strength", "primaryMuscles": ["core"], "secondaryMuscles": ["shoulders", "glutes"], "equipment": "bodyweight", "difficulty": "beginner", "instructions": "Forearms on floor, body in straight line, hold without sagging hips."},
    {"name": "Nordic Hamstring Curl", "category": "strength", "primaryMuscles": ["hamstrings"], "secondaryMuscles": ["glutes"], "equipment": "bodyweight", "difficulty": "advanced", "instructions": "Kneel with feet anchored, slowly lower body toward floor using hamstrings, use hands to push back."},
    # Strength — machine/cable
    {"name": "Lat Pulldown", "category": "strength", "primaryMuscles": ["back", "biceps"], "secondaryMuscles": ["rear delts"], "equipment": "machine", "difficulty": "beginner", "instructions": "Wide overhand grip, pull bar to upper chest, squeeze lats at bottom, return controlled."},
    {"name": "Leg Press", "category": "strength", "primaryMuscles": ["quads", "glutes"], "secondaryMuscles": ["hamstrings"], "equipment": "machine", "difficulty": "beginner", "instructions": "Feet shoulder-width on platform, lower sled until 90° knee angle, press back up."},
    {"name": "Cable Tricep Pushdown", "category": "strength", "primaryMuscles": ["triceps"], "secondaryMuscles": [], "equipment": "cable", "difficulty": "beginner", "instructions": "Stand at cable, grip rope/bar, keep elbows at sides, extend forearms down, squeeze triceps."},
    {"name": "Face Pull", "category": "strength", "primaryMuscles": ["rear delts", "rotator cuff"], "secondaryMuscles": ["traps"], "equipment": "cable", "difficulty": "beginner", "instructions": "Cable at face height, pull rope to face with elbows wide and high, squeeze rear delts."},
    # Cardio
    {"name": "Running", "category": "cardio", "primaryMuscles": ["legs", "cardiovascular"], "secondaryMuscles": [], "equipment": "other", "difficulty": "beginner", "instructions": "Run at steady or varied pace. Track distance and duration."},
    {"name": "Cycling", "category": "cardio", "primaryMuscles": ["quads", "cardiovascular"], "secondaryMuscles": ["hamstrings", "glutes"], "equipment": "other", "difficulty": "beginner", "instructions": "Cycle outdoors or on a stationary bike. Track distance, duration, and effort."},
    {"name": "Rowing Machine", "category": "cardio", "primaryMuscles": ["back", "cardiovascular"], "secondaryMuscles": ["legs", "core", "arms"], "equipment": "machine", "difficulty": "intermediate", "instructions": "Drive with legs, lean back, pull handle to abdomen, return in reverse order."},
    {"name": "Jump Rope", "category": "cardio", "primaryMuscles": ["cardiovascular", "calves"], "secondaryMuscles": ["shoulders"], "equipment": "other", "difficulty": "beginner", "instructions": "Jump with feet together or alternating, keep elbows close and wrists turning rope."},
    {"name": "Elliptical", "category": "cardio", "primaryMuscles": ["legs", "cardiovascular"], "secondaryMuscles": ["core", "arms"], "equipment": "machine", "difficulty": "beginner", "instructions": "Low-impact full-body cardio on elliptical machine. Track duration and resistance level."},
    {"name": "Walking", "category": "cardio", "primaryMuscles": ["legs", "cardiovascular"], "secondaryMuscles": [], "equipment": "other", "difficulty": "beginner", "instructions": "Walk at a brisk pace. Can be done outdoors or on a treadmill."},
    # Mobility
    {"name": "Hip Flexor Stretch", "category": "mobility", "primaryMuscles": ["hip flexors"], "secondaryMuscles": [], "equipment": "bodyweight", "difficulty": "beginner", "instructions": "Kneel on one knee, shift weight forward until stretch in front hip, hold 30–60s per side."},
    {"name": "Cat-Cow Stretch", "category": "mobility", "primaryMuscles": ["spine"], "secondaryMuscles": ["core"], "equipment": "bodyweight", "difficulty": "beginner", "instructions": "On hands and knees, alternate arching back (cow) and rounding spine (cat) slowly."},
    {"name": "World's Greatest Stretch", "category": "mobility", "primaryMuscles": ["hips", "thoracic spine"], "secondaryMuscles": ["hamstrings", "shoulders"], "equipment": "bodyweight", "difficulty": "beginner", "instructions": "From lunge, place same-side hand inside foot, rotate upper body and reach arm to sky."},
    # Recovery
    {"name": "Foam Rolling", "category": "recovery", "primaryMuscles": [], "secondaryMuscles": [], "equipment": "other", "difficulty": "beginner", "instructions": "Roll slowly over target muscle groups, pause on tender spots for 20–30s."},
]


SEED_METRIC_TYPES = [
    {"key": "weight",              "displayName": "Weight",                "unit": "lb",    "category": "body",     "color": "#60a5fa"},
    {"key": "bp_systolic",         "displayName": "Blood Pressure (Sys)",  "unit": "mmHg",  "category": "vitals",   "color": "#ef4444"},
    {"key": "bp_diastolic",        "displayName": "Blood Pressure (Dia)",  "unit": "mmHg",  "category": "vitals",   "color": "#f97316"},
    {"key": "heart_rate",          "displayName": "Resting Heart Rate",    "unit": "bpm",   "category": "vitals",   "color": "#ec4899", "normalRangeMin": 60,  "normalRangeMax": 100},
    {"key": "heart_rate_max",      "displayName": "Max Heart Rate",        "unit": "bpm",   "category": "vitals",   "color": "#f43f5e", "normalRangeMin": 100, "normalRangeMax": 185},
    {"key": "heart_rate_min",      "displayName": "Min Heart Rate",        "unit": "bpm",   "category": "vitals",   "color": "#fb7185", "normalRangeMin": 40,  "normalRangeMax": 60},
    {"key": "heart_rate_avg",      "displayName": "Average Heart Rate",    "unit": "bpm",   "category": "vitals",   "color": "#f472b6", "normalRangeMin": 60,  "normalRangeMax": 100},
    {"key": "blood_glucose",       "displayName": "Blood Glucose",         "unit": "mg/dL", "category": "lab",      "color": "#f59e0b", "normalRangeMin": 70, "normalRangeMax": 140},
    {"key": "sleep_duration",      "displayName": "Sleep Duration",        "unit": "min",   "category": "sleep",    "color": "#a855f7"},
    {"key": "sleep_deep",          "displayName": "Deep Sleep",            "unit": "min",   "category": "sleep",    "color": "#7c3aed", "normalRangeMin": 30,  "normalRangeMax": 120},
    {"key": "sleep_rem",           "displayName": "REM Sleep",             "unit": "min",   "category": "sleep",    "color": "#c084fc", "normalRangeMin": 90,  "normalRangeMax": 150},
    {"key": "sleep_light",         "displayName": "Light Sleep",           "unit": "min",   "category": "sleep",    "color": "#e9d5ff"},
    {"key": "sleep_awake",         "displayName": "Time Awake",            "unit": "min",   "category": "sleep",    "color": "#f87171"},
    {"key": "sleep_score",         "displayName": "Sleep Score",           "unit": "/100",  "category": "sleep",    "color": "#818cf8", "normalRangeMin": 70,  "normalRangeMax": 100},
    {"key": "sleep_efficiency",    "displayName": "Sleep Efficiency",      "unit": "%",     "category": "sleep",    "color": "#6366f1", "normalRangeMin": 85,  "normalRangeMax": 100},
    {"key": "physical_recovery",   "displayName": "Physical Recovery",     "unit": "/100",  "category": "sleep",    "color": "#4ade80", "normalRangeMin": 70,  "normalRangeMax": 100},
    {"key": "mental_recovery",     "displayName": "Mental Recovery",       "unit": "/100",  "category": "sleep",    "color": "#60a5fa", "normalRangeMin": 70,  "normalRangeMax": 100},
    {"key": "movement_awakening",  "displayName": "Movement/Awakening",    "unit": "count", "category": "sleep",    "color": "#f87171"},
    {"key": "steps",               "displayName": "Steps",                 "unit": "steps", "category": "activity", "color": "#10b981"},
    {"key": "spo2",                "displayName": "Oxygen Saturation",     "unit": "%",     "category": "vitals",   "color": "#06b6d4", "normalRangeMin": 95, "normalRangeMax": 100},
    {"key": "body_temp",           "displayName": "Body Temperature",      "unit": "°F",    "category": "vitals",   "color": "#f59e0b", "normalRangeMin": 97, "normalRangeMax": 99},
    {"key": "skin_temp_min",       "displayName": "Skin Temp Min",         "unit": "°C",    "category": "vitals",   "color": "#fdba74"},
    {"key": "skin_temp_max",       "displayName": "Skin Temp Max",         "unit": "°C",    "category": "vitals",   "color": "#fb923c"},
    {"key": "skin_temp_avg",       "displayName": "Skin Temp Avg",         "unit": "°C",    "category": "vitals",   "color": "#f97316"},
    {"key": "stress_min",          "displayName": "Stress Min",            "unit": "/100",  "category": "mood",     "color": "#a3e635", "normalRangeMin": 0,  "normalRangeMax": 25},
    {"key": "stress_max",          "displayName": "Stress Max",            "unit": "/100",  "category": "mood",     "color": "#84cc16", "normalRangeMin": 0,  "normalRangeMax": 75},
    {"key": "stress_avg",          "displayName": "Stress Avg",            "unit": "/100",  "category": "mood",     "color": "#65a30d", "normalRangeMin": 0,  "normalRangeMax": 40},
    {"key": "mood",                "displayName": "Mood",                  "unit": "/10",   "category": "mood",     "color": "#34d399", "normalRangeMin": 1, "normalRangeMax": 10},
    {"key": "pain",                "displayName": "Pain Level",            "unit": "/10",   "category": "mood",     "color": "#ef4444", "normalRangeMin": 0, "normalRangeMax": 10},
    {"key": "calories_burned",     "displayName": "Calories Burned",       "unit": "kcal",  "category": "activity", "color": "#f97316"},
    {"key": "body_fat",            "displayName": "Body Fat %",            "unit": "%",     "category": "body",     "color": "#8b5cf6"},
    {"key": "water_intake",        "displayName": "Water Intake",          "unit": "oz",    "category": "body",     "color": "#38bdf8"},
]


async def _seed_global_foods():
    db = get_app_db()
    now = datetime.utcnow()
    for f in SEED_FOODS:
        await db.food_items.update_one(
            {"name": f["name"], "scope": "global"},
            {
                "$set": {
                    **f,
                    "userId": None,
                    "scope": "global",
                    "tags": [],
                    "source": "seed",
                    "confidence": 1.0,
                    "deletedAt": None,
                    "updatedAt": now,
                },
                "$setOnInsert": {
                    "createdAt": now,
                },
            },
            upsert=True,
        )


async def _seed_global_exercises():
    db = get_app_db()
    # Use the full free-exercise-db if available (873 exercises), else fall back to legacy list
    exercises = _load_external_exercises() or _SEED_EXERCISES_LEGACY
    # Re-seed if we have fewer than the full external DB (handles upgrades from old 30-item seed)
    count = await db.exercises.count_documents({"scope": "global", "source": "free-exercise-db"})
    if count >= len(exercises):
        return
    now = datetime.utcnow()
    # Upsert by externalId so reruns are safe
    for e in exercises:
        ext_id = e.get("externalId")
        filter_ = {"externalId": ext_id, "scope": "global"} if ext_id else {"name": e["name"], "scope": "global"}
        await db.exercises.update_one(
            filter_,
            {"$setOnInsert": {
                **e,
                "userId": None, "scope": "global",
                "source": "free-exercise-db",
                "deletedAt": None, "createdAt": now, "updatedAt": now,
            }},
            upsert=True,
        )


async def _seed_global_metric_types():
    db = get_app_db()
    now = datetime.utcnow()
    for m in SEED_METRIC_TYPES:
        await db.health_metric_types.update_one(
            {"key": m["key"], "scope": "global"},
            {"$setOnInsert": {
                **m,
                "userId": None, "scope": "global", "valueType": "number",
                "normalRangeMin": m.get("normalRangeMin"),
                "normalRangeMax": m.get("normalRangeMax"),
                "description": None, "deletedAt": None,
                "createdAt": now, "updatedAt": now,
            }},
            upsert=True,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    await _seed_global_foods()
    await _seed_global_metric_types()
    await _seed_global_exercises()

    import asyncio
    from lib.gdrive_sync import gdrive_sync_loop
    sync_task = asyncio.create_task(gdrive_sync_loop())
    sync_task.add_done_callback(
        lambda t: __import__('logging').getLogger(__name__).error(
            "GDrive sync loop stopped unexpectedly: %s",
            t.exception() if not t.cancelled() else "cancelled",
        ) if not t.cancelled() else None
    )

    yield

    sync_task.cancel()
    await close_db()


app = FastAPI(
    title="Health Tracker API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

_settings = get_settings()
_cors_origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if _cors_origins else ["*"],
    allow_credentials=bool(_cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

_avatar_dir = os.path.join(_settings.upload_dir, "avatars")
os.makedirs(_avatar_dir, exist_ok=True)
app.mount("/api/avatars", StaticFiles(directory=_avatar_dir), name="avatars")

app.include_router(auth_router, prefix="/api/auth")
app.include_router(health_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(food_router, prefix="/api/food")
app.include_router(medications_router, prefix="/api/medications")
app.include_router(health_stats_router, prefix="/api/stats")
app.include_router(workouts_router, prefix="/api/workouts")
app.include_router(ai_router, prefix="/api/ai")
app.include_router(tokens_router, prefix="/api")
app.include_router(custom_fields_router, prefix="/api/custom-fields")
app.include_router(reminders_router, prefix="/api/reminders")
app.include_router(food_plans_router, prefix="/api/food-plans")
app.include_router(calendar_router, prefix="/api/calendar")
app.include_router(data_router, prefix="/api/data")
app.include_router(db_config_router, prefix="/api/db-config")
app.include_router(cookbook_router, prefix="/api/cookbook")
app.include_router(health_import_router, prefix="/api/health-import")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(gdrive_router, prefix="/api/gdrive")
app.include_router(sync_prefs_router, prefix="/api/sync-preferences")
