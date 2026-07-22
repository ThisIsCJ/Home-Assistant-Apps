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
// A file the user has deleted in their draft resolves to nothing, even if it
// still exists in the repo (the deletion is applied to the repo on push).
export function resolveFile(site, username, rel) {
  const draft = getDraft(site, username);
  if (draft?.deletions?.includes(rel)) return null;
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

// Directories under a root (relative paths), deepest last. Used to surface
// folders the user created in their draft that don't yet contain a file — git
// can't track an empty folder, so it exists only in the draft until populated.
function walkDirs(root, base = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, base), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    out.push(rel);
    out.push(...walkDirs(root, rel));
  }
  return out;
}

// Merged file listing: everything in the repo plus draft-only additions (minus
// anything the user has deleted), each flagged with whether the user has a
// drafted version. Empty draft-only folders are included as `dir` entries so
// freshly created folders are visible before they hold a file.
export function listFiles(site, username) {
  const draft = getDraft(site, username);
  const deleted = new Set(draft?.deletions || []);
  const repoFiles = walk(repoDir(site));
  const draftFiles = new Set(walk(draftDir(site, username)));
  const all = [...new Set([...repoFiles, ...draftFiles])]
    .filter((rel) => !deleted.has(rel))
    .sort();

  const fileEntries = all.map((rel) => ({
    path: rel,
    html: isHtml(rel),
    text: isText(rel),
    draft: draftFiles.has(rel),
  }));

  // A folder is "empty" (needs its own row) when no listed file lives under it.
  const dirEntries = walkDirs(draftDir(site, username))
    .filter((dir) => !deleted.has(dir) && !all.some((f) => f.startsWith(dir + '/')))
    .map((dir) => ({ path: dir, dir: true, html: false, text: false, draft: true }));

  return [...dirEntries, ...fileEntries].sort((a, b) => a.path.localeCompare(b.path));
}

// ── Draft persistence ────────────────────────────────────────────────────────

export function getDraft(site, username) {
  const row = db.prepare('SELECT * FROM drafts WHERE site_id = ? AND user = ?').get(site.id, username);
  if (!row) return null;
  return { ...row, files: JSON.parse(row.files || '[]'), deletions: JSON.parse(row.deletions || '[]') };
}

// Write the draft manifest (the list of drafted files and repo files the user
// has deleted). A manifest with neither is dropped entirely so an empty draft
// leaves no lingering row. The base commit is set once and never overwritten.
function persistManifest(site, username, { files, deletions, baseCommit }) {
  if (files.length === 0 && deletions.length === 0) {
    db.prepare('DELETE FROM drafts WHERE site_id = ? AND user = ?').run(site.id, username);
    return;
  }
  const existing = getDraft(site, username);
  db.prepare(`
    INSERT INTO drafts (site_id, user, files, deletions, base_commit, saved_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id, user) DO UPDATE SET files = excluded.files, deletions = excluded.deletions, saved_at = excluded.saved_at
  `).run(site.id, username, JSON.stringify(files), JSON.stringify(deletions),
         existing?.base_commit ?? baseCommit ?? null, now());
}

export function saveDraftFile(site, username, rel, content, baseCommit) {
  const abs = safeJoin(draftDir(site, username), rel);
  if (!abs) throw new Error('Invalid path');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);

  const existing = getDraft(site, username);
  const files = new Set(existing?.files || []);
  files.add(rel);
  const deletions = new Set(existing?.deletions || []);
  deletions.delete(rel); // re-saving a path un-deletes it
  persistManifest(site, username, { files: [...files], deletions: [...deletions], baseCommit });
}

// Every file path known for a site — repo + draft — used to expand a folder
// operation into the individual files it affects.
function allPaths(site, username) {
  return new Set([...walk(repoDir(site)), ...walk(draftDir(site, username))]);
}
const repoPaths = (site) => new Set(walk(repoDir(site)));

// Create an empty text file in the draft. Fails if something already lives at
// the path (in the repo or the draft).
export function createDraftFile(site, username, rel, content, baseCommit) {
  if (!safeJoin(draftDir(site, username), rel)) throw new Error('Invalid path');
  if (resolveFile(site, username, rel)) throw new Error('A file already exists at that path');
  saveDraftFile(site, username, rel, content ?? '', baseCommit);
}

// Create a folder in the draft. Empty folders live only in the draft — git
// cannot commit them until they contain a file — so no manifest entry is made.
export function createDraftFolder(site, username, rel) {
  const abs = safeJoin(draftDir(site, username), rel);
  if (!abs) throw new Error('Invalid folder path');
  if (fs.existsSync(abs)) throw new Error('That folder already exists');
  const repoAbs = safeJoin(repoDir(site), rel);
  if (repoAbs && fs.existsSync(repoAbs)) throw new Error('That folder already exists');
  fs.mkdirSync(abs, { recursive: true });
}

// Delete a file or folder. Repo files are recorded as deletions (a tombstone
// applied to the repo on push); draft-only files are simply dropped. A folder
// expands to every file beneath it.
export function deleteEntry(site, username, rel, baseCommit) {
  const root = draftDir(site, username);
  const dAbs = safeJoin(root, rel);
  if (!dAbs) throw new Error('Invalid path');

  const everything = allPaths(site, username);
  const repo = repoPaths(site);
  const prefix = rel + '/';
  const targets = everything.has(rel)
    ? [rel]
    : [...everything].filter((p) => p === rel || p.startsWith(prefix));

  const existing = getDraft(site, username);
  const files = new Set(existing?.files || []);
  const deletions = new Set(existing?.deletions || []);

  for (const t of targets) {
    const tAbs = safeJoin(root, t);
    if (tAbs && fs.existsSync(tAbs)) fs.rmSync(tAbs, { force: true });
    files.delete(t);
    if (repo.has(t)) deletions.add(t); else deletions.delete(t);
  }
  // Clean up an empty draft folder (and any draft-only descendants).
  if (fs.existsSync(dAbs) && fs.statSync(dAbs).isDirectory()) {
    fs.rmSync(dAbs, { recursive: true, force: true });
  }
  if (targets.length === 0 && !fs.existsSync(dAbs)) throw new Error('Nothing to delete');
  persistManifest(site, username, { files: [...files], deletions: [...deletions], baseCommit });
}

// Rename or move a file or folder to a new path within the draft. The source
// content is copied to the destination (as a draft) and the source is deleted
// (tombstoned if it came from the repo). Folders move every file beneath them.
export function moveEntry(site, username, from, to, baseCommit) {
  from = String(from || '').replace(/\/+$/, '');
  to = String(to || '').replace(/\/+$/, '');
  if (!from || !to) throw new Error('Both a source and destination are required');
  if (from === to) throw new Error('Source and destination are the same');
  const root = draftDir(site, username);
  const fromAbs = safeJoin(root, from);
  const toAbs = safeJoin(root, to);
  if (!fromAbs || !toAbs) throw new Error('Invalid path');
  if (to === from || to.startsWith(from + '/')) throw new Error('Cannot move a folder into itself');

  const everything = allPaths(site, username);
  const repo = repoPaths(site);
  const isFile = everything.has(from);
  const pairs = isFile
    ? [[from, to]]
    : [...everything]
        .filter((p) => p.startsWith(from + '/'))
        .map((p) => [p, `${to}/${p.slice(from.length + 1)}`]);

  const existing = getDraft(site, username);
  const files = new Set(existing?.files || []);
  const deletions = new Set(existing?.deletions || []);

  for (const [src, dest] of pairs) {
    if (resolveFile(site, username, dest)) throw new Error(`Destination already exists: ${dest}`);
  }
  for (const [src, dest] of pairs) {
    const hit = resolveFile(site, username, src);
    if (!hit) continue;
    const buf = fs.readFileSync(hit.abs);            // Buffer — works for text and binary
    const destAbs = safeJoin(root, dest);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, buf);
    const srcDraft = safeJoin(root, src);
    if (srcDraft && fs.existsSync(srcDraft)) fs.rmSync(srcDraft, { force: true });
    files.add(dest); deletions.delete(dest);
    files.delete(src); if (repo.has(src)) deletions.add(src);
  }
  // Move an empty draft folder wholesale; otherwise drop the emptied source dir.
  if (fs.existsSync(fromAbs) && fs.statSync(fromAbs).isDirectory()) {
    if (pairs.length === 0 && !fs.existsSync(toAbs)) {
      fs.mkdirSync(path.dirname(toAbs), { recursive: true });
      fs.renameSync(fromAbs, toAbs);
    } else {
      fs.rmSync(fromAbs, { recursive: true, force: true });
    }
  } else if (pairs.length === 0) {
    throw new Error('Nothing to move');
  }
  persistManifest(site, username, { files: [...files], deletions: [...deletions], baseCommit });
  return { moved: pairs.length };
}

export function discardDraft(site, username) {
  fs.rmSync(draftDir(site, username), { recursive: true, force: true });
  db.prepare('DELETE FROM drafts WHERE site_id = ? AND user = ?').run(site.id, username);
}

// Copy the user's drafted files into the repository working tree (the step
// before commit+push). Returns the list of repo-relative paths written.
export function applyDraftToRepo(site, username) {
  const draft = getDraft(site, username);
  if (!draft || (draft.files.length === 0 && draft.deletions.length === 0)) {
    throw new Error('No draft to push');
  }
  const written = [];
  for (const rel of draft.files) {
    const src = safeJoin(draftDir(site, username), rel);
    const dest = safeJoin(repoDir(site), rel);
    if (!src || !dest || !fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    written.push(rel);
  }
  // Apply deletions to the repo working tree. `git add -- <path>` then stages
  // the removal, so the caller treats these paths exactly like written ones.
  const removed = [];
  for (const rel of draft.deletions) {
    const dest = safeJoin(repoDir(site), rel);
    if (dest && fs.existsSync(dest)) { fs.rmSync(dest, { force: true }); removed.push(rel); }
  }
  if (written.length === 0 && removed.length === 0) throw new Error('Draft files are missing on disk');
  return [...written, ...removed];
}
