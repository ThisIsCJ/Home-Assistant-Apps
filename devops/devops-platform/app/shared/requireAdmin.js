// Admin check shared by the api, monitor and provisioning services.
// Each service passes its own getDb via createRequireAdmin({ getDb }).
export function createRequireAdmin({ getDb }) {
  let adminGroupCache = null;
  let adminGroupCacheTs = 0;
  const ADMIN_GROUP_TTL = 60_000;

  function invalidateAdminGroupCache() {
    adminGroupCache = null;
    adminGroupCacheTs = 0;
  }

  async function getAdminGroup() {
    if (process.env.ADMIN_GROUP) return process.env.ADMIN_GROUP;
    if (adminGroupCache !== null && Date.now() - adminGroupCacheTs < ADMIN_GROUP_TTL) return adminGroupCache;
    const db = getDb();
    if (!db) return null;
    const site = await db.collection('site').findOne({ _id: 'global' });
    adminGroupCache = site?.adminGroup || null;
    adminGroupCacheTs = Date.now();
    return adminGroupCache;
  }

  async function requireAdmin(req, res, next) {
    const db = getDb();
    if (db) {
      const site = await db.collection('site').findOne({ _id: 'global' }, { projection: { adminUsers: 1 } });
      if (site?.adminUsers?.includes(req.user.email)) return next();
    }
    const adminGroup = await getAdminGroup();
    if (!adminGroup || !req.user?.groups?.includes(adminGroup)) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    next();
  }

  return { requireAdmin, invalidateAdminGroupCache };
}
