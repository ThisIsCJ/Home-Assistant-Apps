import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import db, { now } from '../db.js';
import { requireSite } from '../middleware/auth.js';
import { listFiles, resolveFile, isText, isHtml, getDraft, saveDraftFile, discardDraft, repoDir, draftDir } from '../lib/overlay.js';
import { safeJoin } from '../lib/paths.js';
import { head } from '../lib/git.js';

const MAX_TEXT = 2 * 1024 * 1024;

const router = Router({ mergeParams: true });

router.get('/files', requireSite, (req, res) => {
  res.json(listFiles(req.site, req.user.username));
});

// Read a file (the user's draft version wins over the repo copy).
router.get('/file', requireSite, (req, res) => {
  const rel = String(req.query.path || '');
  const hit = resolveFile(req.site, req.user.username, rel);
  if (!hit) return res.status(404).json({ message: 'File not found' });
  if (!isText(rel)) return res.status(400).json({ message: 'Not a text file' });
  if (fs.statSync(hit.abs).size > MAX_TEXT) return res.status(413).json({ message: 'File too large to edit' });
  res.json({
    path: rel,
    content: fs.readFileSync(hit.abs, 'utf8'),
    draft: hit.draft,
    html: isHtml(rel),
  });
});

// Save a file into the user's draft. Never touches the repository —
// pushing is a separate, explicit action.
router.put('/file', requireSite, async (req, res) => {
  const { path: rel, content } = req.body || {};
  if (typeof rel !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ message: 'path and content are required' });
  }
  if (!isText(rel)) return res.status(400).json({ message: 'Not an editable file type' });
  try {
    const baseCommit = await head(repoDir(req.site)).catch(() => null);
    saveDraftFile(req.site, req.user.username, rel, content, baseCommit);
    res.json({ ok: true, draft: getDraft(req.site, req.user.username) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get('/draft', requireSite, (req, res) => {
  res.json(getDraft(req.site, req.user.username));
});

router.delete('/draft', requireSite, (req, res) => {
  discardDraft(req.site, req.user.username);
  res.json({ ok: true });
});

// Upload a binary asset (image replacement) into the user's draft.
// Body is the raw file; ?path= is the site-relative destination.
router.post('/asset', requireSite, express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  const rel = String(req.query.path || '');
  const abs = safeJoin(draftDir(req.site, req.user.username), rel);
  if (!abs || !rel) return res.status(400).json({ message: 'Invalid path' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'Empty upload' });
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, req.body);

  // Register the file in the draft manifest so it travels with the push
  // (saveDraftFile is for text content; binaries update the manifest here).
  const draft = getDraft(req.site, req.user.username);
  const files = new Set(draft?.files || []);
  if (!files.has(rel)) {
    const baseCommit = await head(repoDir(req.site)).catch(() => null);
    files.add(rel);
    db.prepare(`
      INSERT INTO drafts (site_id, user, files, base_commit, saved_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(site_id, user) DO UPDATE SET files = excluded.files, saved_at = excluded.saved_at
    `).run(req.site.id, req.user.username, JSON.stringify([...files]), draft?.base_commit ?? baseCommit, now());
  }
  res.json({ ok: true, path: rel });
});

export default router;
