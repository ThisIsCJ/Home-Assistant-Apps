import { Router } from 'express';
import fs from 'node:fs';
import { requireSite } from '../middleware/auth.js';
import { resolveFile, isHtml } from '../lib/overlay.js';
import { editorHtml, previewHtml } from '../lib/html.js';
import { runBuild, builtOutputDir } from '../lib/build.js';
import { safeJoin } from '../lib/paths.js';

const router = Router({ mergeParams: true });

// Normalize a wildcard request path to a site-relative file path.
function normalize(rest) {
  let rel = String(rest || '').replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  return rel;
}

// Directory-style URLs ("about" → "about/index.html").
function withIndexFallback(resolveFn, rel) {
  let hit = resolveFn(rel);
  if (!hit && !/\.[a-z0-9]+$/i.test(rel)) hit = resolveFn(`${rel}/index.html`);
  return hit ? { ...hit, rel: hit.rel || rel } : null;
}

function sendResolved(res, hit, rel, transform) {
  if (isHtml(rel)) {
    const html = fs.readFileSync(hit.abs, 'utf8');
    res.type('html').send(transform(html, rel));
  } else {
    res.sendFile(hit.abs);
  }
}

// ── Editor serving: overlay (draft-over-repo) + injected editor runtime ──────
router.get('/edit/*', requireSite, (req, res) => {
  const rel = normalize(req.params[0]);
  const hit = withIndexFallback(
    (r) => {
      const f = resolveFile(req.site, req.user.username, r);
      return f ? { ...f, rel: r } : null;
    },
    rel,
  );
  if (!hit) return res.status(404).send('Not found');
  sendResolved(res, hit, hit.rel, editorHtml);
});

// ── Preview ──────────────────────────────────────────────────────────────────
// Sites with a build command are previewed from their built output; plain
// static sites straight from the draft-over-repo overlay.
router.post('/preview', requireSite, async (req, res) => {
  if (!req.site.build_cmd) return res.json({ ok: true, mode: 'static' });
  if (req.site.status !== 'ready') {
    return res.status(409).json({ message: `Site is not ready (status: ${req.site.status})` });
  }
  const { ok, log } = await runBuild(req.site, req.user.username);
  if (!ok) return res.status(422).json({ message: 'Build failed', log });
  res.json({ ok: true, mode: 'built', log });
});

router.get('/preview/*', requireSite, (req, res) => {
  const rel = normalize(req.params[0]);
  let hit;
  if (req.site.build_cmd) {
    const root = builtOutputDir(req.site, req.user.username);
    hit = withIndexFallback((r) => {
      const abs = safeJoin(root, r);
      return abs && fs.existsSync(abs) && fs.statSync(abs).isFile() ? { abs, rel: r } : null;
    }, rel);
    if (!hit) {
      return res.status(404).send('Not built yet — run Preview to build the site.');
    }
  } else {
    hit = withIndexFallback((r) => {
      const f = resolveFile(req.site, req.user.username, r);
      return f ? { ...f, rel: r } : null;
    }, rel);
    if (!hit) return res.status(404).send('Not found');
  }
  sendResolved(res, hit, hit.rel, previewHtml);
});

export default router;
