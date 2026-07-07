# Health Tracker Add-on — Configuration

## Required options

| Option | Description |
|---|---|
| `mongodb_url` | Connection string to your MongoDB server, e.g. `mongodb://user:pass@192.168.1.10:27017/?authSource=admin`. The add-on does not bundle MongoDB. |
| `oidc_authority` | Authentik OIDC application URL, e.g. `https://auth.example.com/application/o/health-tracker`. |
| `oidc_client_id` | The OIDC client id (public PKCE client — no secret needed). |
| `secret_key` | Root secret used to encrypt stored AI provider keys and Google OAuth tokens (Fernet). Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`. Changing it later makes previously encrypted credentials unreadable. |
| `app_base_url` | The public URL users reach the app at, e.g. `https://health.example.com`. Used to build the Google Drive OAuth redirect URI (`<app_base_url>/api/gdrive/callback`). |

## Optional options

| Option | Default | Description |
|---|---|---|
| `oidc_proxy_host` | *(empty)* | Authentik hostname (e.g. `auth.example.com`) to same-origin-proxy `/application/o/*` and avoid CORS. Leave empty to skip the proxy block. |
| `app_name` | `Health Tracker` | Display name in the SPA. |
| `oidc_scope` | `openid profile email` | OIDC scopes requested at login. |
| `oidc_audience` | *(empty)* | Set if Authentik issues tokens with a specific audience claim. |
| `usda_api_key` | *(empty)* | FoodData Central key for USDA food search. |
| `cors_origins` | *(empty)* | Comma-separated allowed origins for the API. Empty allows all — set this in production. |
| `environment` | `production` | `development` enables the dev-token auth bypass. **Never use in production.** |
| `sparky_ignored_metrics` | *(empty)* | Comma-separated metric keys the Sparky bridge must not write (e.g. `steps`) when another pipeline is authoritative. Per-user Settings → Sync Sources overrides this. |

## Ports

| Port | Default | Purpose |
|---|---|---|
| 80/tcp | 8099 | Web UI, API, `/sparky`, `/mcp` — everything is reachable here. |
| 4001/tcp | disabled | Direct Sparky bridge port. Only enable if a client can't use `/sparky` on the web port. |
| 8002/tcp | disabled | Direct MCP port. Only enable if a client can't use `/mcp` on the web port. |

## Reverse proxy & OIDC

Login uses OIDC Authorization Code + PKCE redirects, which need a stable origin.
Front the add-on with your reverse proxy (Nginx Proxy Manager, Traefik, HA's
own nginx add-on) terminating TLS at `app_base_url`, forwarding to
`<ha-host>:8099`. Register `<app_base_url>/auth/callback` in Authentik and
`<app_base_url>/api/gdrive/callback` in Google Cloud Console.

This add-on intentionally does **not** use HA Ingress: OIDC redirects and the
Android companion/Sparky sync clients require a plain, stable URL that exists
outside an authenticated HA session.

## Data & persistence

`/data` (persisted by Home Assistant across restarts and updates) holds:

- `/data/uploads` — avatar images and uploads
- `/data/exports` — user data exports
- `/data/config/db-config.json` — admin runtime MongoDB URL override
- `/data/redis` — Redis persistence

Your health data itself lives in MongoDB — back that up separately.

## Mobile sync

- **Sparky / Health Connect app**: server URL `https://<app_base_url>/sparky`,
  Bearer token from Settings → API Tokens.
- **HT Companion app** (`android-companion/` in the source repo): server URL
  `https://<app_base_url>`, posts to `/api/stats/sync`.
- **Health Sync → Google Drive CSVs**: configure per user in
  Settings → Google Drive Sync (each user brings their own Google OAuth client).
