# Home Assistant Add-on: Health Tracker

Self-hosted personal health management — nutrition and food logging, medications,
health metrics (vitals, sleep, activity), workouts, reminders, reports, AI-assisted
data import, Google Drive CSV sync, and Android Health Connect integration.

This add-on packages the full Health Tracker stack (React SPA, FastAPI API,
Sparky mobile bridge, MCP server for Claude Desktop, and Redis) into a single
Home Assistant add-on. MongoDB is **not** bundled — point the add-on at your
existing MongoDB server (self-hosted or Atlas).

## Quick start

1. Add this repository to the Home Assistant add-on store
   (Settings → Add-ons → Add-on Store → ⋮ → Repositories).
2. Install **Health Tracker**.
3. Fill in the required options (see Documentation tab): `mongodb_url`,
   `oidc_authority`, `oidc_client_id`, `secret_key`, `app_base_url`.
4. Start the add-on and open the Web UI on port 8099.

## Architecture

One container, five supervised services:

| Service | Port | Role |
|---|---|---|
| nginx | 80 (host: 8099) | Serves the SPA; proxies `/api`, `/sparky`, `/mcp` |
| FastAPI API | internal 8000 | All business logic, Google Drive sync loop |
| Sparky bridge | 4001 (proxied at `/sparky`) | Health Connect / Sparky Android ingest |
| MCP server | internal 8002 (proxied at `/mcp`) | Claude Desktop tools |
| Redis | internal 6379 | Cache |

Persistent state (uploads, exports, runtime DB-config override, Redis dump)
lives in the add-on's `/data` volume and survives updates.
