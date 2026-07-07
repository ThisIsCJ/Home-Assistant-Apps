import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { listKeys, importKey, generateKey, deleteKey } from '../lib/keys.js';

const router = Router();

// Key material is write-only: these endpoints only ever return the name,
// fingerprint and public key.
router.get('/', requireAdmin, (req, res) => {
  res.json(listKeys());
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, private_key } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ message: 'Key name is required' });
  if (!private_key?.trim()) return res.status(400).json({ message: 'Private key is required' });
  try {
    res.status(201).json(await importKey(name.trim(), private_key));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/generate', requireAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ message: 'Key name is required' });
  try {
    res.status(201).json(await generateKey(name.trim()));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  try {
    deleteKey(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ message: err.message });
  }
});

export default router;
