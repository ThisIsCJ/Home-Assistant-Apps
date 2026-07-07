#!/usr/bin/env python3
"""
Health Tracker MCP Server — SSE transport

Runs as a Docker service, proxied through nginx at /mcp/.
Claude Desktop connects via:
  https://health.cjsaba.com/mcp/sse
  Authorization: Bearer ht_your_token

Windows Claude Desktop config (%APPDATA%\Claude\claude_desktop_config.json):
{
  "mcpServers": {
    "health-tracker": {
      "url": "https://health.cjsaba.com/mcp/sse",
      "headers": { "Authorization": "Bearer ht_your_token_here" }
    }
  }
}
"""

import os
import uvicorn
from contextvars import ContextVar
from datetime import datetime, timedelta
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
import httpx

API_URL = os.environ.get("HEALTH_TRACKER_API_URL", "http://api:8000").rstrip("/")
PUBLIC_HOST = os.environ.get("PUBLIC_HOST", "")

# Per-connection token stored in a ContextVar so concurrent connections are isolated
_token: ContextVar[str] = ContextVar("token", default="")

# Disable DNS rebinding protection — this server sits behind nginx/NPM which
# already handles TLS and host validation. mcp-remote doesn't send an Origin.
mcp = FastMCP(
    "health-tracker",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    ),
    streamable_http_path="/",
)


async def _get(path: str, params: dict | None = None):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API_URL}/api{path}",
            headers={"Authorization": f"Bearer {_token.get()}"},
            params=params,
        )
        r.raise_for_status()
        return r.json()


async def _post(path: str, body: dict):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API_URL}/api{path}",
            headers={"Authorization": f"Bearer {_token.get()}"},
            json=body,
        )
        r.raise_for_status()
        return r.json()


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool()
async def list_metric_types() -> str:
    """List all available health metric types (weight, blood pressure, heart rate, etc.)."""
    types = await _get("/stats/metric-types")
    lines = [
        f"- {t['displayName']} (key={t['key']}, unit={t['unit']}, id={t['id']})"
        for t in types
    ]
    return "Available metric types:\n" + "\n".join(lines)


@mcp.tool()
async def get_health_readings(
    metric_key: str = "",
    days: int = 30,
    limit: int = 50,
) -> str:
    """
    Get health readings for the authenticated user.

    Args:
        metric_key: Filter by metric key (e.g. 'weight', 'heart_rate'). Empty = all metrics.
        days: How many days back to query (default 30, max 365).
        limit: Max number of readings to return (default 50, max 200).
    """
    date_from = (datetime.utcnow() - timedelta(days=min(days, 365))).strftime("%Y-%m-%dT%H:%M:%S")
    params: dict = {"limit": min(limit, 200), "date_from": date_from}
    if metric_key:
        types = await _get("/stats/metric-types")
        mt = next((t for t in types if t["key"] == metric_key), None)
        if not mt:
            keys = ", ".join(t["key"] for t in types)
            return f"Unknown metric key '{metric_key}'. Valid keys: {keys}"
        params["metric_type_id"] = mt["id"]

    data = await _get("/stats/readings", params=params)
    readings = data if isinstance(data, list) else data.get("readings", [])

    if not readings:
        return f"No readings found{' for ' + metric_key if metric_key else ''} in the last {days} days."

    lines = [
        f"- {r.get('metricName', metric_key)}: {r.get('value')} {r.get('unit', '')}  [{str(r.get('takenAt', r.get('createdAt', '')))[:10]}]"
        for r in readings
    ]
    return f"{len(readings)} reading(s):\n" + "\n".join(lines)


@mcp.tool()
async def get_health_summary(days: int = 7) -> str:
    """
    Get a concise summary of all health metrics over a recent time period.

    Args:
        days: How many days to summarise (default 7).
    """
    date_from = (datetime.utcnow() - timedelta(days=min(days, 365))).strftime("%Y-%m-%dT%H:%M:%S")
    data = await _get("/stats/readings", params={"date_from": date_from, "limit": 500})
    readings = data if isinstance(data, list) else data.get("readings", [])

    if not readings:
        return f"No health data recorded in the last {days} days."

    by_metric: dict = {}
    for r in readings:
        name = r.get("metricName") or r.get("metricKey") or "unknown"
        unit = r.get("unit", "")
        by_metric.setdefault(name, {"values": [], "unit": unit})["values"].append(r.get("value", 0))

    lines = [f"Health summary — last {days} days:"]
    for name, info in sorted(by_metric.items()):
        vals = info["values"]
        avg = sum(vals) / len(vals)
        lines.append(
            f"  {name}: avg={avg:.1f} {info['unit']}  "
            f"min={min(vals)}  max={max(vals)}  ({len(vals)} readings)"
        )
    return "\n".join(lines)


@mcp.tool()
async def log_health_reading(
    metric_key: str,
    value: float,
    notes: str = "",
    taken_at: str = "",
) -> str:
    """
    Log a numeric health reading (weight, blood pressure, heart rate, blood glucose, etc.).

    ⚠️  Do NOT use this for food or beverages (coffee, tea, meals, drinks).
        Use log_food_entry instead for all food and beverage consumption.
        water_intake is the only drink-related metric here — for plain hydration water only.

    Args:
        metric_key: The metric key to log (e.g. 'weight', 'heart_rate'). Use list_metric_types to see valid keys.
        value: Numeric value to record.
        notes: Optional note to attach.
        taken_at: ISO datetime string for when the reading was taken (default: now).
    """
    types = await _get("/stats/metric-types")
    mt = next((t for t in types if t["key"] == metric_key), None)
    if not mt:
        keys = ", ".join(t["key"] for t in types)
        return f"Unknown metric key '{metric_key}'. Valid keys: {keys}"

    body: dict = {"metricTypeId": mt["id"], "value": value, "notes": notes, "source": "mcp"}
    if taken_at:
        body["takenAt"] = taken_at

    result = await _post("/stats/readings", body)
    return f"Logged {mt['displayName']}: {value} {mt['unit']}  (id={result.get('id', '?')})"


@mcp.tool()
async def search_food_items(query: str, limit: int = 10) -> str:
    """
    Search the food item library for existing items by name.

    Args:
        query: Search term (food or beverage name).
        limit: Max results to return (default 10, max 50).
    """
    items = await _get("/food/items", params={"q": query, "scope": "all", "limit": min(limit, 50)})
    if not items:
        return f"No food items found matching '{query}'."
    lines = []
    for i in items:
        n = i.get("nutritionPerServing", {})
        ss = i.get("servingSize", {})
        est = " [estimated]" if i.get("estimated") else ""
        lines.append(
            f"- {i['name']} (id={i['id']}, scope={i.get('scope', '?')}) "
            f"— serving: {ss.get('amount', 1)}{ss.get('unit', 'serving')}, "
            f"{n.get('calories', 0)} kcal, "
            f"P:{n.get('proteinG', 0)}g C:{n.get('carbsG', 0)}g F:{n.get('fatG', 0)}g "
            f"caffeine:{n.get('caffeineMg', 0)}mg{est}"
        )
    return f"{len(items)} result(s) for '{query}':\n" + "\n".join(lines)


@mcp.tool()
async def log_food_entry(
    name: str,
    quantity: float = 1.0,
    serving_amount: float = 1.0,
    serving_unit: str = "serving",
    meal_type: str = "",
    notes: str = "",
    logged_at: str = "",
    calories: float = -1,
    protein_g: float = -1,
    carbs_g: float = -1,
    fat_g: float = -1,
    fiber_g: float = -1,
    sugar_g: float = -1,
    sodium_mg: float = -1,
    caffeine_mg: float = -1,
) -> str:
    """
    Log a food or beverage consumption entry. Use this for ALL food, drinks, and
    beverages — coffee, tea, juice, meals, snacks, etc.

    Do NOT use log_health_reading for food or beverages.

    Searches for an existing food item by name and reuses it when found. Creates a
    new item (marked estimated) when no match exists or when specific nutrition is
    supplied. Use -1 for any nutrition field that is unknown.

    Args:
        name: Food or beverage name (e.g. "Coffee with Half&Half", "Oatmeal").
        quantity: Number of servings consumed (default 1).
        serving_amount: Numeric size of one serving (e.g. 20 for "20 oz coffee").
        serving_unit: Unit of serving size — oz, ml, g, cup, tbsp, piece, etc.
        meal_type: breakfast, lunch, dinner, snack, or other. Empty = auto from time.
        notes: Optional notes.
        logged_at: ISO datetime when consumed (default: now).
        calories: Calories per serving (-1 = unknown).
        protein_g: Protein grams per serving (-1 = unknown).
        carbs_g: Carbohydrate grams per serving (-1 = unknown).
        fat_g: Fat grams per serving (-1 = unknown).
        fiber_g: Dietary fiber grams per serving (-1 = unknown).
        sugar_g: Sugar grams per serving (-1 = unknown).
        sodium_mg: Sodium milligrams per serving (-1 = unknown).
        caffeine_mg: Caffeine milligrams per serving (-1 = unknown).
    """
    from datetime import datetime as _dt

    if not meal_type:
        hour = _dt.utcnow().hour
        if hour < 10:
            meal_type = "breakfast"
        elif hour < 14:
            meal_type = "lunch"
        elif hour < 19:
            meal_type = "dinner"
        else:
            meal_type = "snack"

    nutrition_provided = any(
        v >= 0 for v in [calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, caffeine_mg]
    )

    # Search for an exact name match in the library
    existing = await _get("/food/items", params={"q": name, "scope": "all", "limit": 10})
    food_item_id = None
    for item in existing:
        if item["name"].lower() == name.lower():
            food_item_id = item["id"]
            item_name = item["name"]
            break

    # Create a new item when nothing matched or user supplied specific nutrition
    if not food_item_id or nutrition_provided:
        nutrition = {
            "calories": max(calories, 0) if calories >= 0 else 0,
            "proteinG": max(protein_g, 0) if protein_g >= 0 else 0,
            "carbsG": max(carbs_g, 0) if carbs_g >= 0 else 0,
            "fatG": max(fat_g, 0) if fat_g >= 0 else 0,
            "fiberG": max(fiber_g, 0) if fiber_g >= 0 else 0,
            "sugarG": max(sugar_g, 0) if sugar_g >= 0 else 0,
            "sodiumMg": max(sodium_mg, 0) if sodium_mg >= 0 else 0,
            "caffeineMg": max(caffeine_mg, 0) if caffeine_mg >= 0 else 0,
        }
        new_item = await _post("/food/items", {
            "name": name,
            "servingSize": {"amount": serving_amount, "unit": serving_unit},
            "nutritionPerServing": nutrition,
            "estimated": not nutrition_provided,
        })
        food_item_id = new_item["id"]
        item_name = new_item["name"]
        created = True
    else:
        created = False

    body: dict = {
        "foodItemId": food_item_id,
        "quantity": quantity,
        "servingUnit": serving_unit,
        "mealType": meal_type,
        "notes": notes,
    }
    if logged_at:
        body["loggedAt"] = logged_at

    log = await _post("/food/logs", body)
    snap = log.get("nutritionSnapshot", {})

    msg = f"Logged {quantity}x {item_name} ({meal_type})"
    if snap.get("calories", 0) > 0:
        msg += f" — {snap['calories']} kcal"
    if snap.get("caffeineMg", 0) > 0:
        msg += f", {snap['caffeineMg']} mg caffeine"
    if created and not nutrition_provided:
        msg += " [nutrition unknown — item created as estimated; edit in Foods tab for accuracy]"
    msg += f"  (log id={log.get('id', '?')})"
    return msg


@mcp.tool()
async def get_food_log(date: str = "") -> str:
    """
    Get food log entries for a specific date, grouped by meal.

    Args:
        date: Date in YYYY-MM-DD format (default: today UTC).
    """
    from datetime import datetime as _dt
    if not date:
        date = _dt.utcnow().strftime("%Y-%m-%d")

    logs = await _get("/food/logs", params={
        "date_from": f"{date}T00:00:00",
        "date_to": f"{date}T23:59:59",
        "limit": 200,
    })

    if not logs:
        return f"No food logged on {date}."

    by_meal: dict = {}
    for entry in logs:
        meal = entry.get("mealType", "other")
        by_meal.setdefault(meal, []).append(entry)

    lines = [f"Food log for {date}:"]
    for meal in ("breakfast", "lunch", "dinner", "snack", "other"):
        entries = by_meal.get(meal, [])
        if not entries:
            continue
        lines.append(f"\n{meal.capitalize()}:")
        for e in entries:
            snap = e.get("nutritionSnapshot", {})
            cal = snap.get("calories", 0)
            caf = snap.get("caffeineMg", 0)
            extra = f", {caf} mg caffeine" if caf > 0 else ""
            lines.append(f"  - {e.get('foodName', '?')} x{e.get('quantity', 1)} — {cal} kcal{extra}")

    return "\n".join(lines)


@mcp.tool()
async def get_nutrition_summary(date: str = "") -> str:
    """
    Get daily nutrition totals (calories, macros, caffeine) for a given date.

    Args:
        date: Date in YYYY-MM-DD format (default: today UTC).
    """
    from datetime import datetime as _dt
    if not date:
        date = _dt.utcnow().strftime("%Y-%m-%d")

    data = await _get("/food/summary", params={"date": date})
    totals = data.get("totals", {})
    count = data.get("logCount", 0)

    if count == 0:
        return f"No food logged on {date}."

    lines = [
        f"Nutrition summary for {date} ({count} entries):",
        f"  Calories:  {totals.get('calories', 0):.0f} kcal",
        f"  Protein:   {totals.get('proteinG', 0):.1f} g",
        f"  Carbs:     {totals.get('carbsG', 0):.1f} g",
        f"  Fat:       {totals.get('fatG', 0):.1f} g",
        f"  Fiber:     {totals.get('fiberG', 0):.1f} g",
        f"  Sugar:     {totals.get('sugarG', 0):.1f} g",
        f"  Sodium:    {totals.get('sodiumMg', 0):.0f} mg",
        f"  Caffeine:  {totals.get('caffeineMg', 0):.0f} mg",
    ]
    return "\n".join(lines)


@mcp.tool()
async def list_medications() -> str:
    """List all current medications including dosage, route, and schedule."""
    meds = await _get("/medications")
    if not meds:
        return "No medications on record."

    lines = []
    for m in meds:
        lines.append(
            f"- {m.get('name')} {m.get('dose', '')} "
            f"({m.get('route', '')}) — {m.get('frequency', '')}  [id={m.get('id')}]"
        )
    return f"{len(meds)} medication(s):\n" + "\n".join(lines)


@mcp.tool()
async def log_medication_dose(medication_id: str, notes: str = "", taken_at: str = "") -> str:
    """
    Record a medication dose as taken.

    Args:
        medication_id: The medication id (from list_medications).
        notes: Optional notes.
        taken_at: ISO datetime string (default: now).
    """
    body: dict = {"medicationId": medication_id, "status": "taken", "notes": notes}
    if taken_at:
        body["takenAt"] = taken_at
    result = await _post("/medications/logs", body)
    return f"Dose logged (id={result.get('id', '?')})"


@mcp.tool()
async def get_health_dashboard() -> str:
    """Get an overview of all tracked health metrics — latest reading and trend for each."""
    data = await _get("/stats/dashboard")
    cards = data.get("cards", [])
    if not cards:
        return "No health data recorded yet. Use log_health_reading to add your first reading."

    lines = ["Health dashboard (latest readings):"]
    for card in cards:
        t = card.get("type", {})
        latest = card.get("latestReading", {})
        trend = card.get("trend", "flat")
        change = card.get("change")
        change_str = ""
        if change is not None:
            sign = "+" if change > 0 else ""
            change_str = f" ({sign}{change} {t.get('unit', '')}, {trend})"
        lines.append(
            f"  {t.get('displayName', '?')}: {latest.get('value', '?')} {t.get('unit', '')}"
            f"  [{str(latest.get('takenAt', ''))[:10]}]{change_str}"
            f"  [typeId={t.get('id', '?')}]"
        )
    return "\n".join(lines)


@mcp.tool()
async def get_health_trend(metric_type_id: str, days: int = 30) -> str:
    """
    Get readings for a specific metric over time.

    Args:
        metric_type_id: Metric type ID (from list_metric_types or get_health_dashboard).
        days: How many days to look back (7–365, default 30).
    """
    data = await _get("/stats/trend", params={
        "metric_type_id": metric_type_id,
        "days": min(max(days, 7), 365),
    })
    mt = data.get("metricType", {})
    readings = data.get("readings", [])
    if not readings:
        return f"No readings found for {mt.get('displayName', metric_type_id)} in the last {days} days."

    lines = [f"{mt.get('displayName', metric_type_id)} — last {days} days ({len(readings)} readings):"]
    for r in readings[-20:]:
        lines.append(f"  {str(r.get('takenAt', ''))[:10]}: {r.get('value')} {mt.get('unit', '')}")
    return "\n".join(lines)


@mcp.tool()
async def get_today_medications() -> str:
    """Get all active medications with their log status for today."""
    data = await _get("/medications/today")
    date = data.get("date", "today")
    items = data.get("items", [])
    if not items:
        return "No active medications found."

    lines = [f"Medication status for {date}:"]
    for item in items:
        med = item.get("medication", {})
        status = item.get("status", "pending")
        logs = item.get("logs", [])
        marker = "+" if status == "taken" else "-" if status == "skipped" else "o"
        lines.append(
            f"  [{marker}] {med.get('name')} {med.get('dose', '')} "
            f"({med.get('frequency', '')}) — {status}"
            + (f"  (logged {len(logs)}x)" if logs else "")
            + f"  [id={med.get('id', '?')}]"
        )
    return "\n".join(lines)


@mcp.tool()
async def search_exercises(
    query: str = "",
    category: str = "",
    equipment: str = "",
    limit: int = 10,
) -> str:
    """
    Search the exercise library.

    Args:
        query: Exercise name or keyword to search.
        category: Filter by category — strength, cardio, mobility, recovery.
        equipment: Filter by equipment — barbell, dumbbell, machine, cable, bodyweight, kettlebell, band, other.
        limit: Max results to return (default 10).
    """
    params: dict = {}
    if query:
        params["search"] = query
    if category:
        params["category"] = category
    if equipment:
        params["equipment"] = equipment

    exercises = await _get("/workouts/exercises", params=params)
    if not exercises:
        return "No exercises found matching your criteria."

    lines = []
    for e in exercises[:limit]:
        muscles = ", ".join(e.get("primaryMuscles", []))
        lines.append(
            f"- {e['name']} (id={e['id']}, {e.get('category', '')}, {e.get('equipment', '')}"
            + (f", muscles: {muscles}" if muscles else "")
            + ")"
        )
    return f"{min(len(exercises), limit)} exercise(s) found:\n" + "\n".join(lines)


@mcp.tool()
async def get_workout_dashboard() -> str:
    """Get workout stats: session counts this week/month and recent session list."""
    data = await _get("/workouts/dashboard")
    week_dur = data.get("weekDurationSeconds", 0) or 0
    lines = [
        "Workout dashboard:",
        f"  This week: {data.get('weekSessions', 0)} session(s)"
        + (f", {week_dur // 60} min total" if week_dur else ""),
        f"  This month: {data.get('monthSessions', 0)} session(s)",
    ]
    recent = data.get("recentSessions", [])
    if recent:
        lines.append("\nRecent sessions:")
        for s in recent[:5]:
            dur = s.get("durationSeconds") or 0
            ex_count = len(s.get("exercises", []))
            lines.append(
                f"  - {s.get('name', 'Workout')}  [{str(s.get('startedAt', ''))[:10]}]"
                + (f"  {dur // 60} min" if dur else "")
                + (f"  {ex_count} exercise(s)" if ex_count else "")
                + f"  [id={s.get('id', '?')}]"
            )
    return "\n".join(lines)


@mcp.tool()
async def log_workout_session(
    name: str = "",
    duration_minutes: int = 0,
    notes: str = "",
    started_at: str = "",
    exercises_json: str = "",
) -> str:
    """
    Log a completed workout session.

    Args:
        name: Session name (e.g. "Morning Run", "Push Day"). Auto-generated if empty.
        duration_minutes: Total workout duration in minutes.
        notes: Optional notes.
        started_at: ISO datetime when the workout started (default: now).
        exercises_json: Optional JSON array of exercises. Each item:
            {"exerciseId": "id", "exerciseName": "Name", "category": "cardio",
             "sets": [{"setNumber": 1, "completed": true, "durationSeconds": 1800,
                       "distance": 3.1, "distanceUnit": "mi"}]}
            For strength sets use: "reps", "weight", "weightUnit" instead.
            Use search_exercises to find valid exercise IDs.
    """
    import json as _json

    body: dict = {"notes": notes}
    if name:
        body["name"] = name
    if duration_minutes > 0:
        body["durationSeconds"] = duration_minutes * 60
    if started_at:
        body["startedAt"] = started_at
    if exercises_json:
        try:
            body["exercises"] = _json.loads(exercises_json)
        except _json.JSONDecodeError:
            return "Invalid exercises_json — must be valid JSON array. Check the format in the tool description."

    result = await _post("/workouts/sessions", body)
    ex_count = len(result.get("exercises", []))
    dur = f"{duration_minutes} min" if duration_minutes else ""
    return (
        f"Workout logged: {result.get('name', 'Workout')}"
        + (f"  ({dur})" if dur else "")
        + (f"  {ex_count} exercise(s)" if ex_count else "")
        + f"  (id={result.get('id', '?')})"
    )


@mcp.tool()
async def list_workout_templates() -> str:
    """List saved workout templates (pre-built workout plans you can reuse)."""
    templates = await _get("/workouts/templates")
    if not templates:
        return "No workout templates saved yet."
    lines = []
    for t in templates:
        ex_count = len(t.get("exercises", []))
        lines.append(f"- {t['name']} — {ex_count} exercise(s)  (id={t['id']})")
    return f"{len(templates)} template(s):\n" + "\n".join(lines)


@mcp.tool()
async def get_user_profile() -> str:
    """Get the current user's profile: name, email, and preferences."""
    user = await _get("/me")
    prefs = user.get("preferences", {})
    lines = [
        f"Name: {user.get('displayName') or user.get('name', 'Unknown')}",
        f"Email: {user.get('email', 'Unknown')}",
    ]
    if prefs.get("defaultAiProviderId"):
        lines.append(f"Default AI provider ID: {prefs['defaultAiProviderId']}")
    return "\n".join(lines)


# ── SSE transport + auth middleware ───────────────────────────────────────────

class _TokenMiddleware:
    """
    ASGI middleware — extracts the Bearer token from:
      1. Authorization: Bearer ht_xxx  header
      2. ?token=ht_xxx  query param (fallback for clients that can't set headers)
    Sets it in a ContextVar so tool handlers can pick it up.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = {k.lower(): v for k, v in scope.get("headers", [])}
            auth = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
            token = auth.removeprefix("Bearer ").strip()
            if not token:
                qs = scope.get("query_string", b"").decode("utf-8", errors="ignore")
                for part in qs.split("&"):
                    if part.startswith("token="):
                        token = part[6:]
                        break
            _token.set(token)
        await self.app(scope, receive, send)


if __name__ == "__main__":
    app = _TokenMiddleware(mcp.streamable_http_app())
    uvicorn.run(app, host="0.0.0.0", port=8002, log_level="info")
