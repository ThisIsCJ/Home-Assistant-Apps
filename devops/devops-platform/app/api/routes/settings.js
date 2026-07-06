import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDb, isConnected } from '../db.js';

const router = Router();

router.get('/me', requireAuth, async (req, res) => {
  if (!isConnected()) return res.json({});
  const doc = await getDb().collection('settings').findOne({ _id: req.user.id });
  res.json({
    theme:    doc?.theme    || 'dark',
    skin:     doc?.skin     || 'default',
    fontSize: doc?.fontSize || 'md',
  });
});

router.put('/me', requireAuth, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const { theme, skin, fontSize } = req.body;
  const update = {};
  if (theme    !== undefined) update.theme    = theme;
  if (skin     !== undefined) update.skin     = skin;
  if (fontSize !== undefined) update.fontSize = fontSize;

  await getDb().collection('settings').updateOne(
    { _id: req.user.id },
    { $set: update },
    { upsert: true }
  );
  res.json({ ok: true });
});

router.get('/tour', requireAuth, async (req, res) => {
  if (!isConnected()) return res.json({ seen: false });
  const user = await getDb().collection('users').findOne(
    { _id: req.user.id },
    { projection: { tour_seen: 1 } }
  );
  res.json({ seen: Boolean(user?.tour_seen) });
});

router.post('/tour', requireAuth, async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  await getDb().collection('users').updateOne(
    { _id: req.user.id },
    { $set: { tour_seen: true } },
    { upsert: true }
  );
  res.json({ ok: true });
});

export default router;
