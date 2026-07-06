import { Router } from 'express';
import fs from 'node:fs';
import { ObjectId, MongoClient } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getDb, isConnected } from '../db.js';
import {
  listCloudflareDnsRecords,
  listCloudflareZones,
  upsertCloudflareDomains,
  upsertCloudflareZones,
  verifyCloudflare,
} from '../lib/cloudflare.js';
import {
  hasN8nCredentials,
  listN8nDnsRecords,
  listN8nZones,
  verifyN8n,
} from '../lib/n8n.js';
import { normalizeNpmBaseUrl, verifyNpm } from '../lib/nginxProxyManager.js';
import { buildFirewallSudoInstructions, generateSshKeyPair, installManagedKey, testHostReadiness } from '../lib/ssh.js';
import multer from 'multer';

const router = Router();
router.use(requireAuth, requireAdmin);

const MASKED_SECRET = '***';
const INTEGRATION_SECRET_FIELDS = {
  cloudflare: ['api_token', 'api_key'],
  nginx: ['password'],
  n8n: ['api_key'],
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function coerceObjectId(value) {
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
}

function normalizeUserDoc(user, adminGroup) {
  const groups = Array.isArray(user?.groups) ? user.groups : [];
  return {
    ...user,
    display_name: user?.display_name || user?.name || user?.email || '—',
    role: user?.role || (groups.includes(adminGroup) ? 'admin' : 'user'),
    status: user?.status || 'active',
    groups,
  };
}

function sanitizeHostDoc(host = {}) {
  const { managed_ssh_private_key, ssh_password, ...rest } = host;
  return {
    ...rest,
    has_managed_key: Boolean(managed_ssh_private_key || host.managed_ssh_public_key),
  };
}

function sanitizeIntegrationDoc(doc) {
  if (!doc) return null;
  const normalized = {
    ...doc,
    ...(doc.provider === 'nginx' ? { base_url: normalizeNpmBaseUrl(doc) } : {}),
  };
  const { _id, ...rest } = normalized;
  return {
    ...rest,
    api_token: rest.api_token ? MASKED_SECRET : undefined,
    api_key: rest.api_key ? MASKED_SECRET : undefined,
    password: rest.password ? MASKED_SECRET : undefined,
    token: rest.token ? MASKED_SECRET : undefined,
  };
}

async function audit(db, req, action_type, target_type, target_id, summary, detail_json = {}) {
  await db.collection('audit').insertOne({
    actor_user_id: req.user.id,
    actor_email: req.user.email,
    action_type,
    target_type,
    target_id,
    summary,
    detail_json,
    created_at: new Date(),
  });
}

async function getPrincipalCatalog(db) {
  const adminGroup = process.env.ADMIN_GROUP;
  const [users, teams] = await Promise.all([
    db.collection('users').find({}).sort({ email: 1 }).toArray(),
    db.collection('teams').find({}).sort({ name: 1 }).toArray(),
  ]);

  return {
    users: users
      .map((user) => normalizeUserDoc(user, adminGroup))
      .map((user) => ({
        id: user.external_auth_id,
        label: `${user.display_name} (${user.email})`,
        email: user.email,
        display_name: user.display_name,
        groups: user.groups,
      })),
    teams: teams.map((team) => ({
      id: String(team._id),
      label: team.name,
      name: team.name,
    })),
  };
}

async function resolvePrincipal(db, principalType, rawPrincipalId) {
  if (principalType === 'team') {
    const teamId = coerceObjectId(rawPrincipalId);
    const team = await db.collection('teams').findOne({
      $or: [
        ...(teamId ? [{ _id: teamId }] : []),
        { name: rawPrincipalId },
      ],
    });

    if (!team) throw new Error(`Team not found for "${rawPrincipalId}".`);
    return {
      principal_id: String(team._id),
      principal_label: team.name,
    };
  }

  if (principalType === 'user') {
    const userId = coerceObjectId(rawPrincipalId);
    const user = await db.collection('users').findOne({
      $or: [
        { external_auth_id: rawPrincipalId },
        { email: rawPrincipalId },
        ...(userId ? [{ _id: userId }] : []),
      ],
    });

    if (!user) throw new Error(`User not found for "${rawPrincipalId}".`);
    const normalized = normalizeUserDoc(user, process.env.ADMIN_GROUP);
    return {
      principal_id: normalized.external_auth_id,
      principal_label: `${normalized.display_name} (${normalized.email})`,
    };
  }

  throw new Error(`Unsupported principal type "${principalType}".`);
}

async function loadAccessGrants(db, collectionName, resourceField, resourceId) {
  const grants = await db.collection(collectionName).find({ [resourceField]: resourceId }).toArray();
  return grants.map((grant) => ({
    ...grant,
    principal_label: grant.principal_label || grant.principal_id,
  }));
}

function normalizeDomainPayload(body = {}) {
  return {
    domain_name: body.domain_name?.trim(),
    cloudflare_zone_id: body.cloudflare_zone_id?.trim() || '',
    nginx_cert_profile: body.nginx_cert_profile?.trim() || '',
    dns_target: body.dns_target?.trim() || body.domain_name?.trim() || '',
    active: body.active !== false,
  };
}

async function saveHost(db, req, hostId, body, { isCreate }) {
  const sshPassword = body.ssh_password?.trim();
  const existing = hostId ? await db.collection('hosts').findOne({ _id: new ObjectId(hostId) }) : null;
  if (hostId && !existing) {
    const error = new Error('Host not found.');
    error.status = 404;
    throw error;
  }
  const now = new Date();
  const doc = {
    name: body.name?.trim(),
    hostname: body.hostname?.trim(),
    ssh_port: Number(body.ssh_port || 22),
    ssh_username: body.ssh_username?.trim() || 'root',
    environment: body.environment?.trim() || '',
    active: body.active !== false,
    onboarding_status: existing?.onboarding_status || 'pending',
    updated_at: now,
  };

  if (!doc.name || !doc.hostname) {
    const error = new Error('Host name and hostname are required.');
    error.status = 400;
    throw error;
  }

  const needsManagedKey = isCreate || !existing?.managed_ssh_private_key;
  let keyPair = existing?.managed_ssh_private_key && existing?.managed_ssh_public_key
    ? {
        privateKey: existing.managed_ssh_private_key,
        publicKey: existing.managed_ssh_public_key,
      }
    : null;

  if (needsManagedKey && !sshPassword) {
    const error = new Error('SSH password is required the first time a host is onboarded.');
    error.status = 400;
    throw error;
  }

  if (sshPassword) {
    keyPair = keyPair || generateSshKeyPair(`devops-platform@${doc.name}`);
    await installManagedKey(doc, sshPassword, keyPair);
    doc.managed_ssh_private_key = keyPair.privateKey;
    doc.managed_ssh_public_key = keyPair.publicKey;
    doc.managed_key_installed_at = now;
    doc.onboarding_status = 'ready';
  } else if (keyPair) {
    doc.managed_ssh_private_key = keyPair.privateKey;
    doc.managed_ssh_public_key = keyPair.publicKey;
  }

  if (isCreate) {
    doc.created_at = now;
    const inserted = await db.collection('hosts').insertOne(doc);
    const created = await db.collection('hosts').findOne({ _id: inserted.insertedId });
    await audit(db, req, 'create', 'host', String(inserted.insertedId), `Added host: ${doc.name}`);
    return {
      host: sanitizeHostDoc(created),
      sudo_instructions: buildFirewallSudoInstructions(doc),
    };
  }

  const updated = await db.collection('hosts').findOneAndUpdate(
    { _id: new ObjectId(hostId) },
    { $set: doc },
    { returnDocument: 'after', includeResultMetadata: false }
  );
  await audit(db, req, 'update', 'host', hostId, `Updated host: ${doc.name}`);
  return {
    host: sanitizeHostDoc(updated),
    sudo_instructions: buildFirewallSudoInstructions(doc),
  };
}

router.get('/stats', asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({
      users: 3,
      teams: 1,
      hosts: 2,
      domains: 2,
      integrations: { authentik: 'pending', cloudflare: 'pending', nginx: 'pending' },
      recentRequests: [],
      recentFailures: [],
    });
  }

  const db = getDb();
  const recentRequests = await db.collection('requests').find({}).sort({ created_at: -1 }).limit(10).toArray();
  const [users, teams, hosts, domains, cfgDocs] = await Promise.all([
    db.collection('users').countDocuments(),
    db.collection('teams').countDocuments(),
    db.collection('hosts').countDocuments({ active: true }),
    db.collection('domains').countDocuments({ active: true }),
    db.collection('integrations').find({}).toArray(),
  ]);

  const integrations = {};
  cfgDocs.forEach((config) => {
    integrations[config.provider] = config.active ? 'success' : 'pending';
  });

  const failedSteps = await db.collection('steps').find({ status: 'failed' }).sort({ started_at: -1 }).limit(10).toArray();
  const recentFailures = [];
  for (const step of failedSteps) {
    const run = await db.collection('runs').findOne({ _id: step.automation_run_id });
    if (!run) continue;
    const requestDoc = await db.collection('requests').findOne({ _id: run.site_request_id });
    recentFailures.push({
      step: step.step_name,
      fqdn: requestDoc?.fqdn,
      request_id: String(run.site_request_id),
      at: step.started_at,
    });
  }

  const enrichedRequests = await Promise.all(recentRequests.map(async (requestDoc) => {
    const user = requestDoc.requested_by_user_id
      ? await db.collection('users').findOne({ external_auth_id: requestDoc.requested_by_user_id }, { projection: { email: 1 } })
      : null;
    return { ...requestDoc, user_email: user?.email || requestDoc.requested_by_email || '' };
  }));

  res.json({ users, teams, hosts, domains, integrations, recentRequests: enrichedRequests, recentFailures });
}));

router.get('/domains', asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({
      domains: [
        { _id: 'd1', domain_name: 'example.com', cloudflare_zone_id: 'zone123', nginx_cert_profile: 'default', active: true, dns_target: 'example.com' },
      ],
    });
  }

  const db = getDb();
  const domains = await db.collection('domains').find({}).sort({ domain_name: 1 }).toArray();
  res.json({ domains });
}));

router.post('/domains/refresh', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ domains: [] });
  const db = getDb();
  const cloudflare = await db.collection('integrations').findOne({ provider: 'cloudflare', active: true });
  if (!cloudflare) return res.status(400).json({ message: 'Cloudflare integration is not configured.' });

  const domains = await upsertCloudflareDomains(db, cloudflare);
  await audit(db, req, 'update', 'domain', 'cloudflare-sync', 'Synced domains from Cloudflare');
  res.json({ domains });
}));

router.post('/domains', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ _id: 'new-' + Date.now(), ...req.body });
  const db = getDb();
  const doc = {
    ...normalizeDomainPayload(req.body),
    created_at: new Date(),
    updated_at: new Date(),
  };
  if (!doc.domain_name) {
    return res.status(400).json({ message: 'Domain name is required.' });
  }
  const { insertedId } = await db.collection('domains').insertOne(doc);
  await audit(db, req, 'create', 'domain', String(insertedId), `Added domain: ${doc.domain_name}`);
  res.status(201).json({ _id: insertedId, ...doc });
}));

router.patch('/domains/:id', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  await db.collection('domains').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { ...normalizeDomainPayload(req.body), updated_at: new Date() } }
  );
  await audit(db, req, 'update', 'domain', req.params.id, 'Updated domain');
  res.json({ ok: true });
}));

router.get('/domains/:id/records', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ records: [] });
  const db = getDb();
  const domainId = coerceObjectId(req.params.id);
  if (!domainId) return res.status(400).json({ message: 'Invalid domain id.' });

  const [domain, cloudflare, n8n] = await Promise.all([
    db.collection('domains').findOne({ _id: domainId }),
    db.collection('integrations').findOne({ provider: 'cloudflare', active: true }),
    db.collection('integrations').findOne({ provider: 'n8n', active: true }),
  ]);

  if (!domain) return res.status(404).json({ message: 'Domain not found.' });

  if (hasN8nCredentials(n8n || {})) {
    const records = await listN8nDnsRecords(n8n, domain.domain_name);
    return res.json({ records });
  }

  if (!cloudflare) return res.status(400).json({ message: 'Neither Cloudflare nor n8n integration is configured.' });
  if (!domain.cloudflare_zone_id?.trim()) {
    return res.status(400).json({ message: 'This domain does not have a Cloudflare zone ID yet. Import it from Cloudflare or set the zone ID first.' });
  }

  const records = await listCloudflareDnsRecords(cloudflare, domain.cloudflare_zone_id);
  res.json({ records });
}));

router.get('/domains/:id/access', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ grants: [] });
  const db = getDb();
  const grants = await loadAccessGrants(db, 'domain_access', 'domain_id', req.params.id);
  res.json({ grants });
}));

router.post('/domains/:id/access', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ _id: 'g-' + Date.now(), ...req.body });
  const db = getDb();
  const resolved = await resolvePrincipal(db, req.body.principal_type, req.body.principal_id);
  const existing = await db.collection('domain_access').findOne({
    domain_id: req.params.id,
    principal_type: req.body.principal_type,
    principal_id: resolved.principal_id,
  });
  if (existing) return res.json(existing);
  const doc = {
    domain_id: req.params.id,
    principal_type: req.body.principal_type,
    principal_id: resolved.principal_id,
    principal_label: resolved.principal_label,
    created_at: new Date(),
  };
  const { insertedId } = await db.collection('domain_access').insertOne(doc);
  await audit(db, req, 'grant', 'domain_access', req.params.id, `Granted ${req.body.principal_type} access`, doc);
  res.status(201).json({ _id: insertedId, ...doc });
}));

router.delete('/domains/:id/access/:grantId', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  await db.collection('domain_access').deleteOne({ _id: new ObjectId(req.params.grantId) });
  await audit(db, req, 'revoke', 'domain_access', req.params.id, 'Revoked domain access grant');
  res.json({ ok: true });
}));

router.get('/hosts', asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({ hosts: [{ _id: 'h1', name: 'web-prod-01', hostname: '10.0.1.10', ssh_port: 22, ssh_username: 'deploy', environment: 'production', active: true, has_managed_key: false }] });
  }
  const db = getDb();
  const hosts = await db.collection('hosts').find({}).sort({ name: 1 }).toArray();
  res.json({ hosts: hosts.map(sanitizeHostDoc) });
}));

router.post('/hosts', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ _id: 'new-' + Date.now(), ...req.body });
  const db = getDb();
  const result = await saveHost(db, req, null, req.body, { isCreate: true });
  res.status(201).json(result);
}));

router.patch('/hosts/:id', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  const result = await saveHost(db, req, req.params.id, req.body, { isCreate: false });
  res.json(result);
}));

router.post('/hosts/:id/test', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true, checks: [] });
  const db = getDb();
  const host = await db.collection('hosts').findOne({ _id: new ObjectId(req.params.id) });
  if (!host) return res.status(404).json({ message: 'Host not found' });
  if (!host.managed_ssh_private_key) {
    return res.status(400).json({ message: 'Managed SSH key is not installed yet. Edit the host and provide the SSH password first.' });
  }

  const result = await testHostReadiness(host);
  res.json({
    ok: result.ok,
    checks: result.checks,
    message: result.ok ? 'Host readiness checks passed.' : 'Host readiness checks failed.',
  });
}));

router.get('/hosts/:id/access', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ grants: [] });
  const db = getDb();
  const grants = await loadAccessGrants(db, 'host_access', 'host_id', req.params.id);
  res.json({ grants });
}));

router.post('/hosts/:id/access', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ _id: 'g-' + Date.now(), ...req.body });
  const db = getDb();
  const resolved = await resolvePrincipal(db, req.body.principal_type, req.body.principal_id);
  const existing = await db.collection('host_access').findOne({
    host_id: req.params.id,
    principal_type: req.body.principal_type,
    principal_id: resolved.principal_id,
  });
  if (existing) return res.json(existing);
  const doc = {
    host_id: req.params.id,
    principal_type: req.body.principal_type,
    principal_id: resolved.principal_id,
    principal_label: resolved.principal_label,
    created_at: new Date(),
  };
  const { insertedId } = await db.collection('host_access').insertOne(doc);
  await audit(db, req, 'grant', 'host_access', req.params.id, `Granted ${req.body.principal_type} host access`, doc);
  res.status(201).json({ _id: insertedId, ...doc });
}));

router.delete('/hosts/:id/access/:grantId', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  await db.collection('host_access').deleteOne({ _id: new ObjectId(req.params.grantId) });
  await audit(db, req, 'revoke', 'host_access', req.params.id, 'Revoked host access grant');
  res.json({ ok: true });
}));

router.get('/users', asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({ users: [{ _id: 'u1', display_name: 'Alice', email: 'alice@example.com', role: 'admin', status: 'active', groups: ['devops-admins'] }] });
  }
  const db = getDb();
  const adminGroup = process.env.ADMIN_GROUP;
  const users = await db.collection('users').find({}).sort({ created_at: -1 }).toArray();
  res.json({ users: users.map((user) => normalizeUserDoc(user, adminGroup)) });
}));

router.post('/users/:id/reset-tour', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  await db.collection('users').updateOne(
    { _id: req.params.id },
    { $unset: { tour_seen: '' } }
  );
  await audit(db, req, 'update', 'user', req.params.id, 'Reset onboarding tour');
  res.json({ ok: true });
}));

router.get('/principals', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ users: [], teams: [] });
  const db = getDb();
  const catalog = await getPrincipalCatalog(db);
  res.json(catalog);
}));

router.get('/teams', asyncHandler(async (req, res) => {
  if (!isConnected()) {
    return res.json({ teams: [{ _id: 't1', name: 'platform-team', description: 'Core platform team', member_ids: [], member_count: 0 }] });
  }
  const db = getDb();
  const adminGroup = process.env.ADMIN_GROUP;
  const [teams, users] = await Promise.all([
    db.collection('teams').find({}).sort({ name: 1 }).toArray(),
    db.collection('users').find({}).toArray(),
  ]);
  const byExternalId = new Map(users.map((user) => [user.external_auth_id, normalizeUserDoc(user, adminGroup)]));
  const enriched = teams.map((team) => ({
    ...team,
    member_ids: team.member_ids || [],
    member_count: team.member_ids?.length ?? 0,
    members: (team.member_ids || [])
      .map((memberId) => byExternalId.get(memberId))
      .filter(Boolean)
      .map((user) => ({
        id: user.external_auth_id,
        email: user.email,
        display_name: user.display_name,
      })),
  }));
  res.json({ teams: enriched });
}));

router.post('/teams', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ _id: 'new-' + Date.now(), ...req.body });
  const db = getDb();
  const doc = {
    name: req.body.name?.trim(),
    description: req.body.description?.trim() || '',
    member_ids: [...new Set((req.body.member_ids || []).filter(Boolean))],
    created_at: new Date(),
    updated_at: new Date(),
  };
  if (!doc.name) return res.status(400).json({ message: 'Team name is required.' });
  const { insertedId } = await db.collection('teams').insertOne(doc);
  await audit(db, req, 'create', 'team', String(insertedId), `Created team: ${doc.name}`);
  res.status(201).json({ _id: insertedId, ...doc });
}));

router.patch('/teams/:id', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  const patch = {
    updated_at: new Date(),
  };
  if ('name' in req.body) patch.name = req.body.name?.trim();
  if ('description' in req.body) patch.description = req.body.description?.trim() || '';
  if ('member_ids' in req.body) patch.member_ids = [...new Set((req.body.member_ids || []).filter(Boolean))];
  await db.collection('teams').updateOne({ _id: new ObjectId(req.params.id) }, { $set: patch });
  await audit(db, req, 'update', 'team', req.params.id, `Updated team`);
  res.json({ ok: true });
}));

router.delete('/teams/:id', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ ok: true });
  const db = getDb();
  await db.collection('teams').deleteOne({ _id: new ObjectId(req.params.id) });
  await audit(db, req, 'delete', 'team', req.params.id, 'Deleted team');
  res.json({ ok: true });
}));

router.get('/integrations', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ configs: {} });
  const db = getDb();
  const docs = await db.collection('integrations').find({}).toArray();
  const configs = {};
  docs.forEach((doc) => {
    configs[doc.provider] = sanitizeIntegrationDoc(doc);
  });
  res.json({ configs });
}));

router.post('/integrations/:provider', asyncHandler(async (req, res) => {
  const provider = req.params.provider;
  const db = isConnected() ? getDb() : null;
  const existing = db ? await db.collection('integrations').findOne({ provider }) : null;
  const secretFields = INTEGRATION_SECRET_FIELDS[provider] || [];
  const { _id, ...existingDoc } = existing || {};
  const { _id: requestId, ...requestBody } = req.body || {};

  const doc = {
    ...existingDoc,
    ...requestBody,
    provider,
    active: true,
    updated_at: new Date(),
  };

  secretFields.forEach((field) => {
    const next = requestBody[field];
    if (next == null || next === '' || next === MASKED_SECRET) {
      doc[field] = existing?.[field] || '';
    }
  });

  if (provider === 'nginx') {
    doc.base_url = normalizeNpmBaseUrl(doc);
    doc.host = doc.base_url;
  }

  if (db) {
    await db.collection('integrations').updateOne({ provider }, { $set: doc }, { upsert: true });
    await audit(db, req, 'update', 'integration', provider, `Configured ${provider}`);
  }

  res.json({ ok: true, config: sanitizeIntegrationDoc(doc) });
}));

router.post('/integrations/:provider/test', asyncHandler(async (req, res) => {
  const provider = req.params.provider;
  const db = isConnected() ? getDb() : null;
  const saved = db ? await db.collection('integrations').findOne({ provider }) : null;
  const secretFields = INTEGRATION_SECRET_FIELDS[provider] || [];
  const config = { ...(saved || {}), ...(req.body || {}) };

  secretFields.forEach((field) => {
    const next = req.body?.[field];
    if (next == null || next === '' || next === MASKED_SECRET) {
      config[field] = saved?.[field] || '';
    }
  });

  if (provider === 'nginx') {
    config.base_url = normalizeNpmBaseUrl(config);
    config.host = config.base_url;
  }

  if (provider === 'cloudflare') {
    return res.json(await verifyCloudflare(config));
  }

  if (provider === 'n8n') {
    return res.json(await verifyN8n(config));
  }

  if (provider === 'nginx') {
    return res.json(await verifyNpm(config));
  }

  res.json({ ok: false, message: `${provider} connection test is not implemented.` });
}));

router.get('/integrations/cloudflare/zones', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ zones: [] });
  const db = getDb();
  const cloudflare = await db.collection('integrations').findOne({ provider: 'cloudflare', active: true });
  if (!cloudflare) {
    return res.status(400).json({ message: 'Save an active Cloudflare integration before syncing domains.' });
  }

  const [zones, existingDomains] = await Promise.all([
    listCloudflareZones(cloudflare),
    db.collection('domains').find({}).project({ domain_name: 1, cloudflare_zone_id: 1, dns_target: 1, active: 1 }).toArray(),
  ]);

  const domainsByZoneId = new Map(existingDomains.filter((domain) => domain.cloudflare_zone_id).map((domain) => [domain.cloudflare_zone_id, domain]));
  const domainsByName = new Map(existingDomains.filter((domain) => domain.domain_name).map((domain) => [domain.domain_name.toLowerCase(), domain]));

  const normalizedZones = zones
    .map((zone) => {
      const existing = domainsByZoneId.get(zone.id) || domainsByName.get((zone.name || '').toLowerCase());
      return {
        id: zone.id,
        name: zone.name,
        status: zone.status || '',
        paused: Boolean(zone.paused),
        type: zone.type || '',
        account_name: zone.account?.name || '',
        name_servers: zone.name_servers || [],
        already_added: Boolean(existing),
        domain_id: existing ? String(existing._id) : '',
        current_zone_id: existing?.cloudflare_zone_id || '',
        current_dns_target: existing?.dns_target || '',
        current_active: existing?.active ?? null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  res.json({ zones: normalizedZones });
}));

router.post('/integrations/cloudflare/import', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ domains: [], imported_count: 0 });
  const db = getDb();
  const cloudflare = await db.collection('integrations').findOne({ provider: 'cloudflare', active: true });
  if (!cloudflare) {
    return res.status(400).json({ message: 'Cloudflare integration is not configured.' });
  }

  const zoneIds = [...new Set((req.body?.zone_ids || []).map((zoneId) => String(zoneId || '').trim()).filter(Boolean))];
  if (!zoneIds.length) {
    return res.status(400).json({ message: 'Select at least one Cloudflare domain to import.' });
  }

  const zones = await listCloudflareZones(cloudflare);
  const availableById = new Map(zones.map((zone) => [zone.id, zone]));
  const selectedZones = zoneIds.map((zoneId) => availableById.get(zoneId)).filter(Boolean);
  const missingZoneIds = zoneIds.filter((zoneId) => !availableById.has(zoneId));

  if (missingZoneIds.length) {
    return res.status(400).json({ message: `Cloudflare did not return ${missingZoneIds.length} selected zone${missingZoneIds.length === 1 ? '' : 's'}. Refresh the zone list and try again.` });
  }

  const domains = await upsertCloudflareZones(db, selectedZones);
  await audit(
    db,
    req,
    'update',
    'domain',
    'cloudflare-import',
    `Imported ${domains.length} domain${domains.length === 1 ? '' : 's'} from Cloudflare`,
    { zone_ids: zoneIds }
  );

  res.json({ domains, imported_count: domains.length });
}));

router.get('/integrations/n8n/zones', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ zones: [] });
  const db = getDb();
  const n8n = await db.collection('integrations').findOne({ provider: 'n8n', active: true });
  if (!n8n) {
    return res.status(400).json({ message: 'Save an active n8n integration before syncing domains.' });
  }

  const [zones, existingDomains] = await Promise.all([
    listN8nZones(n8n),
    db.collection('domains').find({}).project({ domain_name: 1, cloudflare_zone_id: 1, dns_target: 1, active: 1 }).toArray(),
  ]);

  const domainsByZoneId = new Map(existingDomains.filter((d) => d.cloudflare_zone_id).map((d) => [d.cloudflare_zone_id, d]));
  const domainsByName = new Map(existingDomains.filter((d) => d.domain_name).map((d) => [d.domain_name.toLowerCase(), d]));

  const normalizedZones = zones
    .map((zone) => {
      const existing = domainsByZoneId.get(zone.id) || domainsByName.get((zone.name || '').toLowerCase());
      return {
        id: zone.id,
        name: zone.name,
        status: zone.status || '',
        paused: Boolean(zone.paused),
        type: zone.type || '',
        account_name: '',
        name_servers: [],
        already_added: Boolean(existing),
        domain_id: existing ? String(existing._id) : '',
        current_zone_id: existing?.cloudflare_zone_id || '',
        current_dns_target: existing?.dns_target || '',
        current_active: existing?.active ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ zones: normalizedZones });
}));

router.post('/integrations/n8n/import', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ domains: [], imported_count: 0 });
  const db = getDb();
  const n8n = await db.collection('integrations').findOne({ provider: 'n8n', active: true });
  if (!n8n) {
    return res.status(400).json({ message: 'n8n integration is not configured.' });
  }

  const zoneIds = [...new Set((req.body?.zone_ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!zoneIds.length) {
    return res.status(400).json({ message: 'Select at least one domain to import.' });
  }

  const zones = await listN8nZones(n8n);
  const availableById = new Map(zones.map((zone) => [zone.id, zone]));
  const selectedZones = zoneIds.map((id) => availableById.get(id)).filter(Boolean);
  const missingIds = zoneIds.filter((id) => !availableById.has(id));

  if (missingIds.length) {
    return res.status(400).json({ message: `n8n did not return ${missingIds.length} selected zone${missingIds.length === 1 ? '' : 's'}. Refresh and try again.` });
  }

  const domains = await upsertCloudflareZones(db, selectedZones);
  await audit(db, req, 'update', 'domain', 'n8n-import', `Imported ${domains.length} domain${domains.length === 1 ? '' : 's'} from n8n`, { zone_ids: zoneIds });

  res.json({ domains, imported_count: domains.length });
}));

router.get('/runs', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ runs: [] });
  const db = getDb();
  const runs = await db.collection('runs').find({}).sort({ started_at: -1 }).limit(200).toArray();

  const enriched = await Promise.all(runs.map(async (run) => {
    const requestDoc = await db.collection('requests').findOne(
      { _id: run.site_request_id },
      { projection: { fqdn: 1, requested_by_user_id: 1 } }
    );
    const user = requestDoc?.requested_by_user_id
      ? await db.collection('users').findOne({ external_auth_id: requestDoc.requested_by_user_id }, { projection: { email: 1 } })
      : null;
    const steps = await db.collection('steps').find({ automation_run_id: run._id }, { projection: { status: 1 } }).toArray();
    return {
      ...run,
      fqdn: requestDoc?.fqdn,
      initiated_by_email: user?.email,
      success_count: steps.filter((step) => step.status === 'success').length,
      fail_count: steps.filter((step) => step.status === 'failed').length,
    };
  }));

  res.json({ runs: enriched });
}));

router.get('/audit', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.json({ logs: [] });
  const db = getDb();
  const logs = await db.collection('audit').find({}).sort({ created_at: -1 }).limit(500).toArray();
  res.json({ logs });
}));

// DB export — dumps all collections as JSON
const EXPORT_COLLECTIONS = ['users', 'requests', 'runs', 'steps', 'audit', 'site', 'integrations', 'auth_providers', 'onboarding'];

router.get('/db/export', asyncHandler(async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  const db = getDb();
  const snapshot = {};
  for (const name of EXPORT_COLLECTIONS) {
    snapshot[name] = await db.collection(name).find({}).toArray();
  }
  const json = JSON.stringify(snapshot, null, 2);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="devops-platform-backup-${Date.now()}.json"`);
  res.send(json);
}));

// DB import — restores collections from uploaded JSON backup
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/db/import', upload.single('backup'), asyncHandler(async (req, res) => {
  if (!isConnected()) return res.status(503).json({ message: 'Database not connected' });
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  let snapshot;
  try {
    snapshot = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid JSON file' });
  }
  const db = getDb();
  const results = {};
  for (const [name, docs] of Object.entries(snapshot)) {
    if (!Array.isArray(docs)) continue;
    if (!EXPORT_COLLECTIONS.includes(name)) continue;
    await db.collection(name).deleteMany({});
    if (docs.length > 0) await db.collection(name).insertMany(docs);
    results[name] = docs.length;
  }
  res.json({ ok: true, collections: results });
}));

// ── Database connection string (managed in-app, persisted to /data) ───────────
// All three backend services read MONGO_URI at startup, so a change is applied
// by writing the file and restarting the add-on via the Supervisor API.
const DB_CONFIG_PATH = '/data/db-config.json';

function isValidMongoUri(uri) {
  return typeof uri === 'string' && /^mongodb(\+srv)?:\/\/.+/.test(uri.trim());
}

// Hide the password in the userinfo section before returning a URI to the client.
function maskMongoUri(uri) {
  return String(uri).replace(/(\/\/[^:/@]+:)[^@]*@/, '$1***@');
}

function readDbConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(DB_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function testMongoUri(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    return { ok: true, message: 'Connected successfully.' };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    await client.close().catch(() => {});
  }
}

function scheduleSelfRestart() {
  // Delay so the HTTP response is flushed before the container goes down.
  setTimeout(async () => {
    try {
      const token = process.env.SUPERVISOR_TOKEN;
      const res = await fetch('http://supervisor/addons/self/restart', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) console.error('[admin] self-restart returned', res.status);
    } catch (err) {
      console.error('[admin] self-restart failed:', err.message);
    }
  }, 750);
}

router.get('/db/config', asyncHandler(async (req, res) => {
  const cfg = readDbConfigFile();
  const uri = cfg?.uri || '';
  res.json({
    source: uri ? 'external' : 'bundled',
    uri: uri ? maskMongoUri(uri) : '',
    connected: isConnected(),
    updated_at: cfg?.updated_at || null,
  });
}));

router.post('/db/config/test', asyncHandler(async (req, res) => {
  const uri = String(req.body?.uri || '').trim();
  if (!isValidMongoUri(uri)) {
    return res.status(400).json({ ok: false, message: 'Enter a valid mongodb:// or mongodb+srv:// connection string.' });
  }
  res.json(await testMongoUri(uri));
}));

router.post('/db/config', asyncHandler(async (req, res) => {
  const uri = String(req.body?.uri || '').trim();
  if (!isValidMongoUri(uri)) {
    return res.status(400).json({ ok: false, message: 'Enter a valid mongodb:// or mongodb+srv:// connection string.' });
  }
  const test = await testMongoUri(uri);
  if (!test.ok) {
    return res.status(400).json({ ok: false, message: `Connection test failed: ${test.message}` });
  }
  fs.writeFileSync(DB_CONFIG_PATH, JSON.stringify({ uri, updated_at: new Date().toISOString() }, null, 2));
  if (isConnected()) {
    await audit(getDb(), req, 'update', 'database', 'connection', 'Changed database connection string');
  }
  scheduleSelfRestart();
  res.json({ ok: true, restarting: true, message: 'Connection saved and verified. The add-on is restarting to apply the change.' });
}));

router.delete('/db/config', asyncHandler(async (req, res) => {
  try { fs.unlinkSync(DB_CONFIG_PATH); } catch { /* already absent */ }
  if (isConnected()) {
    await audit(getDb(), req, 'update', 'database', 'connection', 'Reverted to the bundled database');
  }
  scheduleSelfRestart();
  res.json({ ok: true, restarting: true, message: 'Reverted to the bundled database. The add-on is restarting.' });
}));

export default router;
