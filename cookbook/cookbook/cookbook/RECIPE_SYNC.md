# Recipe Sync

Recipe Sync lets one cookbook instance pull recipes from another, on demand or
on a schedule. It builds directly on the export/import machinery: a sync is just
an automated, secret-authenticated `export` on the source instance followed by
an `import` (in **sync mode**) on the destination.

It is admin-only and lives under **Admin → Recipe sync** in the UI
(`#/admin/cookbook-sync`).

> **This add-on's architecture.** Unlike the site-template it descends from, this
> Home Assistant add-on stores image bytes as files on the `/data/uploads`
> volume (not in a MongoDB `cookbookImages` collection) and packs archives with
> `adm-zip`. Admin identity comes from Home Assistant's ingress proxy, not a
> bearer token. The design below reflects that.

## Concepts

There are two directions, shown as two sections in the admin page:

- **Sync my recipes** (*inbound*) — you publish access to *this* instance's
  cookbook by creating a **sync link**: a public pull URL plus a secret. Any
  instance holding that secret can read every recipe here. You can create many
  links (e.g. one per peer) and revoke any of them.
- **Sync other recipes** (*outbound*) — you register other instances to pull
  *from*, each with its URL, secret, and a schedule. You can add many sources.
  Each can be run on demand ("Sync now") or automatically on its schedule.

"In" and "out" are independent: two instances that each add the other as an
outbound source, using the other's inbound link, will mirror recipes both ways.

## How a sync merges (important)

Sync uses **sync mode** import, which differs from the manual Import button:

- **Upsert by id.** Each incoming recipe keeps its original `_id`. If a recipe
  with that id already exists it is **updated in place** (via a `bulkWrite` of
  `replaceOne … { upsert: true }`); otherwise it is inserted. Running the same
  sync repeatedly is therefore idempotent — it does **not** pile up duplicates
  the way the manual additive import does.
- **Images are de-duplicated by content hash.** Each imported image's bytes are
  hashed (SHA-256); an image with identical bytes already on the uploads volume
  is reused instead of writing a byte-for-byte copy. The hash → filename map
  lives in the `cookbookImageHashes` collection, so recurring syncs don't bloat
  `/data/uploads`.
- **Additive, never destructive.** A recipe deleted on the source is **not**
  deleted on the destination. The source is authoritative for the recipes it
  sends (fields, steps, reviews are overwritten on update), but sync never
  removes local recipes.
- **Ownership.** Recipes keep their source owner attribution. Ownerless recipes
  are attributed to a synthetic `Recipe Sync` user so admins can still edit them.

## Endpoints

All under `/api/cookbook`. Management routes require a Home Assistant admin (the
ingress identity resolved by `ingressUser` + `requireAdmin`); the pull route uses
the shared sync secret instead.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /sync/pull` | `X-Sync-Secret` header (or `?secret=`) | Returns the whole cookbook as a zip (same format as `GET /export`). This is what a remote instance fetches. |
| `GET /sync` | admin | Full sync config — inbound links (with URL+secret) and outbound sources (with status). |
| `POST /sync/inbound` | admin | Create an inbound sync link. Body `{ label }`. Returns `{ token: { id, label, secret, url, … } }`. |
| `DELETE /sync/inbound/:id` | admin | Revoke an inbound link. |
| `POST /sync/outbound` | admin | Add an outbound source. Body `{ label, url, secret, enabled, schedule }`. |
| `PUT /sync/outbound/:id` | admin | Update a source (same body; recomputes next run). |
| `DELETE /sync/outbound/:id` | admin | Remove a source. |
| `POST /sync/outbound/:id/run` | admin | "Sync now" — pull + merge immediately. Returns run status; `502` if the pull/import failed. |

The pull route returns the same zip that `GET /export` produces — a
`cookbook.json` manifest plus one file per image under `images/` (see
[EXPORT_IMPORT.md](../../EXPORT_IMPORT.md) for the archive format).

## Schedule model

Each outbound source has a `schedule` object. Supported frequencies and their
fields:

```jsonc
{ "frequency": "manual" }                                  // only runs via "Sync now"
{ "frequency": "hours",  "interval": 6 }                   // every 6 hours
{ "frequency": "days",   "interval": 2, "time": "03:00" }  // every 2 days at 03:00
{ "frequency": "weeks",  "dayOfWeek": 1, "time": "03:00" } // weekly, Monday at 03:00 (0=Sun … 6=Sat)
{ "frequency": "months", "dayOfMonth": 1, "time": "03:00" }// monthly on the 1st at 03:00
```

- `time` is `HH:MM`, 24-hour, in the **server's local timezone**.
- `dayOfMonth` is clamped to the month's length (e.g. `31` → last day of a short
  month).
- `interval` is bounded (hours ≤ 8760, days ≤ 365).

`nextRunAt` is computed and stored whenever a source is saved and after every
run. It is the next moment strictly after "now" matching the schedule.

## The scheduler

`lib/sync.js` starts an in-process scheduler (`startSyncScheduler`) when the
add-on connects to MongoDB (see `server.js`). It:

1. Ticks every 60 seconds.
2. Reads the sync config and, for each enabled, non-manual source whose
   `nextRunAt` is due, runs the sync (unless one is already running for that
   source — a per-source in-memory lock prevents overlap).
3. After each run, records `lastStatus` / `lastMessage` / counts / `lastRunAt`
   and recomputes `nextRunAt`.

Because it is in-process, the schedule only advances while the add-on is
running. On restart, a missing `nextRunAt` is backfilled on the next tick (it
does not fire retroactively for a run missed while down — it schedules the next
future occurrence).

## Storage

One document in the `cookbookSync` collection, `_id: "config"`:

```jsonc
{
  "_id": "config",
  "inbound": [
    { "id": "uuid", "label": "Home laptop", "secret": "sync_…",
      "createdAt": "…", "lastUsedAt": "…" }
  ],
  "outbound": [
    { "id": "uuid", "label": "Cabin instance", "url": "https://…/api/cookbook/sync/pull",
      "secret": "sync_…", "enabled": true,
      "schedule": { "frequency": "days", "interval": 1, "time": "03:00" },
      "lastRunAt": "…", "lastStatus": "ok", "lastMessage": "Synced 55 recipe(s), 53 image(s)",
      "lastRecipes": 55, "lastImages": 53, "nextRunAt": "…" }
  ]
}
```

Secrets are stored in plaintext (the admin needs to read them back to paste into
peers), so the whole config is only ever returned to admins. Inbound secrets are
compared with a constant-time hash comparison (`timingSafeEqual` over SHA-256
digests, so a length mismatch never short-circuits).

The `cookbookImageHashes` collection maps each imported image's SHA-256 to the
filename it was stored under, enabling the recurring-sync image dedupe described
above.

## Security notes

- A valid inbound secret grants read access to **every** recipe. Treat it like a
  password; use a distinct link per peer so you can revoke one without disturbing
  the others.
- The pull URL is public (only the secret gates it), so it must be reachable by
  the peer. The generated URL honors forwarded host/proto/ingress headers, but
  Home Assistant ingress paths are per-session — for a stable, externally
  reachable endpoint, expose the add-on through a reverse proxy or a fixed host
  and paste that URL into the peer.

## How it was built (this add-on)

1. **Image dedupe** — `lib/transfer.js` `storeImage(bytes, name, { dedupe })`
   computes a SHA-256 of the bytes and, when `dedupe` is set, reuses an existing
   file recorded in `cookbookImageHashes` instead of writing a copy.
2. **Sync-mode import** — `lib/transfer.js` `importArchive(input, user, { mode })`.
   In `'sync'` mode it keeps each recipe's original `_id`, uses a `bulkWrite` of
   `replaceOne … { upsert: true }` instead of per-recipe `insertOne`, and stores
   images with `dedupe: true`.
3. **Sync library** — `lib/sync.js` owns the `cookbookSync` config document,
   secret generation, `normalizeSchedule` / `computeNextRun`, the outbound runner
   (`runOutboundSource` → fetch the pull URL with `X-Sync-Secret`, then
   `importArchive(buf, syncUser, { mode: 'sync' })`), `requireSyncSecret`, and
   `startSyncScheduler`.
4. **Routes** — `routes/cookbook.js` adds the `GET /sync/pull` endpoint (reusing
   `buildExport`) and the admin-gated `/sync*` management routes.
5. **Server** — `server.js` calls `startSyncScheduler()` after the DB connects.
6. **Frontend** — `src/pages/AdminCookbookSync.jsx`, routed at
   `/admin/cookbook-sync` in `src/App.jsx`, reachable from a "Recipe sync" panel
   in `src/pages/Admin.jsx`. Styles are in `src/app.css`.

No new npm dependencies are required — sync reuses `adm-zip` (already used for
export/import) and Node's built-in `crypto` and `fetch`.

## Related files

- [`server/lib/sync.js`](server/lib/sync.js) — config, scheduler, runner, schedule math
- [`server/lib/transfer.js`](server/lib/transfer.js) — `buildExport()` / `importArchive(…, { mode })` / `storeImage(…, { dedupe })`
- [`server/routes/cookbook.js`](server/routes/cookbook.js) — `/sync/pull` and `/sync*` routes
- [`server/server.js`](server/server.js) — starts the scheduler
- [`src/pages/AdminCookbookSync.jsx`](src/pages/AdminCookbookSync.jsx) — the admin UI
- [EXPORT_IMPORT.md](../../EXPORT_IMPORT.md) — the archive format sync transfers
