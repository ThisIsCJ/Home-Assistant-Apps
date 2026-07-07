import db, { siteFromRow } from '../db.js';
import { HA_INGRESS, ADMIN_USERS } from '../lib/config.js';

// Home Assistant ingress mode: the Supervisor authenticates every request
// before it reaches this container and forwards the HA user in
// X-Remote-User-* headers. Outside ingress (local dev) a fixed dev user is
// used instead — the API must never be exposed directly in that mode.
function ingressUser(req) {
  const username = String(req.headers['x-remote-user-name'] || 'ha-user');
  const display  = String(req.headers['x-remote-user-display-name'] || username);
  const isAdmin  = ADMIN_USERS.length === 0 || ADMIN_USERS.includes(username.toLowerCase());
  return { username, name: display, isAdmin };
}

function devUser() {
  const username = process.env.DEV_USER || 'dev';
  return { username, name: username, isAdmin: true };
}

export function requireAuth(req, res, next) {
  req.user = HA_INGRESS ? ingressUser(req) : devUser();
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

// Loads the site and verifies the current user may access it. Admins see all
// sites; standard users only the ones they are assigned to. Attaches
// req.site on success.
export function requireSite(req, res, next) {
  const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.siteId);
  const site = siteFromRow(row);
  if (!site) return res.status(404).json({ message: 'Site not found' });
  if (!req.user.isAdmin && !site.users.includes(req.user.username)) {
    return res.status(403).json({ message: 'No access to this site' });
  }
  req.site = site;
  next();
}

// Per-site permission gate for standard users ("sync/push if permitted").
export function requireSitePermission(flag) {
  return (req, res, next) => {
    if (!req.user.isAdmin && !req.site[flag]) {
      return res.status(403).json({ message: 'Not permitted on this site' });
    }
    next();
  };
}
