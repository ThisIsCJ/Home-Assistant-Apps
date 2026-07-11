import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ObjectId } from 'mongodb';
import AdmZip from 'adm-zip';
import { getDb } from '../db.js';

// Serialize the whole cookbook — every recipe plus the image files they
// reference — into one portable zip archive, and load such an archive back.
//
// Images are stored on the add-on's /data volume (see routes/uploads.js) and
// served at "api/uploads/<file>". The export writes each image as its own file
// inside the zip and keeps the recipe metadata in a single `cookbook.json`
// manifest, so the archive is self-contained (one file, no external assets)
// while staying compact — raw image bytes, not base64. Import re-stores every
// image under a fresh filename so it can never collide with or overwrite files
// already on disk.

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const COLLECTION = 'cookbookRecipes';
const FORMAT = 'atlas-cookbook-export';
const VERSION = 2;            // 2 = zip archive; 1 = legacy base64-inlined JSON
const MANIFEST_NAME = 'cookbook.json';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

// --- Export ----------------------------------------------------------------

// Returns the archive as a zip Buffer, ready to stream as a download.
export async function buildExport() {
  const recipes = await getDb().collection(COLLECTION).find({}).toArray();

  // Collect every uploaded-image file referenced by any recipe (deduplicated).
  const filenames = new Set();
  for (const recipe of recipes) {
    addFilename(filenames, recipe?.imageUrl);
    for (const step of Array.isArray(recipe?.steps) ? recipe.steps : []) {
      addFilename(filenames, step?.imageUrl);
    }
  }

  const zip = new AdmZip();
  const images = [];
  for (const filename of filenames) {
    try {
      const data = await fs.promises.readFile(path.join(UPLOAD_DIR, filename));
      const file = `images/${filename}`;
      zip.addFile(file, data);
      images.push({ filename, contentType: contentTypeFor(filename), file });
    } catch {
      // File referenced by a recipe but missing on disk — skip it. External
      // (https://…) references never resolve to a filename and are left as-is.
    }
  }

  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    recipeCount: recipes.length,
    imageCount: images.length,
    recipes,
    images,
  };
  zip.addFile(MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  return zip.toBuffer();
}

// --- Import ----------------------------------------------------------------

// `input` is the raw uploaded bytes. It may be a v2 zip archive or a legacy v1
// JSON archive (base64-inlined image bytes) — both are accepted.
export async function importArchive(input, user) {
  const { manifest, imageBytes } = readArchive(input);

  if (!manifest || manifest.format !== FORMAT) {
    throw badRequest('This file is not a cookbook export archive.');
  }
  if (Number(manifest.version) > VERSION) {
    throw badRequest('This archive was created by a newer version of the cookbook and cannot be imported.');
  }

  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const recipes = Array.isArray(manifest.recipes) ? manifest.recipes : [];

  // 1. Re-store every image under a fresh filename, mapping old → new so
  //    recipe references can be rewritten. This guarantees an import can never
  //    overwrite an image already on disk.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const nameMap = new Map();
  let imageCount = 0;

  for (const image of images) {
    const oldName = path.basename(`${image?.filename || ''}`);
    const bytes = imageBytes(image);
    if (!oldName || !bytes) continue;

    const newName = `${randomUUID()}${extFor(oldName)}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, newName), bytes);
    nameMap.set(oldName, `api/uploads/${newName}`);
    imageCount += 1;
  }

  // 2. Rewrite and insert each recipe.
  const collection = getDb().collection(COLLECTION);
  let recipeCount = 0;

  for (const raw of recipes) {
    const recipe = reviveRecipe(raw, nameMap, user);

    // Preserve the original _id when it's still free (so a restore into an
    // empty instance reproduces exact ids); otherwise insert as a fresh copy.
    if (recipe._id) {
      const clash = await collection.findOne({ _id: recipe._id }, { projection: { _id: 1 } });
      if (clash) delete recipe._id;
    }

    await collection.insertOne(recipe);
    recipeCount += 1;
  }

  return { recipes: recipeCount, images: imageCount };
}

// --- Helpers ---------------------------------------------------------------

// Sniff the uploaded bytes and return the parsed manifest plus a per-image
// byte-reader. Supports both the v2 zip layout and legacy v1 JSON (where each
// image carries its bytes inline as base64).
function readArchive(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');

  // Zip archives start with the "PK" local-file-header magic.
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw badRequest('The uploaded file is not a readable zip archive.');
    }
    const entry = zip.getEntry(MANIFEST_NAME);
    if (!entry) throw badRequest(`Archive is missing ${MANIFEST_NAME}.`);

    let manifest;
    try {
      manifest = JSON.parse(zip.readAsText(entry));
    } catch {
      throw badRequest(`${MANIFEST_NAME} is not valid JSON.`);
    }

    const imageBytes = (image) => {
      const fileEntry = image?.file ? zip.getEntry(image.file) : null;
      return fileEntry ? fileEntry.getData() : null;
    };
    return { manifest, imageBytes };
  }

  // Legacy v1: a single JSON document with base64-inlined image bytes.
  let manifest;
  try {
    manifest = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw badRequest('The uploaded file is not a cookbook export (neither a zip nor JSON).');
  }
  const imageBytes = (image) => (image?.data ? Buffer.from(image.data, 'base64') : null);
  return { manifest, imageBytes };
}

// Recipe image references look like "api/uploads/<file>" (an optional leading
// slash or ingress prefix is tolerated). Returns the bare filename or null.
function uploadFilename(url) {
  const match = `${url || ''}`.match(/(?:^|\/)api\/uploads\/([^/?#]+)$/);
  return match ? path.basename(match[1]) : null;
}

function addFilename(set, url) {
  const filename = uploadFilename(url);
  if (filename) set.add(filename);
}

function remapUrl(url, nameMap) {
  const filename = uploadFilename(url);
  if (filename && nameMap.has(filename)) return nameMap.get(filename);
  return `${url || ''}`;
}

function contentTypeFor(filename) {
  return CONTENT_TYPES[extFor(filename)] || 'application/octet-stream';
}

function extFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ? ext : '.bin';
}

function reviveRecipe(raw, nameMap, user) {
  const recipe = { ...raw };

  // JSON round-trips ObjectIds to hex strings and Dates to ISO strings —
  // convert them back to the BSON types Mongo and the routes expect.
  if (typeof recipe._id === 'string' && ObjectId.isValid(recipe._id)) {
    recipe._id = new ObjectId(recipe._id);
  } else {
    delete recipe._id;
  }

  recipe.imageUrl = remapUrl(recipe.imageUrl, nameMap);
  if (Array.isArray(recipe.steps)) {
    recipe.steps = recipe.steps.map((step) => ({
      ...step,
      imageUrl: remapUrl(step?.imageUrl, nameMap),
    }));
  }

  recipe.createdAt = toDate(recipe.createdAt) || new Date();
  recipe.updatedAt = toDate(recipe.updatedAt) || new Date();
  if (recipe.archived) {
    const archivedAt = toDate(recipe.archivedAt);
    if (archivedAt) recipe.archivedAt = archivedAt;
    else delete recipe.archivedAt;
  }

  if (Array.isArray(recipe.reviews)) {
    recipe.reviews = recipe.reviews.map((review) => ({
      ...review,
      _id: typeof review?._id === 'string' && ObjectId.isValid(review._id)
        ? new ObjectId(review._id)
        : new ObjectId(),
      createdAt: toDate(review?.createdAt) || new Date(),
      updatedAt: toDate(review?.updatedAt) || new Date(),
    }));
  }

  // A recipe with no owner is attributed to the importing admin so it stays
  // editable in the target instance.
  if (!recipe.ownerId) {
    recipe.ownerId = user.id;
    recipe.ownerName = user.name || 'Unknown user';
  }

  return recipe;
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
