import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getDb, isConnected } from '../db.js';
import { checkSiteById } from '../lib/monitorScheduler.js';

const router = Router();

function isAdminUser(user, adminGroup) {
  const g = adminGroup || process.env.ADMIN_GROUP;
  return Boolean(g && user?.groups?.includes(g));
}

// List sites with latest monitoring check results
router.get('/sites', requireAuth, async (req, res) => {
  if (!isConnected()) return res.json({ sites: [], globalConfig: {} });
  const db = getDb();

  const siteCfg = await db.collection('site').findOne({ _id: 'global' });
  const adminGroup = process.env.ADMIN_GROUP || siteCfg?.adminGroup || '';
  const userIsAdmin = isAdminUser(req.user, adminGroup);

  const activeStatuses = { status: { $in: ['success', 'partial_success'] } };
  let query;
  if (userIsAdmin && req.query.scope === 'all') {
    query = activeStatuses;
  } else {
    const teams = await db.collection('teams').find({ member_ids: req.user.id }).toArray();
    const visibleIds = new Set([req.user.id]);
    teams.forEach(t => (t.member_ids || []).forEach(id => visibleIds.add(id)));
    query = { requested_by_user_id: { $in: [...visibleIds] }, ...activeStatuses };
  }

  const requests = await db.collection('requests').find(query).sort({ created_at: -1 }).toArray();

  const byFqdn = new Map();
  requests.forEach(r => { if (!byFqdn.has(r.fqdn)) byFqdn.set(r.fqdn, r); });
  const sites = [...byFqdn.values()];

  if (!sites.length) return res.json({ sites: [], globalConfig: {} });

  const requestIds = sites.map(r => String(r._id));

  const configs = await db.collection('monitor_config')
    .find({ _id: { $in: [...requestIds, 'global'] } })
    .toArray();
  const configMap = {};
  configs.forEach(c => { configMap[c._id] = c; });
  const globalCfg = configMap['global'] || {};

  const latest = await db.collection('monitor_results').aggregate([
    { $match: { request_id: { $in: requestIds } } },
    { $sort: { ts: -1 } },
    { $group: { _id: { request_id: '$request_id', check_type: '$check_type' }, doc: { $first: '$$ROOT' } } }
  ]).toArray();

  const latestMap = {};
  latest.forEach(r => {
    const { request_id, check_type } = r._id;
    if (!latestMap[request_id]) latestMap[request_id] = {};
    latestMap[request_id][check_type] = r.doc;
  });

  const out = sites.map(r => {
    const id = String(r._id);
    const cfg = configMap[id] || {};
    const checks = latestMap[id] || {};
    const url = checks.url;
    const port = checks.port;
    const host = checks.host;

    return {
      request_id: id,
      fqdn: r.fqdn,
      host_name: r.host_name,
      host_port: r.host_port,
      monitoring_enabled: cfg.monitoring_enabled || false,
      check_url:  cfg.check_url  !== false,
      check_port: cfg.check_port !== false,
      check_host: cfg.check_host !== false,
      interval_seconds: cfg.interval_seconds || globalCfg.interval_seconds || 300,
      checks: {
        url: url ? {
          ok: url.ok, latency_ms: url.latency_ms, http_status: url.http_status,
          ssl_valid: url.ssl_valid, ssl_days_remaining: url.ssl_days_remaining,
          error: url.error, ts: url.ts,
        } : null,
        port: port ? { ok: port.ok, latency_ms: port.latency_ms, error: port.error, ts: port.ts } : null,
        host: host ? {
          ok: host.ok, cpu_pct: host.cpu_pct, mem_pct: host.mem_pct, disk_pct: host.disk_pct,
          error: host.error, ts: host.ts,
        } : null,
      },
    };
  });

  res.json({
    sites: out,
    globalConfig: {
      interval_seconds: globalCfg.interval_seconds || 300,
      alert_threshold: globalCfg.alert_threshold || 3,
      webhook_url: globalCfg.webhook_url || null,
    },
  });
});

// 24h hourly history for sparkline (URL checks)
router.get('/sites/:id/history', requireAuth, async (req, res) => {
  if (!isConnected()) return res.json({ hourly: [] });
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const hourly = await db.collection('monitor_hourly')
    .find({ request_id: req.params.id, check_type: 'url', bucket: { $gte: since } })
    .sort({ bucket: 1 })
    .toArray();
  res.json({ hourly: hourly.map(h => ({ bucket: h.bucket, avg_latency: h.avg_latency, uptime_pct: h.uptime_pct })) });
});

// Global config (admin)
router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.json({ interval_seconds: 300, alert_threshold: 3 });
  const db = getDb();
  const cfg = (await db.collection('monitor_config').findOne({ _id: 'global' })) || {};
  res.json({
    interval_seconds: cfg.interval_seconds || 300,
    alert_threshold:  cfg.alert_threshold  || 3,
  });
});

router.post('/config', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const db = getDb();
  const { interval_seconds, alert_threshold } = req.body;
  await db.collection('monitor_config').updateOne(
    { _id: 'global' },
    { $set: { interval_seconds: Number(interval_seconds) || 300, alert_threshold: Number(alert_threshold) || 3 } },
    { upsert: true }
  );
  res.json({ ok: true });
});

// Webhooks CRUD (admin)
router.get('/webhooks', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.json({ webhooks: [] });
  const webhooks = await getDb().collection('webhooks').find().sort({ created_at: 1 }).toArray();
  res.json({ webhooks });
});

router.post('/webhooks', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const { name, url, enabled, events, scope } = req.body;
  const doc = {
    name:    name  || 'Webhook',
    url:     url   || '',
    enabled: enabled !== false,
    events:  Array.isArray(events) ? events : ['alert', 'recovery'],
    scope:   { type: scope?.type || 'all', value: scope?.value || null },
    created_at: new Date(),
    updated_at: new Date(),
  };
  const result = await getDb().collection('webhooks').insertOne(doc);
  res.json({ webhook: { ...doc, _id: result.insertedId } });
});

router.put('/webhooks/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const { name, url, enabled, events, scope } = req.body;
  await getDb().collection('webhooks').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: {
      name:    name  || 'Webhook',
      url:     url   || '',
      enabled: enabled !== false,
      events:  Array.isArray(events) ? events : ['alert', 'recovery'],
      scope:   { type: scope?.type || 'all', value: scope?.value || null },
      updated_at: new Date(),
    }}
  );
  res.json({ ok: true });
});

router.delete('/webhooks/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  await getDb().collection('webhooks').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ ok: true });
});

// Scope options for webhook form dropdowns (admin)
router.get('/scope-options', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.json({ sites: [], domains: [], hosts: [], users: [], teams: [] });
  const db = getDb();
  const [sites, domains, hosts, users, teams] = await Promise.all([
    db.collection('requests').find({ status: { $in: ['success', 'partial_success'] } }, { projection: { fqdn: 1 } }).toArray(),
    db.collection('domains').find({}, { projection: { domain: 1, name: 1 } }).toArray(),
    db.collection('hosts').find({}, { projection: { hostname: 1, label: 1 } }).toArray(),
    db.collection('users').find({}, { projection: { name: 1, email: 1 } }).toArray(),
    db.collection('teams').find({}, { projection: { name: 1 } }).toArray(),
  ]);
  res.json({
    sites:   sites.map(s   => ({ id: String(s._id),  label: s.fqdn })),
    domains: domains.map(d => ({ id: d.domain || String(d._id), label: d.domain || d.name })),
    hosts:   hosts.map(h   => ({ id: String(h._id),  label: h.hostname || h.label })),
    users:   users.map(u   => ({ id: u._id,           label: u.name || u.email || u._id })),
    teams:   teams.map(t   => ({ id: String(t._id),   label: t.name })),
  });
});

// Per-site toggle / interval override (admin)
router.patch('/sites/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const db = getDb();
  const id = req.params.id;
  const { monitoring_enabled, check_url, check_port, check_host, interval_seconds } = req.body;

  const update = {};
  if (monitoring_enabled !== undefined) update.monitoring_enabled = Boolean(monitoring_enabled);
  if (check_url  !== undefined) update.check_url  = Boolean(check_url);
  if (check_port !== undefined) update.check_port = Boolean(check_port);
  if (check_host !== undefined) update.check_host = Boolean(check_host);
  if (interval_seconds !== undefined) update.interval_seconds = Number(interval_seconds) || null;

  await db.collection('monitor_config').updateOne(
    { _id: id },
    { $set: update, $setOnInsert: { _id: id } },
    { upsert: true }
  );
  res.json({ ok: true });
});

// Manual check trigger (admin)
router.post('/sites/:id/check-now', requireAuth, requireAdmin, async (req, res) => {
  checkSiteById(req.params.id).catch(err => console.error('[monitor] check-now:', err.message));
  res.json({ ok: true });
});

export default router;
