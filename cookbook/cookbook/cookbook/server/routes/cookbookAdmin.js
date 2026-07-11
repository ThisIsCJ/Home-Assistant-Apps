import { ObjectId } from 'mongodb';
import { Router } from 'express';
import multer from 'multer';
import { ingressUser } from '../middleware/ingressAuth.js';
import { getAccessConfig, setAccessConfig, listKnownUsers, recordUser, requireAdmin } from '../middleware/access.js';
import { buildExport, importArchive } from '../lib/transfer.js';
import { getDb, isConnected } from '../db.js';

const router = Router();
const requireCookbookAdmin = [ingressUser, recordUser, requireAdmin];
const COLLECTION = 'cookbookRecipes';

// Archives carry image bytes inline, so they can be large (~13 MB for ~50
// photos). Held in memory only long enough to parse — not written to disk.
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.get('/users', ...requireCookbookAdmin, async (_req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });

  try {
    const [users, access] = await Promise.all([listKnownUsers(), getAccessConfig()]);
    res.json({
      access,
      users: users.map((user) => ({
        id: user._id,
        name: user.name || 'Home Assistant User',
        firstSeenAt: user.firstSeenAt || null,
        lastSeenAt: user.lastSeenAt || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/access', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });

  const mode = req.body?.mode;
  if (mode !== 'everyone' && mode !== 'selected') {
    return res.status(400).json({ error: 'mode must be "everyone" or "selected"' });
  }

  try {
    const access = await setAccessConfig({
      mode,
      allowedUserIds: req.body?.allowedUserIds,
      allowedUserNames: req.body?.allowedUserNames,
    });
    res.json({ ok: true, access });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download the entire cookbook (recipes + referenced images) as one JSON file.
router.get('/export', ...requireCookbookAdmin, async (_req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });

  try {
    const archive = await buildExport();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cookbook-export-${date}.json"`);
    res.send(JSON.stringify(archive));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load a previously exported archive. Additive: existing recipes and images are
// never deleted or overwritten. Sent as a multipart upload (not a JSON body) to
// sidestep the Express JSON body-size limit.
router.post('/import', ...requireCookbookAdmin, (req, res) => {
  importUpload.single('file')(req, res, async (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message });
    }
    if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    let payload;
    try {
      payload = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'File is not valid JSON' });
    }

    try {
      const result = await importArchive(payload, req.user);
      res.json({ ok: true, ...result });
    } catch (importErr) {
      res.status(importErr.status || 500).json({ error: importErr.message });
    }
  });
});

router.get('/archived', ...requireCookbookAdmin, async (_req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });

  try {
    const recipes = await getDb().collection(COLLECTION)
      .find({ archived: true })
      .sort({ archivedAt: -1 })
      .project({ title: 1, description: 1, imageUrl: 1, ownerId: 1, ownerName: 1, archivedAt: 1, archivedByName: 1 })
      .toArray();

    res.json({
      recipes: recipes.map((recipe) => ({
        id: recipe._id.toString(),
        title: recipe.title || 'Untitled recipe',
        description: recipe.description || '',
        imageUrl: recipe.imageUrl || '',
        ownerId: recipe.ownerId || '',
        ownerName: recipe.ownerName || 'Unknown user',
        archivedAt: recipe.archivedAt || null,
        archivedByName: recipe.archivedByName || '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recipes/:id/restore', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const result = await getDb().collection(COLLECTION).updateOne(
      { _id: new ObjectId(req.params.id), archived: true },
      {
        $set: { updatedAt: new Date() },
        $unset: { archived: '', archivedAt: '', archivedBy: '', archivedByName: '' },
      }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Archived recipe not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Permanent removal — only possible for recipes already archived (soft-deleted).
router.delete('/recipes/:id', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const result = await getDb().collection(COLLECTION).deleteOne({
      _id: new ObjectId(req.params.id),
      archived: true,
    });

    if (result.deletedCount === 0) return res.status(404).json({ error: 'Archived recipe not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
