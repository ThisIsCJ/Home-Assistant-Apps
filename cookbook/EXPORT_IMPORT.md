# Cookbook Export & Import

The cookbook module can serialize its entire dataset — every recipe, its images,
and all metadata — into a single portable **zip archive**, and load that archive
back into any instance. This is the mechanism for backups and for moving recipes
between environments.

Images are stored as binary documents in MongoDB (the `cookbookImages`
collection). The export writes each image as its own file inside the zip and
keeps the recipe metadata in a single `cookbook.json` manifest, so the archive is
fully self-contained (one file, no external assets) while staying compact — raw
image bytes, not base64 — and easy to inspect with any zip tool.

## At a glance

| | Endpoint | Who | Body |
|---|---|---|---|
| Export | `GET /api/cookbook/export` | any cookbook user | — |
| Import | `POST /api/cookbook/import` | **admins only** | multipart file field `file` |

Both require a valid `Authorization: Bearer <token>` and cookbook app access.
From the UI, the **Export** and **Import** buttons live in the Cookbook page
header (Import is only shown to admins). Export downloads a file named
`cookbook-export-YYYY-MM-DD.zip`.

## Archive format

The export is a zip file laid out like this:

```
cookbook-export-2026-07-11.zip
├── cookbook.json            # manifest: metadata + full recipe documents
└── images/
    ├── 6a524089ccbda77742cc1d78.jpg
    ├── 7b6350a1ddceb88853dd2e89.png
    └── …                    # one file per referenced image, named <id>.<ext>
```

`cookbook.json` is:

```jsonc
{
  "format": "atlas-cookbook-export",   // fixed identifier, validated on import
  "version": 2,                        // schema version (2 = zip format)
  "exportedAt": "2026-07-11T12:00:00.000Z",
  "recipeCount": 55,
  "imageCount": 53,
  "recipes": [ /* full MongoDB recipe documents */ ],
  "images": [
    {
      "id": "6a524089ccbda77742cc1d78",       // original cookbookImages _id
      "contentType": "image/jpeg",
      "filename": "af4be70a-….jpg",
      "file": "images/6a524089ccbda77742cc1d78.jpg"  // path to the bytes in the zip
    }
  ]
}
```

- **`recipes`** are the complete stored documents — title, description, ingredients,
  steps, nutrition facts, tags/categories, notes, reviews (with ratings), owner
  attribution, and timestamps. Nothing is stripped.
- **`images`** lists only the images actually referenced by the exported recipes
  (via `recipe.imageUrl` and `step.imageUrl` that point at
  `/api/cookbook/images/<id>`). Each entry's `file` field points at the raw bytes
  stored under `images/` in the same zip. Orphaned images in the collection are
  not exported.
- External image URLs (e.g. a pasted `https://…` link that was never ingested) are
  left as-is in the recipe and are **not** bundled — there are no bytes to carry.

> **Legacy JSON archives.** Version 1 exports were a single JSON file with the
> image bytes inlined as base64. Import still accepts those files unchanged, so
> old backups keep working; only the export format changed.

## How export works

Implemented in [`lib/transfer.js`](lib/transfer.js) → `buildExport()`:

1. Read every document from `cookbookRecipes`.
2. Walk each recipe's `imageUrl` and every `step.imageUrl`, collecting the ids of
   all `/api/cookbook/images/<id>` references (deduplicated).
3. Load each referenced image from `cookbookImages` and write its raw bytes into
   the zip under `images/<id>.<ext>`.
4. Write the `cookbook.json` manifest and return the generated zip as a Buffer.
   The route ([`routes/cookbook.js`](routes/cookbook.js) → `GET /export`) sends it
   as a download named `cookbook-export-YYYY-MM-DD.zip`
   (`Content-Type: application/zip`).

## How import works

Implemented in [`lib/transfer.js`](lib/transfer.js) → `importArchive(input, user)`.
The route hands it the raw uploaded bytes; `importArchive` sniffs the `PK` zip
magic and reads the zip's `cookbook.json` + `images/`, or — if the bytes are a
legacy JSON export — parses that instead. Either way it then:

1. **Validate** — reject anything whose `format` is not `atlas-cookbook-export`,
   or whose `version` is newer than this module supports.
2. **Re-store images under fresh ids.** Each image's bytes are read from its file
   in the zip (or, for a legacy archive, decoded from base64) and inserted as a
   **new** `cookbookImages` document (a new `_id`). A map is built from the old URL
   (`/api/cookbook/images/<oldId>`) to the new URL. This guarantees an import can
   never collide with or overwrite images already in the target database.
3. **Rewrite recipes.** For each recipe, `imageUrl` and every `step.imageUrl` are
   remapped through that map (URLs not in the map — e.g. external links — pass
   through unchanged). Embedded review `_id`s and all date fields are converted back
   to proper ObjectId/Date types.
4. **Insert recipes.**
   - If the recipe's original `_id` is still free in the target DB, it is preserved
     (so a restore into an empty instance reproduces the exact ids, keeping any
     links such as notification deep-links valid).
   - If that `_id` is already taken, the recipe is inserted as a **copy** with a new
     `_id`.
   - A recipe with no owner is attributed to the importing admin so it stays
     editable.
5. Return `{ recipes, images }` counts.

### Import is additive

Import **never deletes or overwrites** existing data. Re-importing the same archive
into an instance that already has those recipes produces duplicate copies (with new
ids), not an in-place update. This is the safe default for backup/transfer. If you
need replace/restore or skip-duplicate semantics instead, that would be a new import
mode.

## Size limits

Archives carry image bytes, so they can be large (~13 MB for ~50 photos —
the zip's DEFLATE compression already trims mostly-incompressible photos only
a little, so plan for roughly the sum of the original image sizes).

- The import upload is capped at **200 MB** (multer, in `routes/cookbook.js`).
- nginx allows up to **200 MB** bodies on the `/api/cookbook/` location
  ([`nginx/default.conf.template`](../../nginx/default.conf.template)).
- Individual images remain capped at **15 MB** each (MongoDB's 16 MB BSON document
  limit, enforced in [`lib/imageStore.js`](lib/imageStore.js)).

The import is sent as a multipart file upload (not a JSON request body) specifically
to avoid Express's default JSON body-size limit.

## Example (curl)

```bash
# Export to a zip file
curl -H "Authorization: Bearer $TOKEN" \
  https://your-host/api/cookbook/export -o cookbook-export.zip

# Peek inside (optional)
unzip -l cookbook-export.zip

# Import from that file (admin token required)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@cookbook-export.zip" \
  https://your-host/api/cookbook/import
# → {"ok":true,"recipes":55,"images":53}
```

## Related files

- [`lib/transfer.js`](lib/transfer.js) — `buildExport()` / `importArchive()`
- [`lib/imageStore.js`](lib/imageStore.js) — DB-backed image storage the archive draws from
- [`routes/cookbook.js`](routes/cookbook.js) — `GET /export`, `POST /import`
- [`../../src/pages/Cookbook.jsx`](../../src/pages/Cookbook.jsx) — the Export/Import UI buttons
