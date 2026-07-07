"""All format-translation helpers between Sparky's API shape and HT's API shape."""

# ── Meal types ────────────────────────────────────────────────────────────────

MEAL_ID_TO_STR: dict[int, str] = {
    1: "breakfast",
    2: "lunch",
    3: "dinner",
    4: "snack",   # morning snack
    5: "snack",   # afternoon snack
    6: "snack",   # evening snack
    7: "other",
}

MEAL_STR_TO_ID: dict[str, int] = {
    "breakfast": 1,
    "lunch": 2,
    "dinner": 3,
    "snack": 4,
    "other": 7,
}

MEAL_TYPE_LIST = [
    {"id": 1, "name": "Breakfast",        "sort_order": 1},
    {"id": 2, "name": "Lunch",            "sort_order": 2},
    {"id": 3, "name": "Dinner",           "sort_order": 3},
    {"id": 4, "name": "Morning Snack",    "sort_order": 4},
    {"id": 5, "name": "Afternoon Snack",  "sort_order": 5},
    {"id": 6, "name": "Evening Snack",    "sort_order": 6},
    {"id": 7, "name": "Other",            "sort_order": 7},
]


# ── Food items ────────────────────────────────────────────────────────────────

def ht_food_to_sparky(food: dict) -> dict:
    n = food.get("nutritionPerServing", {})
    return {
        "id":        food["id"],
        "name":      food["name"],
        "brand":     food.get("brand"),
        "calories":  n.get("calories", 0),
        "protein":   n.get("proteinG", 0),
        "carbs":     n.get("carbsG", 0),
        "fat":       n.get("fatG", 0),
        "fiber":     n.get("fiberG", 0),
        "sugar":     n.get("sugarG", 0),
        "sodium":    n.get("sodiumMg", 0),
        "caffeine":  n.get("caffeineMg", 0),
        "is_verified": True,
        "user_id":   None,
    }


def ht_food_to_sparky_variant(food: dict) -> dict:
    """One HT food item → one Sparky variant (the serving size IS the variant)."""
    ss = food.get("servingSize", {})
    n  = food.get("nutritionPerServing", {})
    food_id = food["id"]
    return {
        "id":                food_id + "_v",
        "food_id":           food_id,
        "serving_size_name": f"{ss.get('amount', 100)} {ss.get('unit', 'g')}",
        "serving_size_value": ss.get("amount", 100),
        "serving_size_unit":  ss.get("unit", "g"),
        "calories":  n.get("calories", 0),
        "protein":   n.get("proteinG", 0),
        "carbs":     n.get("carbsG", 0),
        "fat":       n.get("fatG", 0),
        "fiber":     n.get("fiberG", 0),
        "sugar":     n.get("sugarG", 0),
        "sodium":    n.get("sodiumMg", 0),
        "caffeine":  n.get("caffeineMg", 0),
        "is_default": True,
    }


def ht_log_to_sparky_entry(log: dict, food: dict, user_id: str) -> dict:
    qty = log.get("quantity", 1.0)
    n   = food.get("nutritionPerServing", {})

    def s(field: str) -> float:
        return round((n.get(field) or 0) * qty, 2)

    logged_at  = log.get("loggedAt", "")
    entry_date = logged_at[:10] if logged_at else ""
    meal_str   = log.get("mealType", "other")
    food_id    = log.get("foodItemId", "")

    return {
        "id":             log["id"],
        "user_id":        user_id,
        "food_id":        food_id,
        "food_variant_id": food_id + "_v",
        "food_name":      food.get("name", ""),
        "meal_type_id":   MEAL_STR_TO_ID.get(meal_str, 7),
        "entry_date":     entry_date,
        "servings":       qty,
        "calories":  s("calories"),
        "protein":   s("proteinG"),
        "carbs":     s("carbsG"),
        "fat":       s("fatG"),
        "fiber":     s("fiberG"),
        "sugar":     s("sugarG"),
        "sodium":    s("sodiumMg"),
        "caffeine":  s("caffeineMg"),
        "created_at": log.get("createdAt", ""),
        "updated_at": log.get("updatedAt", ""),
    }


# ── Measurements / health stats ───────────────────────────────────────────────

# Sparky check-in field → (HT metric key, unit)
CHECKIN_TO_METRIC: dict[str, tuple[str, str]] = {
    "weight":              ("weight",             "lb"),
    "body_fat_percentage": ("body_fat",           "%"),
    "steps":               ("steps",              "steps"),
    "neck":                ("neck_circumference",  "in"),
    "waist":               ("waist_circumference", "in"),
    "hips":                ("hip_circumference",   "in"),
    "height":              ("height",              "in"),
}

METRIC_TO_CHECKIN: dict[str, str] = {v[0]: k for k, v in CHECKIN_TO_METRIC.items()}


# ── Health-data bulk sync type mapping ───────────────────────────────────────

# Maps Sparky/Health Connect type strings → HT metric key + unit.
# The companion app sends snake_case types; PascalCase variants kept for safety.
HEALTH_DATA_TYPE_MAP: dict[str, tuple[str, str]] = {
    # snake_case — actual strings sent by the Sparky companion Android app
    "step":                       ("steps",           "steps"),
    "steps":                      ("steps",           "steps"),
    "heart_rate":                 ("heart_rate_avg",  "bpm"),
    "weight":                     ("weight",           "lb"),
    "blood_pressure_systolic":    ("bp_systolic",     "mmHg"),
    "blood_pressure_diastolic":   ("bp_diastolic",    "mmHg"),
    "blood_glucose":              ("blood_glucose",   "mg/dL"),
    "oxygen_saturation":          ("spo2",            "%"),
    "body_temperature":           ("body_temp",        "°F"),
    "basal_body_temperature":     ("body_temp",        "°F"),
    "active_calories":            ("calories_burned", "kcal"),
    "total_calories":             ("calories_burned", "kcal"),
    "calories_burned":            ("calories_burned", "kcal"),
    "body_fat":                   ("body_fat",         "%"),
    "sleep_duration":             ("sleep_duration",   "min"),
    "sleep_deep":                 ("sleep_deep",       "min"),
    "sleep_rem":                  ("sleep_rem",        "min"),
    "sleep_light":                ("sleep_light",      "min"),
    # PascalCase — kept as fallback
    "HeartRate":                  ("heart_rate_avg",  "bpm"),
    "Steps":                      ("steps",           "steps"),
    "Weight":                     ("weight",           "lb"),
    "BloodPressureSystolic":      ("bp_systolic",     "mmHg"),
    "BloodPressureDiastolic":     ("bp_diastolic",    "mmHg"),
    "BloodGlucose":               ("blood_glucose",   "mg/dL"),
    "OxygenSaturation":           ("spo2",            "%"),
    "BodyTemperature":            ("body_temp",        "°F"),
    "CaloriesBurned":             ("calories_burned", "kcal"),
    "BodyFat":                    ("body_fat",         "%"),
    "SleepDuration":              ("sleep_duration",   "min"),
    "SleepDeep":                  ("sleep_deep",       "min"),
    "SleepREM":                   ("sleep_rem",        "min"),
    "SleepLight":                 ("sleep_light",      "min"),
}
