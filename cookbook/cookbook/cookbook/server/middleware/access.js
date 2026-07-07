import { getDb, isConnected } from '../db.js';

const CONFIG_COLLECTION = 'cookbookConfig';
const USERS_COLLECTION = 'cookbookUsers';
const ACCESS_DOC_ID = 'access';
const ACCESS_CACHE_TTL_MS = 10_000;
const USER_RECORD_TTL_MS = 5 * 60_000;

export const DEFAULT_ACCESS = { mode: 'everyone', allowedUserIds: [] };

let accessCache = null;
let accessCacheAt = 0;
const recentlyRecordedUsers = new Map();

export async function getAccessConfig() {
  if (!isConnected()) return DEFAULT_ACCESS;

  const now = Date.now();
  if (accessCache && now - accessCacheAt < ACCESS_CACHE_TTL_MS) return accessCache;

  const doc = await getDb().collection(CONFIG_COLLECTION).findOne({ _id: ACCESS_DOC_ID });
  accessCache = normalizeAccessConfig(doc);
  accessCacheAt = now;
  return accessCache;
}

export async function setAccessConfig(input) {
  const config = normalizeAccessConfig(input);
  await getDb().collection(CONFIG_COLLECTION).updateOne(
    { _id: ACCESS_DOC_ID },
    { $set: { mode: config.mode, allowedUserIds: config.allowedUserIds, updatedAt: new Date() } },
    { upsert: true }
  );
  accessCache = config;
  accessCacheAt = Date.now();
  return config;
}

function normalizeAccessConfig(doc) {
  const mode = doc?.mode === 'selected' ? 'selected' : 'everyone';
  const allowedUserIds = Array.isArray(doc?.allowedUserIds)
    ? [...new Set(doc.allowedUserIds.map((id) => `${id || ''}`.trim()).filter(Boolean))]
    : [];
  return { mode, allowedUserIds };
}

export async function listKnownUsers() {
  return getDb().collection(USERS_COLLECTION)
    .find({})
    .sort({ name: 1 })
    .toArray();
}

// Keeps a directory of everyone who has visited through ingress so the admin
// panel can offer them in the access list. Throttled per user to avoid a DB
// write on every request.
export function recordUser(req, _res, next) {
  const { id, name } = req.user || {};
  if (!id || !isConnected()) return next();

  const now = Date.now();
  const lastRecorded = recentlyRecordedUsers.get(id) || 0;
  if (now - lastRecorded < USER_RECORD_TTL_MS) return next();
  recentlyRecordedUsers.set(id, now);

  getDb().collection(USERS_COLLECTION).updateOne(
    { _id: id },
    {
      $set: { name: name || 'Home Assistant User', lastSeenAt: new Date() },
      $setOnInsert: { firstSeenAt: new Date() },
    },
    { upsert: true }
  ).catch(() => {
    recentlyRecordedUsers.delete(id);
  });

  next();
}

// Gate on the admin-managed access list. Admins always pass; in 'everyone'
// mode all ingress users pass; in 'selected' mode the user id must be listed.
export async function requireAccess(req, res, next) {
  if (req.user?.isAdmin) return next();

  try {
    const config = await getAccessConfig();
    if (config.mode !== 'selected') return next();
    if (config.allowedUserIds.includes(req.user?.id)) return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  res.status(403).json({ error: 'You do not have access to the cookbook. Ask an admin to grant you access.' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  res.status(403).json({ error: 'Admins only' });
}
