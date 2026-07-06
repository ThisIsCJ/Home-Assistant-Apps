import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';

const UPLOAD_DIR = '/data/uploads';

// Ensure upload dir exists at startup
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Allowlisted raster image types → server-chosen extension. SVG is intentionally
// excluded (it can carry <script> and would execute inline). The extension is
// derived from this map, never from the client-supplied filename, so a request
// cannot smuggle an executable extension (e.g. .html) past the type filter.
const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || '.bin';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPEG, GIF, WebP or ICO images are allowed'), ok);
  },
});

const router = Router();

// Coarse abuse guard: cap the number of stored files so an authenticated user
// cannot fill /data by uploading unboundedly.
const MAX_FILES = 1000;
function storageGuard(req, res, next) {
  try {
    if (fs.readdirSync(UPLOAD_DIR).length >= MAX_FILES) {
      return res.status(507).json({ message: 'Upload storage is full. Remove unused images first.' });
    }
  } catch { /* directory unreadable — let the upload attempt proceed */ }
  next();
}

// POST /api/uploads — authenticated upload
router.post('/', requireAuth, storageGuard, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file provided' });
  // Relative URL (no leading slash) so images resolve under the HA ingress
  // sub-path as well as at a plain root deployment.
  res.json({ url: `api/uploads/${req.file.filename}` });
});

// GET /api/uploads/:filename — public serve (no auth, so images work in <img> tags)
router.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filepath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ message: 'Not found' });
  // Defence in depth: never let the browser sniff a stored file into an
  // executable type, and forbid scripts even if it somehow renders as a document.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.sendFile(filepath);
});

export default router;
