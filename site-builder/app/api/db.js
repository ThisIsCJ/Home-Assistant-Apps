import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE } from './lib/config.js';

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    repo_url       TEXT NOT NULL,
    branch         TEXT NOT NULL DEFAULT 'main',
    ssh_key_id     TEXT,
    build_cmd      TEXT,
    output_dir     TEXT,
    users          TEXT NOT NULL DEFAULT '[]',
    user_can_sync  INTEGER NOT NULL DEFAULT 1,
    user_can_push  INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'cloning',
    error          TEXT,
    last_synced_at TEXT,
    last_pushed_at TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ssh_keys (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    fingerprint TEXT,
    public_key  TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drafts (
    site_id     TEXT NOT NULL,
    user        TEXT NOT NULL,
    files       TEXT NOT NULL DEFAULT '[]',
    base_commit TEXT,
    saved_at    TEXT NOT NULL,
    PRIMARY KEY (site_id, user)
  );

  CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id     TEXT NOT NULL,
    commit_hash TEXT,
    message     TEXT,
    author      TEXT,
    files       TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'pushed',
    created_at  TEXT NOT NULL
  );
`);

export default db;

export const now = () => new Date().toISOString();

// Row helpers — sites carry two JSON columns.
export function siteFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    users: JSON.parse(row.users || '[]'),
    user_can_sync: Boolean(row.user_can_sync),
    user_can_push: Boolean(row.user_can_push),
  };
}
