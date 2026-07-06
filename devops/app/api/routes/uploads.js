import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';

const UPLOAD_DIR = '/data/uploads';

// Ensure upload dir exists at startup
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    // Allow common image types only
    const ok = /^image\/(png|jpeg|jpg|gif|svg\+xml|webp|x-icon|vnd.microsoft.icon)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

const router = Router();

// POST /api/uploads — authenticated upload
router.post('/', requireAuth, upload.single('file'), (req, res) => {
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
  res.sendFile(filepath);
});

export default router;
