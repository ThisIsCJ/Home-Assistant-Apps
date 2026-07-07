# Sparky Bridge — AI Developer Notes

This file exists to give future AI assistants full context on how this bridge works, what decisions were made, and how to extend or debug it without re-discovering things the hard way.

## What it does

The Sparky Fitness companion app (https://github.com/CodeWithCJ/SparkyFitness) is a mobile app that expects a specific API. This bridge is a FastAPI service that speaks that API and reads/writes the Health Tracker MongoDB database **directly** — no HTTP hop to the HT API.

```
Sparky mobile app
      ↓  HTTP
 sparky-bridge  (port 4001)
      ↓  Motor (async MongoDB driver)
   MongoDB  (same database as the HT API)
```

### Why direct DB instead of HTTP proxy

- No latency from an extra HTTP hop
- No dependency on the HT API being up
- Token validation is a simple SHA-256 hash lookup against `api_tokens`
- Sync logic (dedup, metric-key resolution) is identical to the HT API — no translation layer

## Critical discovery: Sparky's actual path structure

The initial implementation used `/api/` prefixed routes based on reading the SparkyFitnessServer source. **This was wrong.** The companion mobile app calls paths WITHOUT the `/api/` prefix, and some paths have different names:

| What we expected | What Sparky actually sends |
|---|---|
| `GET /api/identity/user` | `GET /auth/user` |
| `POST /api/health-data` | `POST /health-data` |
| `GET /api/foods` | `GET /foods` |

**Rule:** All Sparky companion app routes have no `/api/` prefix. When adding new routes, do NOT add `/api/` to the path decorator.

## Auth flow

Sparky supports two auth modes configured in its server settings:

**API Key mode (recommended):** User pastes their `ht_…` token directly into Sparky. The app sends it as `Authorization: Bearer ht_…` on every request. `db_auth.py:require_user` SHA-256 hashes the token, looks it up in `app_db.api_tokens`, and returns `(user_doc, user_id_str)`. No login flow needed.

**Session mode:** Sparky POSTs to `/auth/sign-in/email` with email/password. The bridge validates against `BRIDGE_EMAIL` / `BRIDGE_PASSWORD` env vars and returns `HT_API_TOKEN` as the session token. `HT_API_TOKEN` must be a valid `ht_` token that exists in the database.

**Key point:** Token validation is done directly against MongoDB — `db_auth.require_user` is the single Depends used across all authenticated routes. It resolves to `(user_doc, user_id_str)`.

## Path prefix / ROOT_PATH

`main.py` reads `ROOT_PATH` from the environment (default `/sparky`). When set:

```python
app.mount(ROOT_PATH, _build_bridge())
```

This means nginx/NPM can forward `/sparky/…` to port 4001 **without stripping the prefix** — FastAPI strips it when routing to the mounted sub-app. The inner bridge handlers see clean paths like `/auth/user`, `/health-data`, etc.

If `ROOT_PATH` is empty, routes are served at root (for setups where nginx does strip the prefix first).

## File map

| File | Purpose |
|---|---|
| `config.py` | Pydantic settings — `MONGODB_URL`, goals, bridge credentials |
| `database.py` | Motor MongoDB client — `get_app_db()`, `get_user_db(user_id)`, `connect()`, `close()` |
| `db_auth.py` | FastAPI `Depends(require_user)` — validates `ht_` token against DB, returns `(user_doc, user_id)` |
| `serializer.py` | `to_dict()` — converts MongoDB docs to JSON (ObjectId→str, datetime→iso) |
| `mapping.py` | Format-translation: food items, food logs, meal type IDs, check-in fields, health data type map |
| `main.py` | App wiring, ROOT_PATH mounting, DB lifespan connect/disconnect |
| `routes/system.py` | `/ping`, `/health`, `/version` — static responses |
| `routes/auth.py` | `/auth/sign-in/email`, `/auth/sign-out`, `/auth/settings`, `/auth/mfa-factors` |
| `routes/users.py` | `/auth/user`, `/auth/profiles`, `/user-preferences` — reads `app_db.users` |
| `routes/foods.py` | Food search/CRUD — reads `app_db.food_items` + `user_db.food_items` |
| `routes/food_entries.py` | Food diary CRUD — reads/writes `user_db.food_logs` |
| `routes/measurements.py` | Check-ins, water intake — reads/writes `user_db.health_readings` |
| `routes/health_data.py` | Bulk Health Connect sync — writes `user_db.health_readings` (same dedup logic as HT API) |
| `routes/goals.py` | Daily goals (env vars) + daily summary from `user_db.food_logs` + `user_db.health_readings` |
| `routes/stubs.py` | Valid empty responses for exercises, workout presets, meal templates |

## How to debug a 404

1. Run: `docker compose logs sparky-bridge -f`
2. Use the Sparky app — every unhandled request appears as a 404 line
3. The path in the log (after stripping `ROOT_PATH`) is the exact route you need to add
4. Add a handler to the appropriate route file (or `stubs.py` if it's a feature HT doesn't have)
5. `docker compose up --build -d sparky-bridge`

Example log line:
```
GET /sparky/some/new/endpoint HTTP/1.1" 404
```
Strip `/sparky` → need to handle `GET /some/new/endpoint`.

## How to add a new route

```python
# In the appropriate routes/*.py file:
@router.get("/some/endpoint")
async def my_handler(token: str = Depends(require_token)):
    result = await ht_get("/api/ht-side-path", token)
    return translate(result)
```

- Use `Depends(require_token)` on every route that needs auth
- HT API calls go to `http://api:8000` — paths on the HT side DO use `/api/` prefix
- Sparky-facing paths do NOT use `/api/` prefix
- For body parameters on POST/PUT, annotate as `body: dict` or use `body: list = Body(...)` for list payloads (FastAPI requires explicit `Body(...)` for list types or it crashes on startup looking for multipart)

## HT API endpoints used

| Sparky feature | HT endpoint |
|---|---|
| User info | `GET /api/me` |
| Food search | `GET /api/food/items?search=…` |
| Food item CRUD | `GET/POST/PUT/DELETE /api/food/items/{id}` |
| Food log by date | `GET /api/food/logs?date=YYYY-MM-DD` |
| Food log CRUD | `POST/PUT/DELETE /api/food/logs/{id}` |
| Nutrition summary | `GET /api/food/summary?date=…` |
| Health stats readings | `GET /api/stats/readings?date_from=…&date_to=…` |
| Health stats bulk sync | `POST /api/stats/sync` |

## Data model translations

### Food
One HT food item → one Sparky food + one Sparky variant. The variant ID is `{food_id}_v`. See `mapping.py:ht_food_to_sparky` and `ht_food_to_sparky_variant`.

### Meal type IDs
Sparky uses integers (1=breakfast, 2=lunch, 3=dinner, 4-6=snack, 7=other). HT uses strings. See `mapping.py:MEAL_ID_TO_STR` / `MEAL_STR_TO_ID`.

### Measurements / check-ins
Sparky's check-in fields (weight, body_fat_percentage, steps, neck, waist, hips, height) map to HT metric keys via `mapping.py:CHECKIN_TO_METRIC`. Values are written via `POST /api/stats/sync` and read back via `GET /api/stats/readings` filtered by date.

### Health data bulk sync
`POST /health-data` receives a list of typed records. `routes/health_data.py:_item_to_readings` maps each to HT metric keys using `mapping.py:HEALTH_DATA_TYPE_MAP`. Sleep sessions are expanded into multiple readings (total + stages).

### Water intake
Stored as `water_intake` metric in oz. A hardcoded default container (8 fl oz glass) is returned from `GET /water-containers`. The bridge converts drinks × container_size → oz for storage.

## Known stubs (not backed by HT data)

These routes return valid empty responses so the app doesn't crash, but data logged in Sparky for these features is silently dropped:

- Exercise entries and exercise library
- Workout presets
- Meal templates (Sparky's saved meal combos)
- Food-entry meals (logged instances of meal templates)
- External providers

To back any of these with real HT data, implement the translation in the stub handler and proxy to the relevant HT route.

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `HT_SERVER_URL` | Internal URL of the HT API container | `http://api:8000` |
| `HT_API_TOKEN` | `ht_…` token used when `ROOT_PATH` is set and no user token is available. **Must be set.** | — |
| `BRIDGE_EMAIL` / `BRIDGE_PASSWORD` | Credentials for session-login mode | `admin@example.com` / `changeme` |
| `ROOT_PATH` | Sub-path to mount bridge under, e.g. `/sparky` | `/sparky` |
| `GOAL_*` | Default daily goals returned to Sparky | see `.env.example` |

## Rebuild after any change

```bash
docker compose up --build -d sparky-bridge
```

Check logs immediately after:
```bash
docker compose logs sparky-bridge --tail=20
```

A clean start looks like:
```
Application startup complete.
Uvicorn running on http://0.0.0.0:4001
```

Any Python import error on startup means a syntax error or missing dependency — check the full traceback.
