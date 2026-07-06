import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getDb, isConnected } from '../db.js';
import { hasCloudflareCredentials, listCloudflareZones, listCloudflareDnsRecords } from '../lib/cloudflare.js';
import { normalizeNpmBaseUrl, listProxyHosts } from '../lib/nginxProxyManager.js';
import { testHostReadiness } from '../lib/ssh.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Get discovery config
router.get('/discovery/config', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ publicIp: '' });
  const db = getDb();
  const cfg = await db.collection('discovery_config').findOne({ _id: 'config' });
  res.json({ publicIp: cfg?.publicIp || '' });
}));

// Save discovery config
router.post('/discovery/config', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const db = getDb();
  const { publicIp } = req.body;
  await db.collection('discovery_config').updateOne(
    { _id: 'config' },
    { $set: { publicIp: (publicIp || '').trim(), updated_at: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true });
}));

// Get latest discovery result
router.get('/discovery/latest', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json(null);
  const db = getDb();
  const result = await db.collection('discovery').findOne({ _id: 'latest' });
  res.json(result || null);
}));

// Run discovery
router.post('/discovery/run', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const db = getDb();
  const ts = new Date();

  // Load everything in parallel
  const [intDocs, cfgDoc, hosts] = await Promise.all([
    db.collection('integrations').find({}).toArray(),
    db.collection('discovery_config').findOne({ _id: 'config' }),
    db.collection('hosts').find({ active: true }).toArray(),
  ]);

  const intMap = {};
  intDocs.forEach(d => { intMap[d.provider || d._id] = d; });

  const cfCfg    = intMap['cloudflare'] || {};
  const nginxCfg = intMap['nginx'] || {};
  const publicIp = (cfgDoc?.publicIp || '').trim();

  const errors = [];
  let nginxHosts = [];
  let cfRecords  = [];

  // ── NGINX ──────────────────────────────────────────────────────────────────
  const npmBase = normalizeNpmBaseUrl(nginxCfg);
  if (npmBase && nginxCfg.username && nginxCfg.password && nginxCfg.password !== '***') {
    try {
      nginxHosts = await listProxyHosts(nginxCfg);
    } catch (err) {
      errors.push(`NGINX Proxy Manager: ${err.message}`);
    }
  } else {
    errors.push('NGINX Proxy Manager not configured — add credentials in Integrations.');
  }

  // ── Cloudflare ─────────────────────────────────────────────────────────────
  if (hasCloudflareCredentials(cfCfg)) {
    if (!publicIp) {
      errors.push('Public IP not set — Cloudflare records will not be filtered.');
    }
    try {
      const zones = await listCloudflareZones(cfCfg);
      const perZone = await Promise.allSettled(
        zones.map(async zone => {
          const records = await listCloudflareDnsRecords(cfCfg, zone.id);
          return records.map(r => ({ ...r, zone_name: zone.name, zone_id: zone.id }));
        })
      );
      cfRecords = perZone.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    } catch (err) {
      errors.push(`Cloudflare: ${err.message}`);
    }
  } else {
    errors.push('Cloudflare not configured — add credentials in Integrations.');
  }

  // ── Match NGINX hosts → DB hosts ────────────────────────────────────────────
  // Index DB hosts by hostname (lowercase) for O(1) lookup
  const hostByHostname = {};
  hosts.forEach(h => {
    if (h.hostname) hostByHostname[h.hostname.toLowerCase()] = h;
  });

  const nginxEntries = nginxHosts.map(nh => {
    const fqdns       = nh.domain_names || [];
    const fqdn        = fqdns[0] || '';
    const forwardHost = (nh.forward_host || '').toLowerCase();
    const matched     = hostByHostname[forwardHost] || null;

    return {
      nginx_id:     nh.id,
      fqdns,
      fqdn,
      forward_host: nh.forward_host,
      forward_port: nh.forward_port,
      enabled:      nh.enabled !== false,
      status:       matched ? 'matched' : 'no_host',
      host_id:      matched ? String(matched._id) : null,
      host_name:    matched ? (matched.name || matched.hostname) : null,
    };
  });

  // ── Check which NGINX FQDNs are already tracked as requests ────────────────
  const allFqdns = nginxEntries.flatMap(e => e.fqdns).filter(Boolean);
  if (allFqdns.length) {
    const tracked = await db.collection('requests')
      .find({ fqdn: { $in: allFqdns }, status: { $in: ['success', 'partial_success'] } })
      .project({ fqdn: 1 })
      .toArray();
    const trackedSet = new Set(tracked.map(r => r.fqdn));
    nginxEntries.forEach(e => { e.tracked = e.fqdns.some(f => trackedSet.has(f)); });
  }

  // ── Match Cloudflare A records → NGINX ─────────────────────────────────────
  const nginxFqdnMap = {};
  nginxEntries.forEach(ne => {
    ne.fqdns.forEach(f => { nginxFqdnMap[f] = ne; });
  });

  // Filter: A records whose content matches publicIp (or all A records if no IP set)
  const filteredCf = publicIp
    ? cfRecords.filter(r => r.type === 'A' && r.content === publicIp)
    : cfRecords.filter(r => r.type === 'A');

  const cfEntries = filteredCf.map(r => {
    const nginxEntry = nginxFqdnMap[r.name] || null;
    return {
      cf_id:       r.id,
      fqdn:        r.name,
      type:        r.type,
      content:     r.content,
      proxied:     r.proxied,
      zone_name:   r.zone_name,
      zone_id:     r.zone_id,
      status:      nginxEntry ? 'ok' : 'no_nginx',
      nginx_status: nginxEntry ? nginxEntry.status : null,
      forward_host: nginxEntry ? nginxEntry.forward_host : null,
    };
  });

  const stats = {
    nginx_total:   nginxEntries.length,
    nginx_matched: nginxEntries.filter(e => e.status === 'matched').length,
    nginx_no_host: nginxEntries.filter(e => e.status === 'no_host').length,
    cf_total:      cfEntries.length,
    cf_ok:         cfEntries.filter(e => e.status === 'ok').length,
    cf_no_nginx:   cfEntries.filter(e => e.status === 'no_nginx').length,
  };

  const result = {
    _id: 'latest',
    ts,
    public_ip:     publicIp,
    nginx_entries: nginxEntries,
    cf_entries:    cfEntries,
    stats,
    errors,
  };

  await db.collection('discovery').replaceOne({ _id: 'latest' }, result, { upsert: true });
  res.json(result);
}));

// Adopt an NGINX-matched site into the platform
router.post('/discovery/adopt', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const db = getDb();
  const { fqdn, host_id, forward_port } = req.body;
  if (!fqdn || !host_id) return res.status(400).json({ message: 'fqdn and host_id are required' });

  // Already tracked?
  const existing = await db.collection('requests').findOne({
    fqdn, status: { $in: ['success', 'partial_success'] },
  });
  if (existing) return res.status(409).json({ message: 'Site is already tracked' });

  // Resolve host
  let host = null;
  try { host = await db.collection('hosts').findOne({ _id: new ObjectId(host_id) }); } catch {}
  if (!host) return res.status(404).json({ message: 'Host not found' });

  // Run readiness test when a managed key is available
  let testResult = { ok: null, checks: [], message: 'No managed SSH key — test skipped.' };
  if (host.managed_ssh_private_key) {
    try {
      const r = await testHostReadiness(host);
      testResult = {
        ok: r.ok,
        checks: r.checks || [],
        message: r.ok ? 'Host readiness checks passed.' : 'Host readiness checks failed.',
      };
    } catch (err) {
      testResult = { ok: false, checks: [], message: err.message };
    }
  }

  // Create the adopted request record
  const doc = {
    fqdn,
    host_id:   host._id,
    host_name: host.name || host.hostname,
    host_port: Number(forward_port) || 80,
    status:    'success',
    adopted:   true,
    adopted_from: 'discovery',
    created_at: new Date(),
    requested_by_user_id:  req.user.id,
    requested_by_email:    req.user.email,
  };
  const { insertedId } = await db.collection('requests').insertOne(doc);

  res.json({ ok: true, request_id: String(insertedId), testResult });
}));

export default router;
