import { Router } from 'express';
import fs from 'node:fs';
import db, { now, siteFromRow } from '../db.js';
import { requireAdmin, requireSite } from '../middleware/auth.js';
import { validRepoUrl, clone } from '../lib/git.js';
import { slugify } from '../lib/paths.js';
import { repoDir, draftDir, getDraft } from '../lib/overlay.js';
import { DRAFT_PATH, BUILD_PATH } from '../lib/config.js';
import path from 'node:path';

const router = Router();

function withDraft(site, username) {
  const draft = getDraft(site, username);
  return {
    ...site,
    draft: draft ? { files: draft.files, saved_at: draft.saved_at } : null,
  };
}

// Kick off (or redo) the initial clone in the background; the UI polls the
// site's status field.
function startClone(site) {
  fs.rmSync(repoDir(site), { recursive: true, force: true });
  clone(site.repo_url, site.branch, repoDir(site), site.ssh_key_id)
    .then(() => {
      db.prepare("UPDATE sites SET status = 'ready', error = NULL, last_synced_at = ?, updated_at = ? WHERE id = ?")
        .run(now(), now(), site.id);
    })
    .catch((err) => {
      db.prepare("UPDATE sites SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
        .run(String(err.message).slice(0, 2000), now(), site.id);
    });
}

// Sites visible to the current user (admins see all).
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM sites ORDER BY name').all().map(siteFromRow);
  const visible = req.user.isAdmin ? rows : rows.filter((s) => s.users.includes(req.user.username));
  res.json(visible.map((s) => withDraft(s, req.user.username)));
});

router.get('/:siteId', requireSite, (req, res) => {
  res.json(withDraft(req.site, req.user.username));
});

router.post('/', requireAdmin, (req, res) => {
  const { name, repo_url, branch, ssh_key_id, build_cmd, output_dir,
          users, user_can_sync, user_can_push } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ message: 'Site name is required' });
  if (!validRepoUrl(repo_url)) return res.status(400).json({ message: 'Invalid repository URL (use git@… or https://…)' });
  const id = slugify(name);
  if (!id) return res.status(400).json({ message: 'Site name must contain letters or digits' });
  if (db.prepare('SELECT 1 FROM sites WHERE id = ?').get(id)) {
    return res.status(409).json({ message: `A site with id "${id}" already exists` });
  }
  if (ssh_key_id && !db.prepare('SELECT 1 FROM ssh_keys WHERE id = ?').get(ssh_key_id)) {
    return res.status(400).json({ message: 'Unknown SSH key' });
  }

  db.prepare(`
    INSERT INTO sites (id, name, repo_url, branch, ssh_key_id, build_cmd, output_dir,
                       users, user_can_sync, user_can_push, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cloning', ?, ?)
  `).run(
    id, name.trim(), repo_url, branch?.trim() || 'main', ssh_key_id || null,
    build_cmd?.trim() || null, output_dir?.trim() || null,
    JSON.stringify(Array.isArray(users) ? users : []),
    user_can_sync === false ? 0 : 1, user_can_push === false ? 0 : 1,
    now(), now(),
  );
  const site = siteFromRow(db.prepare('SELECT * FROM sites WHERE id = ?').get(id));
  startClone(site);
  res.status(201).json(site);
});

router.patch('/:siteId', requireAdmin, requireSite, (req, res) => {
  const cur = req.site;
  const b = req.body || {};
  if (b.repo_url !== undefined && !validRepoUrl(b.repo_url)) {
    return res.status(400).json({ message: 'Invalid repository URL' });
  }
  if (b.ssh_key_id && !db.prepare('SELECT 1 FROM ssh_keys WHERE id = ?').get(b.ssh_key_id)) {
    return res.status(400).json({ message: 'Unknown SSH key' });
  }
  const next = {
    name: b.name?.trim() || cur.name,
    repo_url: b.repo_url ?? cur.repo_url,
    branch: b.branch?.trim() || cur.branch,
    ssh_key_id: b.ssh_key_id === undefined ? cur.ssh_key_id : (b.ssh_key_id || null),
    build_cmd: b.build_cmd === undefined ? cur.build_cmd : (b.build_cmd?.trim() || null),
    output_dir: b.output_dir === undefined ? cur.output_dir : (b.output_dir?.trim() || null),
    users: Array.isArray(b.users) ? b.users : cur.users,
    user_can_sync: b.user_can_sync === undefined ? cur.user_can_sync : Boolean(b.user_can_sync),
    user_can_push: b.user_can_push === undefined ? cur.user_can_push : Boolean(b.user_can_push),
  };
  db.prepare(`
    UPDATE sites SET name = ?, repo_url = ?, branch = ?, ssh_key_id = ?, build_cmd = ?,
                     output_dir = ?, users = ?, user_can_sync = ?, user_can_push = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.name, next.repo_url, next.branch, next.ssh_key_id, next.build_cmd, next.output_dir,
    JSON.stringify(next.users), next.user_can_sync ? 1 : 0, next.user_can_push ? 1 : 0,
    now(), cur.id,
  );

  // A different remote or branch invalidates the local clone.
  const site = siteFromRow(db.prepare('SELECT * FROM sites WHERE id = ?').get(cur.id));
  if (next.repo_url !== cur.repo_url || next.branch !== cur.branch) {
    db.prepare("UPDATE sites SET status = 'cloning', error = NULL WHERE id = ?").run(cur.id);
    startClone(site);
  }
  res.json(site);
});

// Re-clone after a failed clone (or to hard-reset the working copy).
router.post('/:siteId/reclone', requireAdmin, requireSite, (req, res) => {
  db.prepare("UPDATE sites SET status = 'cloning', error = NULL, updated_at = ? WHERE id = ?")
    .run(now(), req.site.id);
  startClone(req.site);
  res.json({ ok: true });
});

router.delete('/:siteId', requireAdmin, requireSite, (req, res) => {
  const id = req.site.id;
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  db.prepare('DELETE FROM drafts WHERE site_id = ?').run(id);
  db.prepare('DELETE FROM history WHERE site_id = ?').run(id);
  fs.rmSync(repoDir(req.site), { recursive: true, force: true });
  fs.rmSync(path.join(DRAFT_PATH, id), { recursive: true, force: true });
  fs.rmSync(path.join(BUILD_PATH, id), { recursive: true, force: true });
  res.json({ ok: true });
});

export default router;
