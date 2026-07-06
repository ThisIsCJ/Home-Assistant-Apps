import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { getDb, isConnected } from '../db.js';
import { startRun, startTeardown } from '../lib/automation.js';
import { hasN8nCredentials, listN8nDnsRecords } from '../lib/n8n.js';
import { listProxyHosts, normalizeNpmBaseUrl } from '../lib/nginxProxyManager.js';

const router = Router();
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const MOCK_REQUESTS = [
  { _id: 'mock1', fqdn: 'app.example.com', host_name: 'web-prod-01', host_id: 'h1', domain_id: 'd1', host_port: 3000, status: 'success', created_at: new Date(Date.now() - 86400000 * 2), last_step: 'cloudflare_dns' },
  { _id: 'mock2', fqdn: 'api.example.com', host_name: 'web-prod-01', host_id: 'h1', domain_id: 'd1', host_port: 4000, status: 'partial_success', created_at: new Date(Date.now() - 3600000), last_step: 'nginx_route' },
  { _id: 'mock3', fqdn: 'internal.example.com', host_name: 'web-prod-02', host_id: 'h2', domain_id: 'd1', host_port: 8080, status: 'running', created_at: new Date(), last_step: 'firewall_check' },
];

const MOCK_STEPS = [
  { _id: 's1', step_name: 'permission_validation', step_order: 0, status: 'success', summary: 'Permissions validated.', detail_json: null, started_at: new Date(Date.now() - 5000), ended_at: new Date(Date.now() - 4000) },
  { _id: 's2', step_name: 'port_verification', step_order: 1, status: 'success', summary: 'Port 3000 is open and listening.', detail_json: { port: 3000, listening: true }, started_at: new Date(Date.now() - 4000), ended_at: new Date(Date.now() - 3000) },
  { _id: 's3', step_name: 'firewall_check', step_order: 2, status: 'success', summary: 'Firewall rule already in place.', detail_json: { action: 'none' }, started_at: new Date(Date.now() - 3000), ended_at: new Date(Date.now() - 2000) },
  { _id: 's4', step_name: 'site_reachability', step_order: 3, status: 'warning', summary: 'Site responded with unexpected HTTP 502.', detail_json: { status_code: 502 }, started_at: new Date(Date.now() - 2000), ended_at: new Date(Date.now() - 1500) },
  { _id: 's5', step_name: 'nginx_route', step_order: 4, status: 'success', summary: 'NGINX route created.', detail_json: { route_id: 'proxy-1234' }, started_at: new Date(Date.now() - 1500), ended_at: new Date(Date.now() - 500) },
  { _id: 's6', step_name: 'cloudflare_dns', step_order: 5, status: 'success', summary: 'DNS record created.', detail_json: { record_id: 'dns-abc123' }, started_at: new Date(Date.now() - 500), ended_at: new Date() },
];

function coerceObjectId(value) {
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
}

function isAdmin(user) {
  const adminGroup = process.env.ADMIN_GROUP;
  return Boolean(adminGroup && user?.groups?.includes(adminGroup));
}

function buildPrincipalQuery(userId, teamIds) {
  return {
    $or: [
      { principal_type: 'user', principal_id: userId },
      ...(teamIds.length ? [{ principal_type: 'team', principal_id: { $in: teamIds } }] : []),
    ],
  };
}

async function getUserTeamIds(db, userId) {
  const teams = await db.collection('teams').find({ member_ids: userId }).toArray();
  return teams.map((team) => String(team._id));
}

// Returns the user's own ID plus all IDs of teammates across all shared teams
async function getVisibleUserIds(db, userId) {
  const teams = await db.collection('teams').find({ member_ids: userId }).toArray();
  const ids = new Set([userId]);
  teams.forEach(t => (t.member_ids || []).forEach(id => ids.add(id)));
  return [...ids];
}

async function getAccessibleResources(db, user, resourceCollection, accessCollection, resourceKey) {
  if (isAdmin(user)) {
    return db.collection(resourceCollection).find({ active: true }).sort({ name: 1, domain_name: 1 }).toArray();
  }

  const teamIds = await getUserTeamIds(db, user.id);
  const grants = await db.collection(accessCollection).find(buildPrincipalQuery(user.id, teamIds)).toArray();
  const resourceIds = [...new Set(grants.map((grant) => String(grant[resourceKey] || '')).filter(Boolean))];

  if (!resourceIds.length) {
    return [];
  }

  const objectIds = resourceIds.map(coerceObjectId).filter(Boolean);
  if (!objectIds.length) {
    return [];
  }

  return db.collection(resourceCollection).find({ _id: { $in: objectIds }, active: true }).sort({ name: 1, domain_name: 1 }).toArray();
}

async function userCanAccessResource(db, user, accessCollection, resourceKey, resourceId) {
  if (isAdmin(user)) return true;

  const teamIds = await getUserTeamIds(db, user.id);
  const grant = await db.collection(accessCollection).findOne({
    [resourceKey]: String(resourceId),
    ...buildPrincipalQuery(user.id, teamIds),
  });

  return Boolean(grant);
}

async function ensureRequestAccess(db, request, user) {
  if (isAdmin(user)) return true;
  if (request.requested_by_user_id === user.id) return true;
  const visibleIds = await getVisibleUserIds(db, user.id);
  return visibleIds.includes(request.requested_by_user_id);
}

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

router.get('/options', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({
      hosts: [
        { _id: 'h1', name: 'web-prod-01', hostname: '10.0.1.10', environment: 'production' },
        { _id: 'h2', name: 'web-prod-02', hostname: '10.0.1.11', environment: 'production' },
      ],
      domains: [
        { _id: 'd1', domain_name: 'example.com' },
        { _id: 'd2', domain_name: 'internal.example.org' },
      ],
    });
  }

  const db = getDb();
  const [hosts, domains] = await Promise.all([
    getAccessibleResources(db, req.user, 'hosts', 'host_access', 'host_id'),
    getAccessibleResources(db, req.user, 'domains', 'domain_access', 'domain_id'),
  ]);

  res.json({ hosts, domains });
}));

router.get('/team', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({
      teams: [{ _id: 't1', name: 'platform-team', description: 'Core platform team' }],
      domains: [{ _id: 'd1', domain_name: 'example.com', via: 'team' }],
      hosts: [{ _id: 'h1', name: 'web-prod-01', hostname: '10.0.1.10', environment: 'production', via: 'team' }],
    });
  }

  const db = getDb();
  const teamDocs = await db.collection('teams').find({ member_ids: req.user.id }).toArray();
  const teamIds = teamDocs.map((team) => String(team._id));
  const grantQuery = buildPrincipalQuery(req.user.id, teamIds);

  const [domainAccess, hostAccess] = await Promise.all([
    db.collection('domain_access').find(grantQuery).toArray(),
    db.collection('host_access').find(grantQuery).toArray(),
  ]);

  const domainIds = [...new Set(domainAccess.map((grant) => String(grant.domain_id || '')).filter(Boolean))];
  const hostIds = [...new Set(hostAccess.map((grant) => String(grant.host_id || '')).filter(Boolean))];

  const [domains, hosts] = await Promise.all([
    domainIds.length
      ? db.collection('domains').find({ _id: { $in: domainIds.map(coerceObjectId).filter(Boolean) }, active: true }).toArray()
      : [],
    hostIds.length
      ? db.collection('hosts').find({ _id: { $in: hostIds.map(coerceObjectId).filter(Boolean) }, active: true }).toArray()
      : [],
  ]);

  res.json({
    teams: teamDocs,
    domains: domains.map((domain) => ({
      ...domain,
      via: domainAccess.find((grant) => String(grant.domain_id) === String(domain._id))?.principal_type === 'team' ? 'team' : 'direct',
    })),
    hosts: hosts.map((host) => ({
      ...host,
      via: hostAccess.find((grant) => String(grant.host_id) === String(host._id))?.principal_type === 'team' ? 'team' : 'direct',
    })),
  });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) {
    const stats = { total: 3, success: 1, failed: 0, partial: 1, pending: 1 };
    return res.json({ requests: MOCK_REQUESTS, stats });
  }

  const db = getDb();
  let query;
  if (isAdmin(req.user) && req.query.scope === 'all') {
    query = {};
  } else {
    const visibleIds = await getVisibleUserIds(db, req.user.id);
    query = { requested_by_user_id: { $in: visibleIds } };
  }

  const requests = await db.collection('requests')
    .find(query)
    .sort({ created_at: -1 })
    .limit(Number(req.query.limit) || 100)
    .toArray();

  const total = requests.length;
  const success = requests.filter((request) => request.status === 'success').length;
  const failed = requests.filter((request) => request.status === 'failed').length;
  const partial = requests.filter((request) => request.status === 'partial_success').length;
  const pending = requests.filter((request) => request.status === 'running' || request.status === 'pending').length;

  res.json({ requests, stats: { total, success, failed, partial, pending } });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { host_id: hostId, domain_id: domainId, subdomain, host_port: hostPort } = req.body;
  if (!hostId || !domainId || !hostPort) {
    return res.status(400).json({ message: 'host_id, domain_id, and host_port are required' });
  }
  if (hostPort < 1 || hostPort > 65535) {
    return res.status(400).json({ message: 'Invalid port number' });
  }

  if (!isConnected()) {
    const mock = { _id: 'new-' + Date.now(), fqdn: `${subdomain ? subdomain + '.' : ''}example.com`, host_name: 'web-prod-01', host_port: hostPort, status: 'running', created_at: new Date() };
    return res.status(201).json(mock);
  }

  const db = getDb();
  const hostObjectId = coerceObjectId(hostId);
  const domainObjectId = coerceObjectId(domainId);
  if (!hostObjectId || !domainObjectId) {
    return res.status(400).json({ message: 'Invalid host or domain identifier.' });
  }

  const [host, domain, hostAllowed, domainAllowed] = await Promise.all([
    db.collection('hosts').findOne({ _id: hostObjectId, active: true }),
    db.collection('domains').findOne({ _id: domainObjectId, active: true }),
    userCanAccessResource(db, req.user, 'host_access', 'host_id', hostId),
    userCanAccessResource(db, req.user, 'domain_access', 'domain_id', domainId),
  ]);

  if (!host) return res.status(400).json({ message: 'Host not found or inactive.' });
  if (!domain) return res.status(400).json({ message: 'Domain not found or inactive.' });
  if (!hostAllowed || !domainAllowed) {
    return res.status(403).json({ message: 'You do not have access to that host and domain combination.' });
  }

  const fqdn = subdomain ? `${subdomain}.${domain.domain_name}` : domain.domain_name;
  const now = new Date();
  const doc = {
    requested_by_user_id: req.user.id,
    requested_by_email: req.user.email,
    host_id: hostObjectId,
    host_name: host.name,
    host_hostname: host.hostname,
    domain_id: domainObjectId,
    domain_name: domain.domain_name,
    subdomain: subdomain || null,
    fqdn,
    host_port: Number(hostPort),
    status: 'pending',
    last_step: null,
    created_at: now,
    updated_at: now,
  };

  const { insertedId } = await db.collection('requests').insertOne(doc);

  await db.collection('audit').insertOne({
    actor_user_id: req.user.id,
    actor_email: req.user.email,
    action_type: 'create',
    target_type: 'request',
    target_id: String(insertedId),
    summary: `Requested site: ${fqdn}`,
    detail_json: { fqdn, host_port: Number(hostPort), host_id: hostId, domain_id: domainId },
    created_at: now,
  });

  startRun(String(insertedId), req.user.id);
  res.status(201).json({ _id: insertedId, fqdn, status: 'pending' });
}));

router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ sites: [] });
  const db = getDb();

  let query;
  if (isAdmin(req.user) && req.query.scope === 'all') {
    query = { status: { $nin: ['removed', 'pending', 'running'] } };
  } else {
    const visibleIds = await getVisibleUserIds(db, req.user.id);
    query = { requested_by_user_id: { $in: visibleIds }, status: { $nin: ['removed', 'pending', 'running'] } };
  }

  const requests = await db.collection('requests').find(query).sort({ created_at: -1 }).toArray();

  // Keep only the most-recent request per FQDN
  const byFqdn = new Map();
  requests.forEach((r) => { if (!byFqdn.has(r.fqdn)) byFqdn.set(r.fqdn, r); });
  const unique = [...byFqdn.values()];

  if (!unique.length) return res.json({ sites: [] });

  const cfgDocs = await db.collection('integrations').find({}).toArray();
  const configs = {};
  cfgDocs.forEach((doc) => { configs[doc.provider] = doc; });

  const n8nCfg = configs.n8n || {};
  const nginxCfg = configs.nginx || {};
  const hasNginxCfg = Boolean(normalizeNpmBaseUrl(nginxCfg) && nginxCfg.username && nginxCfg.password && nginxCfg.password !== '***');

  // Group by domain to batch n8n calls
  const byDomain = new Map();
  unique.forEach((r) => {
    const d = r.domain_name || '';
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(r);
  });

  const dnsByDomain = new Map();
  if (hasN8nCredentials(n8nCfg)) {
    await Promise.all([...byDomain.keys()].filter(Boolean).map(async (domain) => {
      try {
        dnsByDomain.set(domain, await listN8nDnsRecords(n8nCfg, domain));
      } catch {
        dnsByDomain.set(domain, 'error');
      }
    }));
  }

  let nginxHosts = null;
  let nginxError = false;
  if (hasNginxCfg) {
    try {
      nginxHosts = await listProxyHosts(nginxCfg);
    } catch {
      nginxError = true;
    }
  }

  const sites = unique.map((r) => {
    const fqdn = r.fqdn;
    const domain = r.domain_name || '';
    const dnsResult = dnsByDomain.get(domain);
    const dnsRecord = Array.isArray(dnsResult) ? dnsResult.find((rec) => rec.name === fqdn) : null;
    const nginxHost = Array.isArray(nginxHosts) ? nginxHosts.find((h) => h.domain_names?.includes(fqdn)) : null;

    return {
      fqdn,
      request_id: String(r._id),
      request_status: r.status,
      host_name: r.host_name,
      host_port: r.host_port,
      domain_name: domain,
      dns: !hasN8nCredentials(n8nCfg)
        ? { checked: false }
        : dnsResult === 'error'
          ? { checked: true, error: true }
          : { checked: true, exists: Boolean(dnsRecord), type: dnsRecord?.type, content: dnsRecord?.content, proxied: dnsRecord?.proxied },
      nginx: !hasNginxCfg
        ? { checked: false }
        : nginxError
          ? { checked: true, error: true }
          : { checked: true, exists: Boolean(nginxHost), forward_host: nginxHost?.forward_host, forward_port: nginxHost?.forward_port, enabled: nginxHost?.enabled !== false },
    };
  });

  res.json({ sites });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) {
    const mock = MOCK_REQUESTS.find((request) => request._id === req.params.id) || MOCK_REQUESTS[0];
    return res.json({ request: mock, run: { _id: 'run1', final_status: 'partial_success', started_at: new Date(Date.now() - 8000), ended_at: new Date() }, steps: MOCK_STEPS });
  }

  const db = getDb();
  const requestId = coerceObjectId(req.params.id);
  if (!requestId) return res.status(400).json({ message: 'Invalid ID' });

  const request = await db.collection('requests').findOne({ _id: requestId });
  if (!request) return res.status(404).json({ message: 'Not found' });
  if (!await ensureRequestAccess(db, request, req.user)) return res.status(403).json({ message: 'Access denied' });

  const run = await db.collection('runs').findOne({ site_request_id: requestId }, { sort: { started_at: -1 } });
  const steps = run
    ? await db.collection('steps').find({ automation_run_id: run._id }).sort({ step_order: 1 }).toArray()
    : [];

  res.json({ request, run, steps });
}));

router.post('/:id/rerun', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });

  const db = getDb();
  const requestId = coerceObjectId(req.params.id);
  if (!requestId) return res.status(400).json({ message: 'Invalid ID' });

  const request = await db.collection('requests').findOne({ _id: requestId });
  if (!request) return res.status(404).json({ message: 'Not found' });
  if (!await ensureRequestAccess(db, request, req.user)) return res.status(403).json({ message: 'Access denied' });

  await db.collection('requests').updateOne(
    { _id: requestId },
    { $set: { status: 'pending', last_step: null, updated_at: new Date() } }
  );

  await db.collection('audit').insertOne({
    actor_user_id: req.user.id,
    actor_email: req.user.email,
    action_type: 'rerun',
    target_type: 'request',
    target_id: req.params.id,
    summary: `Re-run triggered for ${request.fqdn}`,
    detail_json: {},
    created_at: new Date(),
  });

  startRun(req.params.id, req.user.id);
  res.json({ ok: true });
}));

router.post('/:id/teardown', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });

  const db = getDb();
  const requestId = coerceObjectId(req.params.id);
  if (!requestId) return res.status(400).json({ message: 'Invalid ID' });

  const request = await db.collection('requests').findOne({ _id: requestId });
  if (!request) return res.status(404).json({ message: 'Not found' });
  if (!await ensureRequestAccess(db, request, req.user)) return res.status(403).json({ message: 'Access denied' });
  if (request.status === 'running') {
    return res.status(400).json({ message: 'Cannot tear down a request while it is still running.' });
  }

  await db.collection('requests').updateOne(
    { _id: requestId },
    { $set: { status: 'pending', last_step: null, updated_at: new Date() } }
  );

  await db.collection('audit').insertOne({
    actor_user_id: req.user.id,
    actor_email: req.user.email,
    action_type: 'teardown',
    target_type: 'request',
    target_id: req.params.id,
    summary: `Teardown triggered for ${request.fqdn}`,
    detail_json: {},
    created_at: new Date(),
  });

  startTeardown(req.params.id, req.user.id);
  res.json({ ok: true });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });

  const db = getDb();
  const requestId = coerceObjectId(req.params.id);
  if (!requestId) return res.status(400).json({ message: 'Invalid ID' });

  const request = await db.collection('requests').findOne({ _id: requestId });
  if (!request) return res.status(404).json({ message: 'Not found' });
  if (!await ensureRequestAccess(db, request, req.user)) return res.status(403).json({ message: 'Access denied' });
  if (request.status === 'running') {
    return res.status(400).json({ message: 'Cannot delete a request while it is running.' });
  }

  const runs = await db.collection('runs').find({ site_request_id: requestId }).toArray();
  const runIds = runs.map((run) => run._id);

  await Promise.all([
    db.collection('requests').deleteOne({ _id: requestId }),
    db.collection('runs').deleteMany({ site_request_id: requestId }),
    runIds.length
      ? db.collection('steps').deleteMany({ automation_run_id: { $in: runIds } })
      : Promise.resolve(),
  ]);

  await db.collection('audit').insertOne({
    actor_user_id: req.user.id,
    actor_email: req.user.email,
    action_type: 'delete',
    target_type: 'request',
    target_id: req.params.id,
    summary: `Deleted request history for ${request.fqdn}`,
    detail_json: {},
    created_at: new Date(),
  });

  res.json({ ok: true });
}));

export default router;
