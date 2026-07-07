import path from 'node:path';

// All persistent state lives under /data (the Supervisor's persistent volume).
// The paths are configurable through the add-on options and exported as env
// vars by run.sh; the defaults below make the API runnable standalone in dev.
export const DATA_PATH  = process.env.DATA_PATH  || '/data';
export const REPO_PATH  = process.env.REPO_PATH  || path.join(DATA_PATH, 'repos');
export const DRAFT_PATH = process.env.DRAFT_PATH || path.join(DATA_PATH, 'drafts');
export const KEYS_PATH  = path.join(DATA_PATH, 'keys');
export const BUILD_PATH = path.join(DATA_PATH, 'build');
export const DB_FILE    = path.join(DATA_PATH, 'site-editor.db');

export const HA_INGRESS = process.env.AUTH_MODE === 'ha_ingress';

// HA usernames with app-admin rights. Empty = every HA user is an admin —
// the sensible default on a single-user installation.
export const ADMIN_USERS = (process.env.ADMIN_USERS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
