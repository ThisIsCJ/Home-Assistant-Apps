# Building a Home Assistant Add-on Like This One

A recipe for a **single-container Home Assistant add-on** that serves a React
single-page app and an Express API behind HA **ingress**, authenticates users
from the identity headers the Supervisor forwards, gates an **admin** area, and
persists everything in **MongoDB**. This document covers the reusable skeleton —
config, ingress/auth, admin, and database — not any particular app's features.

---

## 1. Architecture at a glance

One Docker container runs **one Node/Express process** that does two jobs:

- **Serves the built React app** (static files from `dist/`, produced by Vite).
- **Serves the JSON API** under `/api/*`, talking to MongoDB.

Home Assistant sits in front as an **ingress proxy**: the add-on is *only*
reachable through the Supervisor, which authenticates the HA user in the HA
frontend and forwards their identity as request headers. There is no login
screen, no token handling, and no separate web server (nginx) — Express handles
static files and API on the same port.

```
Browser ──▶ Home Assistant frontend ──▶ Supervisor ingress proxy
                                             │  (adds X-Remote-User-* headers,
                                             │   strips the ingress path prefix)
                                             ▼
                                   Express (one container, one port)
                                     ├── /api/*   → JSON API ──▶ MongoDB
                                     └── /*       → React SPA (dist/)
```

Persistence lives in **MongoDB** (Atlas, self-hosted, DocumentDB, etc.), *not*
in the add-on. The `/data` volume is used only for the options file and any
uploaded files you choose to keep on disk.

---

## 2. Repository layout

A Home Assistant **add-on repository** is a git repo containing a
`repository.yaml` (or `.json`) and one directory per add-on:

```
.
├── repository.yaml           # repo metadata (name, url, maintainer)
└── myapp/                     # one add-on
    ├── config.yaml            # add-on manifest — the most important file
    ├── Dockerfile             # two-stage: build UI, then runtime image
    ├── run.sh                 # container entrypoint
    ├── package.json           # deps for BOTH the Vite build and the server
    ├── vite.config.js
    ├── index.html
    ├── DOCS.md                # shown in the add-on's Documentation tab
    ├── server/                # Express API
    │   ├── server.js          # app setup, route mounting, static + SPA, startup
    │   ├── config.js          # reads /data/options.json
    │   ├── db.js              # single MongoDB client
    │   ├── middleware/
    │   │   ├── ingressAuth.js # identity from HA headers → req.user
    │   │   └── access.js      # requireAccess / requireAdmin, access config
    │   └── routes/
    │       ├── things.js      # feature routes
    │       └── admin.js       # admin-only routes
    └── src/                    # React single-page UI
        ├── main.jsx           # entry — HashRouter + providers
        ├── App.jsx            # top-level routes, whoami bootstrap
        ├── lib/api.js         # fetch wrapper that respects the ingress base
        └── pages/…
```

`repository.yaml`:

```yaml
name: My Add-on Repository
url: https://github.com/your-org/your-repo
maintainer: You <you@example.com>
```

---

## 3. The add-on manifest — `config.yaml`

This is what makes the directory an add-on. The load-bearing fields for this
pattern:

```yaml
name: My App
version: "1.0.0"
slug: myapp
description: >-
  One-line summary shown in the add-on store.
url: https://github.com/your-org/your-repo

arch:                 # multi-arch; node:20-alpine has images for all of these
  - aarch64
  - amd64
  - armv7
  - armhf
  - i386

init: false           # we exec our own process (run.sh), not s6/init
ingress: true         # serve through the Supervisor ingress proxy
ingress_port: 4100    # the internal port Express listens on
panel_icon: mdi:view-dashboard   # sidebar icon (Material Design Icons)
panel_title: My App              # sidebar label
hassio_api: false     # not needed for this pattern
homeassistant_api: false

# User-editable settings (Configuration tab). `options` = defaults,
# `schema` = validation/types (the trailing "?" makes a field optional).
options:
  mongo_uri: ""
  mongo_db: myapp
  everyone_is_admin: false
  admin_users: []
schema:
  mongo_uri: str?
  mongo_db: str?
  everyone_is_admin: bool?
  admin_users:
    - str
```

Key points:

- **`ingress: true` + `ingress_port`** is what puts the app in the HA sidebar and
  routes traffic through the authenticated proxy. `ingress_port` must match the
  port your server binds.
- **`options` / `schema`** define the Configuration form. HA writes the user's
  values to `/data/options.json` at container start; the server reads that file.
- **`arch`** lists the CPU architectures you publish. Because the base image
  (`node:20-alpine`) is multi-arch, one Dockerfile covers all of them.

---

## 4. Options & runtime config — `server/config.js`

Home Assistant writes the resolved options to `/data/options.json`. Read it once
and expose typed getters. Fall back to environment variables so the same image
runs outside HA (local dev, plain `docker run`).

```js
import fs from 'fs';

const OPTIONS_PATH = process.env.OPTIONS_PATH || '/data/options.json';
let cached = null;

function readOptions() {
  if (cached) return cached;
  try {
    if (fs.existsSync(OPTIONS_PATH)) {
      cached = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
      return cached;
    }
  } catch (err) {
    console.error(`Failed to read ${OPTIONS_PATH}:`, err.message);
  }
  cached = {};
  return cached;
}

export const getMongoUri = () => readOptions().mongo_uri || process.env.MONGODB_URI || '';
export const getMongoDb  = () => readOptions().mongo_db  || process.env.MONGODB_DB  || 'myapp';

// Users allowed to administer everything. Matched (lowercased) against the HA
// username OR display name.
export const getAdminUsers = () => {
  const list = readOptions().admin_users;
  return Array.isArray(list) ? list.map((v) => `${v || ''}`.trim().toLowerCase()).filter(Boolean) : [];
};

// Household mode: every ingress user is an admin.
export const everyoneIsAdmin = () => readOptions().everyone_is_admin === true;
```

> Never log the raw Mongo URI — it contains credentials. Mask the password
> before printing any config summary.

---

## 5. Ingress & authentication

This is the crux of the pattern. **You do not implement login.** Home Assistant
already authenticated the user; the Supervisor forwards their identity as
headers to your add-on, and — critically — the add-on is only reachable *through*
the Supervisor, so those headers are trustworthy.

Headers the proxy forwards:

| Header | Meaning |
|---|---|
| `X-Remote-User-Id` | stable HA user id (uuid) |
| `X-Remote-User-Name` | username |
| `X-Remote-User-Display-Name` | friendly display name |
| `X-Ingress-Path` | the ingress prefix that was stripped from the URL |

`server/middleware/ingressAuth.js` turns those into `req.user`:

```js
import { getAdminUsers, everyoneIsAdmin } from '../config.js';

export function ingressUser(req, _res, next) {
  const id = req.get('X-Remote-User-Id') || 'local';       // fallback for local dev
  const username = req.get('X-Remote-User-Name') || '';
  const displayName = req.get('X-Remote-User-Display-Name') || '';
  const name = displayName || username || 'Home Assistant User';

  const admins = getAdminUsers();
  const isAdmin =
    everyoneIsAdmin() ||
    admins.includes(username.toLowerCase()) ||
    admins.includes(displayName.toLowerCase());

  req.user = { id, name, username, displayName, isAdmin };
  next();
}
```

Notes:

- **Local-dev fallback.** When accessed directly (no ingress), the headers are
  absent, so it falls back to a single `local` identity. The app stays usable
  outside HA.
- **Admin is derived here**, from the config file — no roles stored per request.

Expose a tiny endpoint so the frontend can learn who it is:

```js
app.get('/api/whoami', ingressUser, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, isAdmin: req.user.isAdmin });
});
```

---

## 6. Access control & the admin area

Two middlewares gate routes. Compose them per route as arrays.

```js
// server/middleware/access.js
import { getDb, isConnected } from '../db.js';

const CONFIG_COLLECTION = 'appConfig';
const ACCESS_DOC_ID = 'access';

// Admins always pass. Otherwise consult an admin-managed access list stored in
// the DB: "everyone" mode lets any ingress user in; "selected" mode requires the
// user id (or a pre-registered name) to be listed.
export async function requireAccess(req, res, next) {
  if (req.user?.isAdmin) return next();
  try {
    const cfg = await getAccessConfig();               // cached read from DB
    if (cfg.mode !== 'selected') return next();
    if (cfg.allowedUserIds.includes(req.user?.id)) return next();
    // …optional: match by username/display name for users not yet recorded…
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.status(403).json({ error: 'You do not have access. Ask an admin.' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  res.status(403).json({ error: 'Admins only' });
}
```

Mount protected routes by spreading the middleware chain. Put `ingressUser`
first so `req.user` exists before the gates run:

```js
// feature routes: any allowed user
const requireUser  = [ingressUser, requireAccess];
router.get('/things', ...requireUser, handler);

// admin routes: admins only
const requireAdminChain = [ingressUser, requireAdmin];
router.get('/admin/settings', ...requireAdminChain, handler);
router.put('/admin/access',   ...requireAdminChain, handler);   // edit the access list
```

**The admin area itself** is just routes under `/api/<app>/admin/*` guarded by
`requireAdmin`, plus an admin-only page in the SPA. Typical admin capabilities in
this pattern:

- View the directory of users who have visited (recorded on each request, throttled).
- Set access mode (`everyone` vs `selected`) and the allow-list — persisted to a
  single config document in MongoDB.
- Any destructive/global operations (purge, restore, export/import, etc.).

Because admin status comes from `config.yaml` (`admin_users` / `everyone_is_admin`),
the site owner controls it from the HA Configuration tab — no in-app role
management needed.

---

## 7. The database layer — `server/db.js`

**One** MongoClient for the whole process. Connect on startup; expose `getDb()`
and `isConnected()`. Every route checks connectivity and degrades gracefully
(503) instead of crashing, because MongoDB may be unreachable when the container
starts.

```js
import { MongoClient } from 'mongodb';
import { getMongoUri, getMongoDb } from './config.js';

let client = null, db = null, connectionError = null;

export async function connect(uri, dbName) {
  const mongoUri = uri || getMongoUri();
  if (!mongoUri) throw new Error('No MongoDB URI configured');
  const c = new MongoClient(mongoUri, { connectTimeoutMS: 5000, serverSelectionTimeoutMS: 5000 });
  await c.connect();
  client = c;
  db = c.db(dbName || getMongoDb());
  connectionError = null;
  return db;
}

export const getDb = () => { if (!db) throw new Error('Database not connected'); return db; };
export const isConnected = () => !!db;
export const getConnectionError = () => connectionError;
```

Every DB-touching route starts with the same guard:

```js
if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
```

Conventions worth adopting:
- **Single client**, shared across routes — never open a second one per request.
- **User-scoped documents** key on `req.user.id` and upsert with `{ upsert: true }`.
- **Config/singletons** (like the access list) live in one document with a fixed
  `_id` (e.g. `'access'`).

---

## 8. Server wiring — `server/server.js`

The server mounts the API, serves the static build, and injects the ingress path
into the HTML so the browser can build correct URLs.

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { connect, isConnected, getConnectionError } from './db.js';
import { getMongoUri } from './config.js';
import { ingressUser } from './middleware/ingressAuth.js';
import thingsRouter from './routes/things.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');
const PORT = Number(process.env.PORT || 4100);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// --- API (most specific first) ---
app.use('/api/myapp/admin', adminRouter);
app.use('/api/myapp', thingsRouter);
app.get('/api/whoami', ingressUser, (req, res) =>
  res.json({ id: req.user.id, name: req.user.name, isAdmin: req.user.isAdmin }));
app.get('/health', (_req, res) =>
  res.json({ ok: true, connected: isConnected(), connectionError: getConnectionError() || null }));

// --- Static SPA with ingress-path injection ---
// HA strips "/api/hassio_ingress/<token>" before forwarding and passes it in
// X-Ingress-Path. Inject it into the HTML so the SPA can build absolute API URLs.
let indexTemplate = null;
function sendIndex(req, res) {
  if (indexTemplate === null)
    indexTemplate = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';
  if (!indexTemplate) return res.status(500).send('Frontend build not found.');
  const ingressPath = (req.get('X-Ingress-Path') || '').replace(/\/+$/, '');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(indexTemplate.replaceAll('%%INGRESS_PATH%%', ingressPath));
}

app.use(express.static(DIST_DIR, { index: false }));
app.get('*', (req, res) => {                         // SPA fallback
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  sendIndex(req, res);
});

// --- Startup: connect if configured, but always listen ---
async function start() {
  if (getMongoUri()) {
    try { await connect(); console.log('Connected to MongoDB'); }
    catch (err) { console.error('Mongo connection failed:', err.message,
      '— UI loads, API returns 503 until reachable.'); }
  } else {
    console.warn('No mongo_uri configured — API returns 503.');
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Listening on :${PORT}`));
}
start();
```

Load-bearing details:
- **Route order:** register `/api/*` and `/health` before the static handler; the
  `app.get('*')` SPA fallback must return the app shell for non-API paths and a
  JSON 404 for unmatched API paths.
- **Always `listen`,** even if Mongo is down — otherwise a misconfigured DB makes
  the whole panel unavailable instead of showing an error state.
- **`no-store` on index.html** so the freshly-injected ingress path is never
  cached across sessions.

---

## 9. The frontend

Three things make a normal Vite + React SPA work under ingress:

**a) Relative asset base** — `vite.config.js`:

```js
export default defineConfig({
  base: './',                         // relative asset URLs resolve under any prefix
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4100' } }, // dev only
});
```

**b) Hash routing** — `src/main.jsx` uses `HashRouter`, so routes live in the URL
fragment (`#/admin`) and are unaffected by ingress path rewriting. No `basename`
juggling:

```jsx
import { HashRouter } from 'react-router-dom';
// …
<HashRouter><App /></HashRouter>
```

**c) An API wrapper that prepends the ingress base** — `src/lib/api.js`. The
server injected `window.__INGRESS_PATH__` into `index.html`; every request is
built relative to it:

```js
export const ingressBase = () =>
  (typeof window !== 'undefined' && window.__INGRESS_PATH__) || '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${ingressBase()}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  get:  (p)    => apiFetch(p, { method: 'GET' }),
  post: (p, b) => apiFetch(p, { method: 'POST', body: JSON.stringify(b) }),
  put:  (p, b) => apiFetch(p, { method: 'PUT',  body: JSON.stringify(b) }),
  delete:(p)   => apiFetch(p, { method: 'DELETE' }),
};
```

`index.html` supplies the injection point and (optionally) a no-flash theme
bootstrap:

```html
<script>window.__INGRESS_PATH__ = "%%INGRESS_PATH%%";</script>
```

**Bootstrapping identity in the UI** — `App.jsx` calls `/whoami` once and gates
the admin UI on the result:

```jsx
const [me, setMe] = useState({ id: 'me', name: 'You', isAdmin: false });
useEffect(() => {
  api.get('/whoami')
    .then((res) => res?.id && setMe({ id: res.id, name: res.name || 'You', isAdmin: !!res.isAdmin }))
    .catch(() => { /* keep the local fallback identity */ });
}, []);
// …
{me.isAdmin && <Link to="/admin">Admin</Link>}
```

> Frontend gating is **cosmetic** — it hides the admin link. Real enforcement is
> the `requireAdmin` middleware on the server. Never trust the client.

---

## 10. Container — `Dockerfile` + `run.sh`

Two-stage build: compile the UI, then a lean runtime image with only the
server's production dependencies.

```dockerfile
# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS builder
WORKDIR /build
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime ----
# node:20-alpine is multi-arch, so this covers every arch in config.yaml.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY run.sh ./run.sh
COPY --from=builder /build/dist ./dist
RUN chmod a+x /app/run.sh
ENV NODE_ENV=production PORT=4100
EXPOSE 4100
CMD [ "/app/run.sh" ]
```

`run.sh` is a thin entrypoint — HA has already mounted the options file:

```sh
#!/bin/sh
set -e
echo "[myapp] starting…"
[ -f /data/options.json ] && echo "[myapp] options.json found" \
                          || echo "[myapp] no options.json (running outside HA?)"
exec node server/server.js
```

> `package.json` here holds **both** the frontend build deps (as devDependencies)
> and the server's runtime deps (as dependencies). Stage 1 installs everything to
> build; stage 2 installs `--omit=dev` so only `express`, `mongodb`, etc. ship.

---

## 11. Development workflow

```bash
npm install          # frontend + server deps
npm run build        # build the UI into ./dist
npm run start        # server on :4100 (serves ./dist + /api)

# or, with live reload:
npm run dev          # Vite dev server on :5173, proxies /api → :4100
npm run dev:server   # server with --watch on :4100
```

Point the server at MongoDB during dev via env vars or a local options file:

```bash
MONGODB_URI="mongodb://localhost:27017" MONGODB_DB=myapp npm run start
```

With no ingress headers present, you're the `local` fallback user. To exercise
admin locally, set `everyone_is_admin: true` in a local `/data/options.json` (or
`OPTIONS_PATH=./dev-options.json`).

Build the add-on image directly:

```bash
docker build -t myapp-addon ./myapp
docker run --rm -p 4100:4100 \
  -v "$PWD/dev-options.json:/data/options.json:ro" \
  myapp-addon
```

---

## 12. New-add-on checklist

1. **Repo:** create `repository.yaml` + a `myapp/` directory.
2. **Manifest:** write `config.yaml` — set `slug`, `ingress: true`, `ingress_port`,
   `panel_icon`, `panel_title`, and your `options`/`schema`.
3. **Config reader:** `server/config.js` reads `/data/options.json` with env
   fallbacks; expose typed getters and mask secrets.
4. **DB:** `server/db.js` — one client, `getDb()`/`isConnected()`, connect on
   startup, degrade to 503.
5. **Auth:** `server/middleware/ingressAuth.js` maps HA headers → `req.user`
   (with a `local` dev fallback); derive `isAdmin` from config.
6. **Gates:** `requireAccess` / `requireAdmin`; add `GET /api/whoami`.
7. **Routes:** mount admin routes before feature routes; guard every DB route.
8. **Server:** static + SPA fallback + `%%INGRESS_PATH%%` injection; always `listen`.
9. **Frontend:** Vite `base: './'`, `HashRouter`, `api.js` using `ingressBase()`,
   `/whoami` bootstrap, admin UI gated on `me.isAdmin`.
10. **Container:** two-stage `Dockerfile` + `run.sh`; deps split dev vs runtime.
11. **Docs:** `DOCS.md` for the add-on's Documentation tab; bump `version` on every
    change (HA uses it to offer updates).

---

## Why these specific choices

| Decision | Reason |
|---|---|
| **One container, Express serves both** | No nginx to configure; static + API share a port and the ingress proxy. |
| **Trust `X-Remote-User-*` headers** | The add-on is only reachable via the Supervisor, which authenticates the HA user. No login to build. |
| **Admin from `config.yaml`** | Site owner controls admins from the HA UI; no in-app role store. |
| **`HashRouter` + `base: './'`** | Immune to the ingress path prefix the Supervisor strips/rewrites. |
| **Inject `%%INGRESS_PATH%%` at request time** | The prefix is per-session and unknown at build time; the browser needs it to call the API. |
| **MongoDB, not `/data`** | Structured, multi-arch-friendly persistence that survives add-on reinstalls; `/data` is just options + optional uploads. |
| **Always `listen`, degrade to 503** | A bad DB config shows an error state instead of taking the whole panel down. |
