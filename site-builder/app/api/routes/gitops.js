import { Router } from 'express';
import db, { now } from '../db.js';
import { requireSite, requireSitePermission } from '../middleware/auth.js';
import { pullFF, head, changedBetween, commitAndPush } from '../lib/git.js';
import { repoDir, getDraft, applyDraftToRepo, discardDraft } from '../lib/overlay.js';

const router = Router({ mergeParams: true });

function ensureReady(req, res, next) {
  if (req.site.status !== 'ready') {
    return res.status(409).json({ message: `Site is not ready (status: ${req.site.status})` });
  }
  next();
}

// Pull the latest from GitHub (fast-forward only — the local clone never
// diverges because failed pushes are rolled back).
router.post('/sync', requireSite, ensureReady, requireSitePermission('user_can_sync'), async (req, res) => {
  try {
    const out = await pullFF(repoDir(req.site), req.site.ssh_key_id);
    db.prepare('UPDATE sites SET last_synced_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), req.site.id);
    const draft = getDraft(req.site, req.user.username);
    res.json({
      ok: true,
      detail: out.trim().split('\n').pop(),
      head: await head(repoDir(req.site)),
      draftWarning: draft ? 'You have a saved draft — it was kept and may now differ from the updated site.' : null,
    });
  } catch (err) {
    res.status(502).json({ message: `Sync failed: ${err.message}` });
  }
});

// Commit the user's draft and push it to GitHub.
router.post('/push', requireSite, ensureReady, requireSitePermission('user_can_push'), async (req, res) => {
  const { message, force } = req.body || {};
  const commitMessage = String(message || '').trim() || 'Update site content from Home Assistant editor';
  const site = req.site;
  const cwd = repoDir(site);
  const username = req.user.username;

  const draft = getDraft(site, username);
  if (!draft || (draft.files.length === 0 && (draft.deletions?.length ?? 0) === 0)) {
    return res.status(400).json({ message: 'No draft changes to push' });
  }

  try {
    // Bring the local clone up to date first so the push applies on top of
    // the latest remote state.
    await pullFF(cwd, site.ssh_key_id);
    const currentHead = await head(cwd);

    // Conflict check: did any file in this draft also change upstream since
    // the draft was started?
    if (!force) {
      const upstreamChanged = await changedBetween(cwd, draft.base_commit, currentHead);
      const touched = [...new Set([...draft.files, ...(draft.deletions || [])])];
      const overlap = touched.filter((f) => upstreamChanged.includes(f));
      if (overlap.length > 0) {
        return res.status(409).json({
          message: 'These files also changed on GitHub since you started editing',
          conflicts: overlap,
        });
      }
    }

    const files = applyDraftToRepo(site, username);
    const hash = await commitAndPush(cwd, {
      files,
      message: commitMessage,
      authorName: req.user.name || username,
      authorEmail: `${username}@homeassistant.local`,
      branch: site.branch,
      sshKeyId: site.ssh_key_id,
    });

    db.prepare('INSERT INTO history (site_id, commit_hash, message, author, files, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(site.id, hash, commitMessage, username, JSON.stringify(files), 'pushed', now());
    db.prepare('UPDATE sites SET last_pushed_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), site.id);
    discardDraft(site, username);

    res.json({ ok: true, commit_hash: hash, files });
  } catch (err) {
    if (/nothing to commit/i.test(err.message)) {
      discardDraft(site, username);
      return res.status(400).json({ message: 'Draft is identical to the current site — nothing to push' });
    }
    db.prepare('INSERT INTO history (site_id, commit_hash, message, author, files, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(site.id, null, commitMessage, username, JSON.stringify([...draft.files, ...(draft.deletions || [])]), 'failed', now());
    res.status(502).json({ message: `Push failed: ${err.message}` });
  }
});

// Pushed-change history, newest first.
router.get('/history', requireSite, (req, res) => {
  const rows = db.prepare('SELECT * FROM history WHERE site_id = ? ORDER BY id DESC LIMIT 200').all(req.site.id);
  res.json(rows.map((r) => ({ ...r, files: JSON.parse(r.files || '[]') })));
});

export default router;
