import fs from 'fs';

// Home Assistant writes the add-on options here at container start.
const OPTIONS_PATH = process.env.OPTIONS_PATH || '/data/options.json';

let cachedOptions = null;

function readOptions() {
  if (cachedOptions) return cachedOptions;
  try {
    if (fs.existsSync(OPTIONS_PATH)) {
      cachedOptions = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
      return cachedOptions;
    }
  } catch (err) {
    console.error(`Failed to read ${OPTIONS_PATH}:`, err.message);
  }
  cachedOptions = {};
  return cachedOptions;
}

export function getMongoUri() {
  return readOptions().mongo_uri || process.env.MONGODB_URI || '';
}

export function getMongoDb() {
  return readOptions().mongo_db || process.env.MONGODB_DB || 'cookbook';
}

// Users allowed to edit/delete any recipe or review (not just their own).
// Matched against the Home Assistant username OR display name.
export function getAdminUsers() {
  const list = readOptions().admin_users;
  return Array.isArray(list) ? list.map((v) => `${v || ''}`.trim().toLowerCase()).filter(Boolean) : [];
}

// When true every ingress user can edit every recipe (household mode).
export function everyoneIsAdmin() {
  return readOptions().everyone_is_admin === true;
}

export function getConfigSummary() {
  const uri = getMongoUri();
  return {
    source: readOptions().mongo_uri ? 'options' : process.env.MONGODB_URI ? 'env' : 'none',
    database: getMongoDb(),
    uriHint: maskUri(uri),
  };
}

function maskUri(uri) {
  if (!uri) return '';
  try {
    const u = new URL(uri);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return uri.replace(/:([^@/]+)@/, ':***@');
  }
}
