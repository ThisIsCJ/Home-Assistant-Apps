import { createRemoteJWKSet, jwtVerify } from 'jose';

// Single source of truth for request authentication, consumed by the api,
// monitor and provisioning services via createAuthMiddleware({ getDb }).
// Each service passes its own getDb so the middleware works against that
// service's MongoDB connection.

// Home Assistant ingress mode: the Supervisor authenticates every request
// before it reaches this container and forwards the HA user in
// X-Remote-User-* headers. No bearer token is required in this mode.
const HA_INGRESS = process.env.AUTH_MODE === 'ha_ingress';

// Optional allow-list of HA usernames that get the admin group (comma
// separated, from the add-on's admin_users option). Empty means every HA
// user is an admin — the sensible default on a single-user installation.
const ADMIN_USERS = (process.env.ADMIN_USERS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function ingressUser(req) {
  const username = req.headers['x-remote-user-name'] || 'ha-user';
  const display  = req.headers['x-remote-user-display-name'] || username;
  const id       = req.headers['x-remote-user-id'] || username;
  const isAdmin  = ADMIN_USERS.length === 0
    || ADMIN_USERS.includes(String(username).toLowerCase());
  const groups = [];
  if (isAdmin && process.env.ADMIN_GROUP) groups.push(process.env.ADMIN_GROUP);
  if (process.env.VITE_USER_GROUP) groups.push(process.env.VITE_USER_GROUP);
  return {
    id: `ha:${id}`,
    name: display,
    email: `${username}@homeassistant.local`,
    groups,
  };
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

function normalizeGroups(groups) {
  if (Array.isArray(groups)) return groups;
  if (typeof groups === 'string' && groups.trim()) return [groups.trim()];
  return [];
}

function normalizeUser(info = {}) {
  const email = info.email || info.preferred_username || '';
  return {
    id: info.sub,
    name: info.name || email || '',
    email,
    groups: normalizeGroups(info.groups),
  };
}

export function createAuthMiddleware({ getDb, persistUsers = false }) {
  const tokenCache = new Map();
  const TOKEN_CACHE_TTL = 60_000;
  const TOKEN_CACHE_MAX = 1000; // bound memory against a flood of distinct tokens

  const discoveryCache = new Map();
  const DISCOVERY_TTL = 10 * 60_000;

  const jwksCache = new Map();

  let providersCache = null;
  let providersCacheTs = 0;
  const PROVIDERS_TTL = 60_000;

  // Users are upserted at most once per TTL, not on every request.
  const persistedAt = new Map();
  const PERSIST_TTL = 10 * 60_000;

  function invalidateAuthProviderCache() {
    providersCache = null;
    providersCacheTs = 0;
  }

  async function getActiveProviders() {
    if (providersCache && Date.now() - providersCacheTs < PROVIDERS_TTL) return providersCache;
    const db = getDb();
    if (!db) { providersCache = []; providersCacheTs = Date.now(); return []; }
    providersCache = await db.collection('auth_providers').find({ active: true }).toArray();
    providersCacheTs = Date.now();
    return providersCache;
  }

  async function getDiscovery(authority) {
    const url = String(authority || '').replace(/\/+$/, '');
    if (!url) return null;
    const cached = discoveryCache.get(url);
    if (cached && Date.now() - cached.ts < DISCOVERY_TTL) return cached.data;
    const res = await fetch(`${url}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`OIDC discovery failed for ${url} (${res.status})`);
    const data = await res.json();
    discoveryCache.set(url, { data, ts: Date.now() });
    return data;
  }

  function getJwks(jwksUri) {
    if (!jwksCache.has(jwksUri)) jwksCache.set(jwksUri, createRemoteJWKSet(new URL(jwksUri)));
    return jwksCache.get(jwksUri);
  }

  async function persistUser(user) {
    if (!persistUsers) return;
    const db = getDb();
    if (!db || !user?.id) return;
    const last = persistedAt.get(user.id);
    if (last && Date.now() - last < PERSIST_TTL) return;
    persistedAt.set(user.id, Date.now());
    await db.collection('users').updateOne(
      { external_auth_id: user.id },
      {
        $set: { ...user, external_auth_id: user.id, display_name: user.name || user.email || '', updated_at: new Date() },
        $setOnInsert: { created_at: new Date(), status: 'active' },
      },
      { upsert: true }
    );
  }

  async function verifyWithProvider(token, authority, expectedAudience) {
    const discovery = await getDiscovery(authority);
    if (!discovery?.jwks_uri || !discovery?.issuer) return null;
    const jwks = getJwks(discovery.jwks_uri);
    try {
      const options = { issuer: discovery.issuer };
      // Bind the token to this provider's client so a token minted by the same
      // IdP for a different application cannot authenticate here.
      if (expectedAudience) options.audience = expectedAudience;
      const { payload } = await jwtVerify(token, jwks, options);
      return normalizeUser(payload);
    } catch (err) {
      if (err?.code === 'ERR_JWT_EXPIRED') throw err;
      return null;
    }
  }

  async function loadUserFromUserinfo(token, authority) {
    const discovery = await getDiscovery(authority);
    const endpoint = discovery?.userinfo_endpoint || `${new URL(authority).origin}/application/o/userinfo/`;
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = new Error('Your session expired. Please sign in again.');
      err.status = 401;
      err.code = 'SESSION_EXPIRED';
      throw err;
    }
    return normalizeUser(await res.json());
  }

  async function authenticateToken(token) {
    // Try DB-configured providers first
    const providers = await getActiveProviders();
    if (providers.length > 0) {
      const payload = decodeJwtPayload(token);
      const iss = payload?.iss;

      // Find matching provider by issuer
      for (const provider of providers) {
        try {
          const discovery = await getDiscovery(provider.authority);
          if (iss && discovery?.issuer && discovery.issuer !== iss) continue;
          const user = await verifyWithProvider(token, provider.authority, provider.client_id);
          if (user) return user;
          // JWT verify failed, try userinfo
          return await loadUserFromUserinfo(token, provider.authority);
        } catch (err) {
          if (err?.code === 'ERR_JWT_EXPIRED' || err?.code === 'SESSION_EXPIRED') throw err;
          // try next provider
        }
      }
    }

    // Fallback: env var AUTHENTIK_URL (backward compat)
    const authentikUrl = process.env.AUTHENTIK_URL?.replace(/\/+$/, '');
    if (authentikUrl && authentikUrl !== 'undefined') {
      let user = null;
      try {
        user = await verifyWithProvider(token, authentikUrl);
      } catch (err) {
        if (err?.code === 'ERR_JWT_EXPIRED') throw err;
      }
      if (!user) user = await loadUserFromUserinfo(token, authentikUrl);
      return user;
    }

    // Optional insecure decode for LOCAL DEVELOPMENT ONLY. Off unless
    // AUTH_INSECURE_DECODE=1 is explicitly set. When enabled it trusts
    // unverified token claims (including group membership), so it must never be
    // set in production.
    if (process.env.AUTH_INSECURE_DECODE === '1') {
      const decoded = decodeJwtPayload(token);
      if (decoded?.sub) {
        console.warn('[auth] AUTH_INSECURE_DECODE enabled — trusting UNVERIFIED token claims');
        return normalizeUser(decoded);
      }
    }
    throw new Error('Unable to authenticate token: no matching provider found');
  }

  async function requireAuth(req, res, next) {
    if (HA_INGRESS) {
      req.user = ingressUser(req);
      await persistUser(req.user);
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing bearer token' });
    }

    const token = header.slice(7);
    const cached = tokenCache.get(token);
    if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL) {
      req.user = cached.user;
      await persistUser(req.user);
      return next();
    }

    try {
      const user = await authenticateToken(token);
      await persistUser(user);
      // Evict the oldest entry when the cache is full (insertion-ordered Map).
      if (tokenCache.size >= TOKEN_CACHE_MAX) {
        tokenCache.delete(tokenCache.keys().next().value);
      }
      tokenCache.set(token, { user, ts: Date.now() });
      req.user = user;
      next();
    } catch (err) {
      if (err?.code === 'ERR_JWT_EXPIRED' || err?.code === 'SESSION_EXPIRED' || err?.status === 401) {
        return res.status(401).json({ message: 'Your session expired. Please sign in again.', code: 'SESSION_EXPIRED' });
      }
      return res.status(401).json({ message: `Auth error: ${err.message}`, code: 'AUTH_ERROR' });
    }
  }

  return { requireAuth, invalidateAuthProviderCache };
}
