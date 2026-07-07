import fs from 'node:fs';
import path from 'node:path';
import db, { now } from '../db.js';
import { REPO_PATH, DRAFT_PATH } from './config.js';
import { safeJoin, userSlug } from './paths.js';

export const repoDir  = (site) => path.join(REPO_PATH, site.id);
export const draftDir = (site, username) => path.join(DRAFT_PATH, site.id, userSlug(username));

const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);
const TEXT_EXT = new Set([
  '.html', '.htm', '.md', '.markdown', '.css', '.js', '.mjs', '.json', '.txt',
  '.xml', '.yml', '.yaml', '.toml', '.svg', '.csv',
]);

export const isHtml = (rel) => /\.html?$/i.test(rel);
export const isText = (rel) => TEXT_EXT.has(path.extname(rel).toLowerCase());

// A user's working copy of a file: their draft version wins over the repo.
export function resolveFile(site, username, rel) {
  const fromDraft = safeJoin(draftDir(site, username), rel);
  if (fromDraft && fs.existsSync(fromDraft) && fs.statSync(fromDraft).isFile()) {
    return { abs: fromDraft, draft: true };
  }
  const fromRepo = safeJoin(repoDir(site), rel);
  if (fromRepo && fs.existsSync(fromRepo) && fs.statSync(fromRepo).isFile()) {
    return { abs: fromRepo, draft: false };
  }
  return null;
}

function walk(root, base = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, base), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.well-known') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(root, rel));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

// Merged file listing: everything in the repo plus draft-only additions,
// each flagged with whether the user has a drafted version.
export function listFiles(site, username) {
  const repoFiles = walk(repoDir(site));
  const draftFiles = new Set(walk(draftDir(site, username)));
  const all = new Set([...repoFiles, ...draftFiles]);
  return [...all].sort().map((rel) => ({
    path: rel,
    html: isHtml(rel),
    text: isText(rel),
    draft: draftFiles.has(rel),
  }));
}

// ── Draft persistence ────────────────────────────────────────────────────────

export function getDraft(site, username) {
  const row = db.prepare('SELECT * FROM drafts WHERE site_id = ? AND user = ?').get(site.id, username);
  if (!row) return null;
  return { ...row, files: JSON.parse(row.files || '[]') };
}

export function saveDraftFile(site, username, rel, content, baseCommit) {
  const abs = safeJoin(draftDir(site, username), rel);
  if (!abs) throw new Error('Invalid path');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);

  const existing = getDraft(site, username);
  const files = new Set(existing?.files || []);
  files.add(rel);
  db.prepare(`
    INSERT INTO drafts (site_id, user, files, base_commit, saved_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(site_id, user) DO UPDATE SET files = excluded.files, saved_at = excluded.saved_at
  `).run(site.id, username, JSON.stringify([...files]), existing?.base_commit ?? baseCommit ?? null, now());
}

export function discardDraft(site, username) {
  fs.rmSync(draftDir(site, username), { recursive: true, force: true });
  db.prepare('DELETE FROM drafts WHERE site_id = ? AND user = ?').run(site.id, username);
}

// Copy the user's drafted files into the repository working tree (the step
// before commit+push). Returns the list of repo-relative paths written.
export function applyDraftToRepo(site, username) {
  const draft = getDraft(site, username);
  if (!draft || draft.files.length === 0) throw new Error('No draft to push');
  const written = [];
  for (const rel of draft.files) {
    const src = safeJoin(draftDir(site, username), rel);
    const dest = safeJoin(repoDir(site), rel);
    if (!src || !dest || !fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    written.push(rel);
  }
  if (written.length === 0) throw new Error('Draft files are missing on disk');
  return written;
}
