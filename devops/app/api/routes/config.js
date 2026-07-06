import { Router } from 'express';
import { getDb, isConnected } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

const HA_INGRESS = process.env.AUTH_MODE === 'ha_ingress';

let publicConfigCache = null;
let publicConfigCacheTs = 0;
const CONFIG_CACHE_TTL = 15_000;

export function invalidatePublicConfigCache() {
  publicConfigCache = null;
  publicConfigCacheTs = 0;
}

async function buildPublicConfig() {
  const db = getDb();

  const [site, providers, onboarding] = db
    ? await Promise.all([
        db.collection('site').findOne({ _id: 'global' }),
        db.collection('auth_providers').find({ active: true }).toArray(),
        db.collection('onboarding').findOne({ _id: 'status' }),
      ])
    : [null, [], null];

  return {
    appName: site?.siteName || process.env.VITE_APP_NAME || 'DevOps Platform',
    logoUrl: site?.logoUrl || null,
    faviconUrl: site?.faviconUrl || null,
    accentColor: site?.accentColor || null,
    // In HA ingress mode the admin group is fixed by the add-on config so a
    // DB-side override can never lock the HA user out of the admin portal.
    adminGroup: HA_INGRESS
      ? (process.env.ADMIN_GROUP || '')
      : (site?.adminGroup || process.env.ADMIN_GROUP || ''),
    userGroup: site?.userGroup || process.env.VITE_USER_GROUP || '',
    adminUsers: site?.adminUsers || [],
    navOrder: site?.navOrder || null,
    authProviders: HA_INGRESS ? [] : providers.map(p => ({
      provider: p._id,
      name: p.name,
      authority: p.authority,
      clientId: p.client_id,
    })),
    // HA authenticates users and the bundled DB is preconfigured, so the
    // OIDC/database setup wizard is skipped entirely.
    onboardingComplete: HA_INGRESS ? true : (onboarding?.complete || false),
    haIngress: HA_INGRESS,
    dbConnected: isConnected(),
  };
}

// Public config — no auth required
router.get('/public', async (req, res, next) => {
  if (publicConfigCache && Date.now() - publicConfigCacheTs < CONFIG_CACHE_TTL) {
    return res.json(publicConfigCache);
  }
  try {
    const config = await buildPublicConfig();
    publicConfigCache = config;
    publicConfigCacheTs = Date.now();
    res.json(config);
  } catch (err) {
    console.error('[config] Error building public config:', err.message);
    res.json({
      appName: process.env.VITE_APP_NAME || 'DevOps Platform',
      logoUrl: null,
      faviconUrl: null,
      accentColor: null,
      adminGroup: process.env.ADMIN_GROUP || '',
      userGroup: process.env.VITE_USER_GROUP || '',
      adminUsers: [],
      authProviders: [],
      onboardingComplete: HA_INGRESS,
      haIngress: HA_INGRESS,
      dbConnected: false,
    });
  }
});

// Current user — used by the frontend in HA ingress mode, where there is no
// OIDC token to derive a profile from.
router.get('/whoami', requireAuth, (req, res) => {
  res.json(req.user);
});

// Bypass auth when no active providers exist (can't authenticate without a provider)
// or when onboarding is not yet complete.
async function requireSetupOrAdmin(req, res, next) {
  try {
    const db = getDb();
    if (!db) return next();
    const activeCount = await db.collection('auth_providers').countDocuments({ active: true });
    if (activeCount === 0) return next();
    const onboarding = await db.collection('onboarding').findOne({ _id: 'status' });
    if (!onboarding?.complete) return next();
    requireAuth(req, res, () => requireAdmin(req, res, next));
  } catch (err) {
    next(err);
  }
}

// Onboarding status — public read
router.get('/onboarding', async (req, res) => {
  const db = getDb();
  const defaultStatus = {
    complete: false,
    steps: {
      database: { complete: false },
      authentication: { complete: false },
      branding: { complete: false },
    },
  };
  if (!db) return res.json(defaultStatus);
  const status = await db.collection('onboarding').findOne({ _id: 'status' });
  res.json(status || defaultStatus);
});

// Update onboarding step
router.post('/onboarding/:step', requireSetupOrAdmin, async (req, res) => {
  const { step } = req.params;
  const validSteps = ['database', 'authentication', 'branding'];
  if (!validSteps.includes(step)) {
    return res.status(400).json({ message: 'Invalid step' });
  }
  const db = getDb();
  if (!db) return res.status(503).json({ message: 'Database not connected' });

  const { complete } = req.body;
  await db.collection('onboarding').updateOne(
    { _id: 'status' },
    { $set: { [`steps.${step}.complete`]: Boolean(complete) } },
    { upsert: true }
  );
  const status = await db.collection('onboarding').findOne({ _id: 'status' });
  const allComplete = validSteps.every(s => status?.steps?.[s]?.complete);
  await db.collection('onboarding').updateOne({ _id: 'status' }, { $set: { complete: allComplete } });

  invalidatePublicConfigCache();
  res.json({ ok: true, complete: allComplete });
});

// List auth providers (secrets masked)
router.get('/auth-providers', requireSetupOrAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ providers: [] });
  const providers = await db.collection('auth_providers').find().toArray();
  res.json({
    providers: providers.map(p => ({
      ...p,
      client_secret: p.client_secret ? '***' : null,
    })),
  });
});

// Save auth provider config
router.post('/auth-providers/:provider', requireSetupOrAdmin, async (req, res) => {
  const { provider } = req.params;
  if (!['authentik', 'microsoft', 'google'].includes(provider)) {
    return res.status(400).json({ message: 'Invalid provider' });
  }
  const db = getDb();
  if (!db) return res.status(503).json({ message: 'Database not connected' });

  const { name, authority, client_id, client_secret, active, admin_group, user_group, scope } = req.body;
  const update = {
    name: name || provider,
    authority: authority || '',
    client_id: client_id || '',
    active: Boolean(active),
    admin_group: admin_group || '',
    user_group: user_group || '',
    scope: scope || 'openid profile email',
    updated_at: new Date(),
  };
  if (client_secret && client_secret !== '***') update.client_secret = client_secret;

  await db.collection('auth_providers').updateOne(
    { _id: provider },
    { $set: update, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );

  invalidatePublicConfigCache();
  const saved = await db.collection('auth_providers').findOne({ _id: provider });
  res.json({ provider: { ...saved, client_secret: saved.client_secret ? '***' : null } });
});

// Delete auth provider
router.delete('/auth-providers/:provider', requireSetupOrAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ message: 'Database not connected' });
  await db.collection('auth_providers').deleteOne({ _id: req.params.provider });
  invalidatePublicConfigCache();
  res.json({ ok: true });
});

// Bootstrap first admin — no group config required; only works pre-setup-complete or when adminUsers is empty
router.post('/bootstrap-admin', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ message: 'Database not connected' });

  const [onboarding, site] = await Promise.all([
    db.collection('onboarding').findOne({ _id: 'status' }),
    db.collection('site').findOne({ _id: 'global' }),
  ]);

  if (onboarding?.complete && (site?.adminUsers?.length ?? 0) > 0) {
    return res.status(403).json({ message: 'Use Admin → Branding to manage access.' });
  }

  if (!req.user.email) return res.status(400).json({ message: 'No email in token — cannot bootstrap.' });

  await db.collection('site').updateOne(
    { _id: 'global' },
    { $addToSet: { adminUsers: req.user.email } },
    { upsert: true }
  );

  invalidatePublicConfigCache();
  res.json({ ok: true, email: req.user.email });
});

// Save site/branding config
router.post('/site', requireSetupOrAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ message: 'Database not connected' });

  const { siteName, logoUrl, faviconUrl, accentColor, adminGroup, userGroup, adminUsers, navOrder } = req.body;
  const update = {};
  if (siteName !== undefined) update.siteName = siteName;
  if (logoUrl !== undefined) update.logoUrl = logoUrl;
  if (faviconUrl !== undefined) update.faviconUrl = faviconUrl;
  if (accentColor !== undefined) update.accentColor = accentColor;
  if (adminGroup !== undefined) update.adminGroup = adminGroup;
  if (userGroup !== undefined) update.userGroup = userGroup;
  if (Array.isArray(adminUsers)) update.adminUsers = adminUsers;
  if (Array.isArray(navOrder)) update.navOrder = navOrder;

  await db.collection('site').updateOne(
    { _id: 'global' },
    { $set: { ...update, updated_at: new Date() } },
    { upsert: true }
  );

  invalidatePublicConfigCache();
  const saved = await db.collection('site').findOne({ _id: 'global' });
  res.json({ site: saved });
});

export default router;
