import path from 'node:path';

// Resolve a user-supplied relative path inside a root directory, rejecting
// absolute paths and traversal. Returns the absolute path or null.
export function safeJoin(root, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.includes('\0')) return null;
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) return null;
  return abs;
}

// Usernames become directory names under the drafts root.
export function userSlug(username) {
  return String(username).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'user';
}

// Site names become site ids / directory names.
export function slugify(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
