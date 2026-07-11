import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { getDb, isConnected } from '../db.js';
import { importArchive } from './transfer.js';

// Recipe Sync — pull recipes from one cookbook instance into another, on demand
// or on a schedule. It builds on export/import: a sync is an authenticated
// `export` on the source (GET /sync/pull) followed by a sync-mode `import` on
// the destination. See ../../RECIPE_SYNC.md for the full picture.
//
// Two independent directions share one config document:
//   inbound  — sync links (secrets) that let peers pull FROM this instance.
//   outbound — remote sources this instance pulls, each with its own schedule.

const COLLECTION = 'cookbookSync';
const CONFIG_ID = 'config';
const TICK_MS = 60_000;

// Ownerless synced recipes are attributed to this synthetic user so admins can
// still edit them (see reviveRecipe in transfer.js).
const SYNC_USER = { id: 'recipe-sync', name: 'Recipe Sync' };

// Per-source in-memory lock so a slow run can't overlap its own next tick.
const running = new Set();
let schedulerTimer = null;

// --- Config document -------------------------------------------------------

async function loadRaw() {
  if (!isConnected()) return { _id: CONFIG_ID, inbound: [], outbound: [] };
  const doc = await getDb().collection(COLLECTION).findOne({ _id: CONFIG_ID });
  return {
    _id: CONFIG_ID,
    inbound: Array.isArray(doc?.inbound) ? doc.inbound : [],
    outbound: Array.isArray(doc?.outbound) ? doc.outbound : [],
  };
}

async function saveRaw(config) {
  await getDb().collection(COLLECTION).updateOne(
    { _id: CONFIG_ID },
    { $set: { inbound: config.inbound, outbound: config.outbound, updatedAt: new Date() } },
    { upsert: true }
  );
}

// The full config as returned to admins (includes plaintext secrets — the admin
// needs to read them back to paste into peers, so /sync is admin-only).
export async function getSyncConfig() {
  const config = await loadRaw();
  return {
    inbound: config.inbound.map((t) => ({
      id: t.id,
      label: t.label || '',
      secret: t.secret,
      createdAt: t.createdAt || null,
      lastUsedAt: t.lastUsedAt || null,
    })),
    outbound: config.outbound.map(publicOutbound),
  };
}

function publicOutbound(s) {
  return {
    id: s.id,
    label: s.label || '',
    url: s.url || '',
    secret: s.secret || '',
    enabled: s.enabled !== false,
    schedule: normalizeSchedule(s.schedule),
    lastRunAt: s.lastRunAt || null,
    lastStatus: s.lastStatus || null,
    lastMessage: s.lastMessage || '',
    lastRecipes: s.lastRecipes ?? null,
    lastImages: s.lastImages ?? null,
    nextRunAt: s.nextRunAt || null,
  };
}

// --- Inbound (sync links others pull from) ---------------------------------

export async function createInbound(label) {
  const config = await loadRaw();
  const token = {
    id: randomUUID(),
    label: `${label || ''}`.trim() || 'Sync link',
    secret: newSecret(),
    createdAt: new Date(),
    lastUsedAt: null,
  };
  config.inbound.push(token);
  await saveRaw(config);
  return token;
}

export async function deleteInbound(id) {
  const config = await loadRaw();
  const before = config.inbound.length;
  config.inbound = config.inbound.filter((t) => t.id !== id);
  if (config.inbound.length === before) return false;
  await saveRaw(config);
  return true;
}

// Match a presented secret against every inbound link in constant time. On a
// hit, stamp lastUsedAt (best effort) and return the token; otherwise null.
export async function verifyInboundSecret(presented) {
  const secret = `${presented || ''}`;
  if (!secret) return null;

  const config = await loadRaw();
  let match = null;
  for (const token of config.inbound) {
    if (constantTimeEqual(secret, token.secret)) match = token;
  }
  if (!match) return null;

  getDb().collection(COLLECTION).updateOne(
    { _id: CONFIG_ID, 'inbound.id': match.id },
    { $set: { 'inbound.$.lastUsedAt': new Date() } }
  ).catch(() => {});
  return match;
}

// Express middleware for GET /sync/pull. Reads the shared secret from the
// X-Sync-Secret header or a ?secret= query param.
export async function requireSyncSecret(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  const presented = req.get('X-Sync-Secret') || req.query.secret || '';
  try {
    const token = await verifyInboundSecret(presented);
    if (!token) return res.status(401).json({ error: 'Invalid or missing sync secret' });
    req.syncToken = token;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Outbound (remote sources this instance pulls) -------------------------

export async function createOutbound(input) {
  const config = await loadRaw();
  const source = normalizeOutbound({ ...input, id: randomUUID() });
  source.nextRunAt = computeNextRun(source.schedule);
  config.outbound.push(source);
  await saveRaw(config);
  return publicOutbound(source);
}

export async function updateOutbound(id, input) {
  const config = await loadRaw();
  const index = config.outbound.findIndex((s) => s.id === id);
  if (index === -1) return null;

  const prev = config.outbound[index];
  const next = normalizeOutbound({ ...prev, ...input, id });
  // Carry status forward; recompute the next run against the new schedule.
  next.lastRunAt = prev.lastRunAt || null;
  next.lastStatus = prev.lastStatus || null;
  next.lastMessage = prev.lastMessage || '';
  next.lastRecipes = prev.lastRecipes ?? null;
  next.lastImages = prev.lastImages ?? null;
  next.nextRunAt = computeNextRun(next.schedule);

  config.outbound[index] = next;
  await saveRaw(config);
  return publicOutbound(next);
}

export async function deleteOutbound(id) {
  const config = await loadRaw();
  const before = config.outbound.length;
  config.outbound = config.outbound.filter((s) => s.id !== id);
  if (config.outbound.length === before) return false;
  await saveRaw(config);
  return true;
}

function normalizeOutbound(input) {
  return {
    id: input.id,
    label: `${input.label || ''}`.trim() || 'Sync source',
    url: `${input.url || ''}`.trim(),
    secret: `${input.secret || ''}`.trim(),
    enabled: input.enabled !== false,
    schedule: normalizeSchedule(input.schedule),
  };
}

// --- Running a sync --------------------------------------------------------

// Fetch a peer's pull URL and merge the archive in sync mode. Throws on any
// network/HTTP/import failure. Returns { recipes, images } counts.
export async function runOutboundSource(source) {
  if (!source?.url) throw new Error('Source has no pull URL');
  const res = await fetch(source.url, { headers: { 'X-Sync-Secret': source.secret || '' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pull failed (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return importArchive(buffer, SYNC_USER, { mode: 'sync' });
}

// Run one source by id, persisting status + next run. `manual` marks a run
// triggered from "Sync now" vs. the scheduler (only affects the message).
export async function runOutboundById(id, { manual = false } = {}) {
  if (running.has(id)) {
    return { ok: false, status: 'running', message: 'A sync is already running for this source.' };
  }
  running.add(id);
  try {
    const config = await loadRaw();
    const index = config.outbound.findIndex((s) => s.id === id);
    if (index === -1) return { ok: false, status: 'error', message: 'Source not found.' };

    const source = config.outbound[index];
    const now = new Date();
    const patch = { lastRunAt: now, nextRunAt: computeNextRun(source.schedule, now) };

    try {
      const { recipes, images } = await runOutboundSource(source);
      patch.lastStatus = 'ok';
      patch.lastMessage = `Synced ${recipes} recipe(s), ${images} image(s)`;
      patch.lastRecipes = recipes;
      patch.lastImages = images;
    } catch (err) {
      patch.lastStatus = 'error';
      patch.lastMessage = err.message || 'Sync failed';
    }

    // Re-load before writing so a concurrent config edit isn't clobbered.
    const fresh = await loadRaw();
    const target = fresh.outbound.find((s) => s.id === id);
    if (target) {
      Object.assign(target, patch);
      await saveRaw(fresh);
    }

    return {
      ok: patch.lastStatus === 'ok',
      status: patch.lastStatus,
      message: patch.lastMessage,
      recipes: patch.lastRecipes ?? null,
      images: patch.lastImages ?? null,
      manual,
    };
  } finally {
    running.delete(id);
  }
}

// --- Scheduler -------------------------------------------------------------

// In-process scheduler: ticks every 60s and runs any enabled, non-manual source
// whose nextRunAt is due. It only advances while the container is up; a run
// missed while down is not fired retroactively — the next future occurrence is
// scheduled on the following tick.
export function startSyncScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
}

export function stopSyncScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

async function tick() {
  if (!isConnected()) return;
  const config = await loadRaw();
  const now = Date.now();
  let dirty = false;

  for (const source of config.outbound) {
    if (source.enabled === false) continue;
    const schedule = normalizeSchedule(source.schedule);
    if (schedule.frequency === 'manual') continue;

    // Backfill a missing next run without firing retroactively.
    if (!source.nextRunAt) {
      source.nextRunAt = computeNextRun(schedule, new Date(now));
      dirty = true;
      continue;
    }
    if (running.has(source.id)) continue;
    if (new Date(source.nextRunAt).getTime() > now) continue;

    // Fire and forget — runOutboundById persists its own status.
    runOutboundById(source.id).catch(() => {});
  }

  if (dirty) await saveRaw(config).catch(() => {});
}

// --- Schedule math ---------------------------------------------------------

export function normalizeSchedule(input) {
  const frequency = input?.frequency;
  if (frequency === 'hours') {
    return { frequency: 'hours', interval: clampInt(input.interval, 1, 8760, 6) };
  }
  if (frequency === 'days') {
    return { frequency: 'days', interval: clampInt(input.interval, 1, 365, 1), time: normalizeTime(input.time) };
  }
  if (frequency === 'weeks') {
    return { frequency: 'weeks', dayOfWeek: clampInt(input.dayOfWeek, 0, 6, 1), time: normalizeTime(input.time) };
  }
  if (frequency === 'months') {
    return { frequency: 'months', dayOfMonth: clampInt(input.dayOfMonth, 1, 31, 1), time: normalizeTime(input.time) };
  }
  return { frequency: 'manual' };
}

// The next moment strictly after `from` that matches the schedule (server-local
// timezone), or null for a manual schedule.
export function computeNextRun(schedule, from = new Date()) {
  const s = normalizeSchedule(schedule);
  const now = new Date(from.getTime());

  if (s.frequency === 'manual') return null;

  if (s.frequency === 'hours') {
    return new Date(now.getTime() + s.interval * 3600_000);
  }

  const [hh, mm] = s.time.split(':').map(Number);

  if (s.frequency === 'days') {
    const c = new Date(now);
    c.setHours(hh, mm, 0, 0);
    while (c <= now) c.setDate(c.getDate() + s.interval);
    return c;
  }

  if (s.frequency === 'weeks') {
    const c = new Date(now);
    c.setHours(hh, mm, 0, 0);
    for (let i = 0; i < 8; i += 1) {
      if (c.getDay() === s.dayOfWeek && c > now) return c;
      c.setDate(c.getDate() + 1);
    }
    return c;
  }

  // months
  for (let i = 0; i < 60; i += 1) {
    const year = now.getFullYear();
    const month = now.getMonth() + i;
    const daysInMonth = new Date(year, month + 1, 0).getDate(); // clamp to short months
    const day = Math.min(s.dayOfMonth, daysInMonth);
    const cand = new Date(year, month, day, hh, mm, 0, 0);
    if (cand > now) return cand;
  }
  return null;
}

// --- Small helpers ---------------------------------------------------------

function newSecret() {
  return `sync_${randomBytes(24).toString('hex')}`;
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(`${a}`);
  const bufB = Buffer.from(`${b}`);
  // timingSafeEqual requires equal lengths; hash first so a length mismatch
  // doesn't leak and the comparison stays constant-time.
  const hashA = createHash('sha256').update(bufA).digest();
  const hashB = createHash('sha256').update(bufB).digest();
  return timingSafeEqual(hashA, hashB);
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(`${value || ''}`.trim());
  if (!match) return '03:00';
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
