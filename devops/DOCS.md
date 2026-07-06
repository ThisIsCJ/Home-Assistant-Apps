# DevOps Platform Add-on

## How it works

The original app ran as five Docker Compose services (frontend, api, monitor, provisioning, mongo) behind Authentik OIDC. As a Home Assistant add-on it runs as **one container**:

```
HA ingress ──► nginx :8099
                ├── /               React SPA (static files)
                ├── /api/requests…  provisioning service 127.0.0.1:4200
                ├── /api/app/…      provisioning service 127.0.0.1:4200
                ├── /api/admin/…    provisioning service 127.0.0.1:4200
                ├── /api/monitor/…  monitor service      127.0.0.1:4100
                └── /api/…          core API             127.0.0.1:4000
                                        │
                                    MongoDB 127.0.0.1:27017 (bundled, /data/mongodb)
```

Key conversion changes:

- **Authentication**: OIDC (Authentik/Microsoft/Google) is replaced by Home Assistant. The Supervisor authenticates every ingress request and forwards the HA user in `X-Remote-User-*` headers; the backend runs with `AUTH_MODE=ha_ingress` and builds the user identity from those headers.
- **Security model**: the identity headers are trustworthy because nothing else can reach the backends — no host ports are exposed, nginx only accepts connections from the ingress gateway (`172.30.32.2`), and the Node services and MongoDB bind to `127.0.0.1` so other add-ons on the internal network cannot talk to them directly. An AppArmor profile confines the container on HA OS.
- **Frontend**: built with relative asset paths and a hash-based router so it works under the dynamic ingress sub-path (`/api/hassio_ingress/<token>/`). The login/setup pages and OIDC admin screens are hidden in HA mode.
- **Database**: MongoDB 7 runs inside the container (capped at a 256 MB WiredTiger cache so it doesn't compete with Home Assistant for RAM) with data in `/data/mongodb`. The setup wizard from the original app is skipped — database and auth are preconfigured.
- **Shared middleware**: the auth/admin middleware that was previously copy-pasted into all three services lives in one shared package (`app/shared/`).
- **Uploads** are stored in `/data/uploads`.

## Configuration

```yaml
app_name: DevOps Platform
admin_group: devops-admins
admin_users: []
log_level: info
```

### `app_name`

Display name used in the UI until you set a site name in **Admin → Branding** (which then takes precedence).

### `admin_group`

Group name granted to platform admins. The Admin UI's group settings are ignored in ingress mode so a misconfigured group can never lock you out.

### `admin_users`

Home Assistant **usernames** that get platform-admin rights (case-insensitive). Leave the list **empty** to make every HA user who can open the panel an admin — the sensible default on a single-user installation. With a non-empty list, users not on it get regular user access only:

```yaml
admin_users:
  - csaba
```

### Database connection

The database connection is **managed inside the app**, not from this config screen. Go to **Admin → Database → Connection**, enter a `mongodb://` / `mongodb+srv://` URI (MongoDB / Atlas / Cosmos / DocumentDB), and **Save & restart** — the add-on verifies the connection, persists it to `/data/db-config.json`, and restarts itself so all services reconnect. When no external URI is set, the bundled `mongod` is used. Use **Revert to bundled** to go back, and **Export/Import** on the same page to migrate data between databases.

> The deprecated `external_mongo_uri` add-on option has been removed. Any value previously set there is migrated to `/data/db-config.json` automatically on the first start after updating.

### `log_level`

Add-on script log verbosity: `debug`, `info`, `warning` or `error`.

## Integrations (n8n, Nginx Proxy Manager, Cloudflare)

Configure these in the web UI under **Admin → Integrations**; they are stored in the database, not in the add-on options.

## Backup & restore

- The add-on is configured with `backup: cold` — Home Assistant briefly stops it while taking a backup so the MongoDB data files are captured in a consistent state.
- The add-on shuts down gracefully (MongoDB gets a clean SIGTERM), so unplanned restarts are safe too.
- Application-level export/import is available in **Admin → Database**.
- `/data` is removed if you **uninstall** the add-on — take a backup first.

## Watchdog

`watchdog: tcp://[HOST]:8099` is set, so the Supervisor automatically restarts the add-on if nginx stops accepting connections. If any internal service crashes, the add-on exits by itself and can be restarted the same way.

## Prebuilt images

By default the Supervisor builds the image locally on install (several minutes on a Raspberry Pi). To ship prebuilt images instead: publish a release with the `Builder` GitHub Action in this repository, then uncomment the `image:` key in `config.yaml` and bump the version.

## Architecture support

`amd64` and `aarch64`. MongoDB publishes no Debian apt packages for arm64, so the add-on takes the `mongod` binary from the official multi-arch `mongo:7.0` Docker image at build time.

Note for ARM boards: MongoDB 7 requires an **ARMv8.2-class CPU**. A Raspberry Pi 5, ODROID N2+, or most recent aarch64 boards work; a **Raspberry Pi 4 does not** (mongod exits immediately with an illegal-instruction error). On a Pi 4, point the add-on at a MongoDB running elsewhere via **Admin → Database → Connection** and it works normally without the bundled database.

## Troubleshooting

- **"Unable to reach the DevOps Platform API"** in the UI: one of the backend services failed. Check the add-on log; the add-on exits (and is restarted by the watchdog) when any internal service crashes.
- **MongoDB fails to start on first boot**: check free disk space; `mongod` needs a few hundred MB for its journal in `/data/mongodb`. Its own log is at `/var/log/mongod.log` inside the container.
- **MongoDB major-version upgrades**: this add-on tracks MongoDB 7.0. A future major bump will ship as a new add-on major version with an explicit migration path (`setFeatureCompatibilityVersion`) — don't point an older datadir at a newer server manually.
