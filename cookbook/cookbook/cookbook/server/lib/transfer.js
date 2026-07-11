import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';

// Serialize the whole cookbook — every recipe plus the image files they
// reference — into one portable JSON archive, and load such an archive back.
//
// Images are stored on the add-on's /data volume (see routes/uploads.js) and
// served at "api/uploads/<file>". The export bundles those bytes inline
// (base64) so the archive is fully self-contained: one file, no external
// assets. Import re-stores every image under a fresh filename so it can never
// collide with or overwrite files already on disk.

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const COLLECTION = 'cookbookRecipes';
const FORMAT = 'atlas-cookbook-export';
const VERSION = 1;

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

  const images = [];
  for (const filename of filenames) {
    try {
      const data = await fs.promises.readFile(path.join(UPLOAD_DIR, filename));
      images.push({
        filename,
        contentType: contentTypeFor(filename),
        data: data.toString('base64'),
      });
    } catch {
      // File referenced by a recipe but missing on disk — skip it. External
      // (https://…) references never resolve to a filename and are left as-is.
    }
  }

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    recipeCount: recipes.length,
    imageCount: images.length,
    recipes,
    images,
  };
}

// --- Import ----------------------------------------------------------------

export async function importArchive(payload, user) {
  if (!payload || payload.format !== FORMAT) {
    throw badRequest('This file is not a cookbook export archive.');
  }
  if (Number(payload.version) > VERSION) {
    throw badRequest('This archive was created by a newer version of the cookbook and cannot be imported.');
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  const recipes = Array.isArray(payload.recipes) ? payload.recipes : [];

  // 1. Re-store every image under a fresh filename, mapping old → new so
  //    recipe references can be rewritten. This guarantees an import can never
  //    overwrite an image already on disk.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const nameMap = new Map();
  let imageCount = 0;

  for (const image of images) {
    const oldName = path.basename(`${image?.filename || ''}`);
    if (!oldName || !image?.data) continue;

    const newName = `${randomUUID()}${extFor(oldName)}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, newName), Buffer.from(image.data, 'base64'));
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
