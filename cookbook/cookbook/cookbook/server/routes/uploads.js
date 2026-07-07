import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { ingressUser } from '../middleware/ingressAuth.js';
import { requireAccess } from '../middleware/access.js';

// Uploaded images are persisted to the add-on's /data volume so they survive
// restarts. They are served back publicly (the URL is unguessable) so <img>
// tags work without forwarding auth headers.
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '.bin';
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!`${file.mimetype || ''}`.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

const router = Router();

router.post('/', ingressUser, requireAccess, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    res.status(201).json({ url: `api/uploads/${req.file.filename}` });
  });
});

router.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!filePath.startsWith(path.resolve(UPLOAD_DIR))) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
});

export default router;
