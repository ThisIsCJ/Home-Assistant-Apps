# Sparky Bridge — Setup Guide

The Sparky Bridge lets you use the [Sparky Fitness](https://github.com/CodeWithCJ/SparkyFitness) companion app to sync Health Connect data to your Health Tracker instance.

## How it works

```
Sparky app (Android)
        ↓
  sparky-bridge  (port 4001)
        ↓
  Health Tracker API
        ↓
     MongoDB
```

The bridge translates Sparky's API calls into Health Tracker API calls. It runs as a separate container alongside your existing stack.

---

## Step 1 — Generate an API token

The bridge authenticates to the Health Tracker API using a personal API token.

1. Open your Health Tracker web app and sign in.
2. Go to **Settings → API Tokens**.
3. Click **Create token**, give it a name (e.g. `sparky-bridge`), and confirm.
4. Copy the token shown — it starts with `ht_` and is only shown once.

---

## Step 2 — Configure the bridge

Open your `.env` file in the root of the health-tracker directory. Add or update these variables:

```env
# Only needed for email/password login mode — skip if using API key mode
# (see Step 4 for the difference)
HT_API_TOKEN=ht_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BRIDGE_EMAIL=you@example.com
BRIDGE_PASSWORD=a-strong-password

# Optional: your daily goals shown in the Sparky app
GOAL_CALORIES=2000
GOAL_PROTEIN_G=150
GOAL_CARBS_G=225
GOAL_FAT_G=65
GOAL_WATER_ML=2500
GOAL_STEPS=10000
```

**If you use Nginx Proxy Manager with a Custom Location** (location `/sparky` → port 4001), NPM strips the `/sparky` prefix before forwarding, so the bridge must serve at root:

```env
SPARKY_ROOT_PATH=
```

If you proxy the entire domain directly to port 4001 with no prefix stripping, leave it as `/sparky`.

---

## Step 3 — Start the bridge

```bash
docker compose up -d sparky-bridge
```

If the container was already running, restart it to pick up the new env vars:

```bash
docker compose up -d --force-recreate sparky-bridge
```

Confirm it started cleanly:

```bash
docker compose logs sparky-bridge --tail=10
```

You should see:

```
Application startup complete.
Uvicorn running on http://0.0.0.0:4001
```

---

## Step 4 — Configure the Sparky app

1. Open the Sparky Fitness app on your Android device.
2. Go to **Settings** (gear icon, bottom right).
3. Under **Server Configuration**, tap **Add Server** (or edit your existing entry).
4. Set the server URL to your Health Tracker domain with the `/sparky` path:

   ```
   https://health.example.com/sparky
   ```

5. Tap the checkmark to test the connection. It should show a green tick.

### Auth mode — API key (recommended)

- In the Sparky app server settings, choose **API key** auth.
- Paste your `ht_` token directly into the API key field.
- Nothing extra needed in `.env` — the token travels from the app on every request.

### Auth mode — email/password

- In the Sparky app server settings, choose **Email** auth.
- Enter the `BRIDGE_EMAIL` and `BRIDGE_PASSWORD` values you set in `.env`.
- The bridge uses `HT_API_TOKEN` from `.env` to respond to the login — that is the **only** place that env var is used.

---

## Step 5 — Sync your data

1. Go to the **Sync** tab in Sparky.
2. Choose a **Sync Range** (e.g. Last 7 Days for an initial import).
3. Tap **Sync Now**.

After a successful sync, open the Health Tracker dashboard — readings for steps, sleep, heart rate, weight, and any other metrics your device tracks should appear.

---

## What data syncs

| Health Connect metric | Health Tracker metric |
|---|---|
| Steps | Steps |
| Heart Rate | Average Heart Rate |
| Weight | Weight |
| Blood Pressure | Blood Pressure (Sys/Dia) |
| Blood Glucose | Blood Glucose |
| Oxygen Saturation | Oxygen Saturation |
| Body Temperature | Body Temperature |
| Calories Burned | Calories Burned |
| Body Fat | Body Fat % |
| Sleep Session | Sleep Duration + stages |

Food diary entries and body check-ins logged in Sparky also sync to Health Tracker.

---

## Troubleshooting

**Connection failed in the Sparky app**

Check that the bridge is running and reachable:

```bash
curl https://health.example.com/sparky/health
# should return: {"status":"ok"}
```

If you get a 404, your reverse proxy may not be forwarding `/sparky` to port 4001. Add a proxy rule for `/sparky` → `http://localhost:4001`.

**Sync succeeds but data does not appear**

Check the bridge logs immediately after syncing:

```bash
docker compose logs sparky-bridge --tail=30
```

A line like `"error": "Unknown metric key"` means a Health Connect type isn't mapped. Any `httpx.HTTPStatusError` with a 401 means the `HT_API_TOKEN` is wrong or has been revoked — generate a new one and update `.env`.

**Token expired or revoked**

Go back to **Settings → API Tokens** in the web app, revoke the old token, create a new one, and update `HT_API_TOKEN` in `.env`. Then restart the bridge:

```bash
docker compose up -d --force-recreate sparky-bridge
```
