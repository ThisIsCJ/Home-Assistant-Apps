"""
Valid empty responses for Sparky endpoints that don't map to HT features.
The app will render empty states rather than crashing.
"""
from fastapi import APIRouter, Depends
from db_auth import require_user

router = APIRouter()

# ── Exercise library ──────────────────────────────────────────────────────────

@router.get("/exercises/suggested")
async def exercises_suggested(user_info=Depends(require_user)):
    return {"recentExercises": [], "topExercises": []}


@router.get("/exercises/search")
async def exercises_search(user_info=Depends(require_user)):
    return []


@router.get("/v2/exercises/search")
async def exercises_search_v2(user_info=Depends(require_user)):
    return {"exercises": [], "pagination": {"page": 1, "pageSize": 20, "total": 0}}


@router.get("/exercises/")
async def exercises_list(user_info=Depends(require_user)):
    return {"exercises": [], "totalCount": 0}


@router.post("/exercises/")
async def exercises_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/exercises/{exercise_id}")
async def exercises_update(exercise_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": exercise_id, **body}


@router.delete("/exercises/{exercise_id}")
async def exercises_delete(exercise_id: str, user_info=Depends(require_user)):
    return {}


# ── Exercise entries ──────────────────────────────────────────────────────────

@router.get("/v2/exercise-entries/by-date")
async def exercise_entries_by_date(user_info=Depends(require_user)):
    return []


@router.get("/v2/exercise-entries/history")
async def exercise_entries_history(user_info=Depends(require_user)):
    return {"sessions": [], "pagination": {"page": 1, "pageSize": 20, "total": 0}}


@router.post("/exercise-entries/")
async def exercise_entries_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/exercise-entries/{entry_id}")
async def exercise_entries_update(entry_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": entry_id, **body}


@router.delete("/exercise-entries/{entry_id}")
async def exercise_entries_delete(entry_id: str, user_info=Depends(require_user)):
    return {}


# ── Workout presets ───────────────────────────────────────────────────────────

@router.get("/workout-presets")
async def workout_presets(user_info=Depends(require_user)):
    return {"presets": [], "total": 0}


@router.get("/workout-presets/search")
async def workout_presets_search(user_info=Depends(require_user)):
    return []


@router.post("/workout-presets")
async def workout_presets_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/workout-presets/{preset_id}")
async def workout_presets_update(preset_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": preset_id, **body}


@router.delete("/workout-presets/{preset_id}")
async def workout_presets_delete(preset_id: str, user_info=Depends(require_user)):
    return {"message": "deleted"}


# ── Meal templates ────────────────────────────────────────────────────────────

@router.get("/meals")
async def meals(user_info=Depends(require_user)):
    return []


@router.get("/meals/recent")
async def meals_recent(user_info=Depends(require_user)):
    return []


@router.get("/meals/search")
async def meals_search(user_info=Depends(require_user)):
    return []


@router.get("/meals/{meal_id}")
async def meal_get(meal_id: str, user_info=Depends(require_user)):
    return {"id": meal_id, "name": "", "items": []}


@router.post("/meals")
async def meal_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/meals/{meal_id}")
async def meal_update(meal_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": meal_id, **body}


@router.delete("/meals/{meal_id}")
async def meal_delete(meal_id: str, user_info=Depends(require_user)):
    return {}


@router.get("/meals/{meal_id}/deletion-impact")
async def meal_deletion_impact(meal_id: str, user_info=Depends(require_user)):
    return {"affected_entries": 0}


# ── Food-entry meals (logged meal templates) ──────────────────────────────────

@router.get("/food-entry-meals/by-date/{date}")
async def food_entry_meals_by_date(date: str, user_info=Depends(require_user)):
    return []


@router.get("/food-entry-meals/{meal_id}")
async def food_entry_meal_get(meal_id: str, user_info=Depends(require_user)):
    return {"id": meal_id, "components": []}


@router.post("/food-entry-meals")
async def food_entry_meal_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/food-entry-meals/{meal_id}")
async def food_entry_meal_update(meal_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": meal_id, **body}


@router.delete("/food-entry-meals/{meal_id}")
async def food_entry_meal_delete(meal_id: str, user_info=Depends(require_user)):
    return {}


# ── Preset exercise entries ───────────────────────────────────────────────────

@router.post("/exercise-preset-entries/")
async def preset_entries_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/exercise-preset-entries/{entry_id}")
async def preset_entries_update(entry_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": entry_id, **body}


@router.delete("/exercise-preset-entries/{entry_id}")
async def preset_entries_delete(entry_id: str, user_info=Depends(require_user)):
    return {}


# ── External providers ────────────────────────────────────────────────────────

@router.get("/external-providers")
async def external_providers(user_info=Depends(require_user)):
    return []


# ── Water containers ──────────────────────────────────────────────────────────

@router.get("/api/water-containers")
async def water_containers(user_info=Depends(require_user)):
    return []


@router.post("/api/water-containers")
async def water_containers_create(body: dict, user_info=Depends(require_user)):
    return {"id": "stub", **body}


@router.put("/api/water-containers/{container_id}")
async def water_containers_update(container_id: str, body: dict, user_info=Depends(require_user)):
    return {"id": container_id, **body}


@router.delete("/api/water-containers/{container_id}")
async def water_containers_delete(container_id: str, user_info=Depends(require_user)):
    return {}
