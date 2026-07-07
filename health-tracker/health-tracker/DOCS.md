# Health Tracker Add-on — Configuration

## Required options

| Option | Description |
|---|---|
| `mongodb_url` | Connection string to your MongoDB server, e.g. `mongodb://user:pass@192.168.1.10:27017/?authSource=admin`. The add-on does not bundle MongoDB. |
| `ha_url` | *(Home Assistant auth — the default)* The Home Assistant URL users' **browsers** can reach, e.g. `https://ha.example.com` or `http://192.168.1.10:8123`. Login redirects there. |
| `secret_key` | Root secret used to sign login session tokens and to encrypt stored AI provider keys and Google OAuth tokens (Fernet). Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`. Changing it later logs everyone out and makes previously encrypted credentials unreadable. |
| `app_base_url` | The public URL users reach the app at, e.g. `https://health.example.com`. Used to build the Google Drive OAuth redirect URI (`<app_base_url>/api/gdrive/callback`). |

## Optional options

| Option | Default | Description |
|---|---|---|
| `database_name` | `healthtracker` | Base name for the MongoDB databases: `<name>_app` holds shared data, `<name>_u_<user id>` holds each user's data. Changing it after first use starts over with empty databases — existing data stays under the old name. |
| `auth_method` | `home_assistant` | How users sign in: `home_assistant` (your HA users) or `oidc` (Authentik or any OIDC provider). |
| `ha_internal_url` | *(empty)* | HA URL reachable **from the add-on container** for server-side token exchange, if `ha_url` isn't (e.g. hairpin-NAT issues). Try `http://homeassistant:8123`. Empty = use `ha_url`. |
| `oidc_authority` | *(empty)* | *(oidc mode)* OIDC application URL, e.g. `https://auth.example.com/application/o/health-tracker`. |
| `oidc_client_id` | *(empty)* | *(oidc mode)* The OIDC client id (public PKCE client — no secret needed). |
| `oidc_proxy_host` | *(empty)* | *(oidc mode)* Authentik hostname (e.g. `auth.example.com`) to same-origin-proxy `/application/o/*` and avoid CORS. Leave empty to skip the proxy block. |
| `app_name` | `Health Tracker` | Display name in the SPA. |
| `oidc_scope` | `openid profile email` | *(oidc mode)* OIDC scopes requested at login. |
| `oidc_audience` | *(empty)* | *(oidc mode)* Set if the provider issues tokens with a specific audience claim. |
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

## Authentication

### Home Assistant (default)

With `auth_method: home_assistant`, users sign in with their Home Assistant
account — the app redirects to your HA login page (HA's native OAuth flow,
the same one the companion apps use), then issues its own 30-day session
token signed with `secret_key`. Nothing to register in HA: any HA user can
sign in, and HA admins (and the owner) automatically get the app's admin
role. No client id or secret is needed.

Requirements:

- `ha_url` must be a URL the user's **browser** can reach (it's a redirect).
- The add-on must be able to reach HA server-side at the same URL to redeem
  the login code and identify the user (WebSocket API). If it can't — e.g.
  your router won't hairpin the public URL — set `ha_internal_url` to an
  in-network address such as `http://homeassistant:8123`.
- `secret_key` must be set; it signs the session tokens.

Each login briefly creates an HA refresh token which the add-on revokes
immediately after identifying the user, so nothing accumulates under your
HA profile's authorized sessions.

### OIDC (optional)

Set `auth_method: oidc` to use Authentik (or any OIDC provider) instead.
Login uses OIDC Authorization Code + PKCE redirects, which need a stable
origin. Register `<app_base_url>/auth/callback` in your provider and set
`oidc_authority` + `oidc_client_id`.

**Switching methods later creates separate user accounts** — users are keyed
by the identity provider's subject, so data recorded under an OIDC login is
not visible after switching that person to Home Assistant login (and vice
versa).

### Reverse proxy

Front the add-on with your reverse proxy (Nginx Proxy Manager, Traefik, HA's
own nginx add-on) terminating TLS at `app_base_url`, forwarding to
`<ha-host>:8099`. Register `<app_base_url>/api/gdrive/callback` in Google
Cloud Console if you use Google Drive sync.

This add-on intentionally does **not** use HA Ingress: login redirects and
the Android companion/Sparky sync clients require a plain, stable URL that
exists outside an authenticated HA session.

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
