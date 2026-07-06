import { ObjectId } from 'mongodb';
import { getDb, isConnected } from '../db.js';
import { checkUrl, checkPort, checkHost } from './monitor.js';

const DEFAULT_INTERVAL_S = 300; // 5 minutes
const lastCheck = {}; // request_id -> timestamp ms

let schedulerTimer = null;
let rollupTimer = null;

export function startScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(tick, 60_000);
  rollupTimer    = setInterval(rollup, 5 * 60_000);
  console.log('[monitor] scheduler started');
}

async function tick() {
  if (!isConnected()) return;
  const db = getDb();
  try {
    const globalCfg = (await db.collection('monitor_config').findOne({ _id: 'global' })) || {};
    const enabled = await db.collection('monitor_config')
      .find({ _id: { $ne: 'global' }, monitoring_enabled: true })
      .toArray();

    const now = Date.now();
    const due = enabled.filter(c => {
      const interval = (c.interval_seconds || globalCfg.interval_seconds || DEFAULT_INTERVAL_S) * 1000;
      return now - (Number(c.last_check_ts) || lastCheck[c._id] || 0) >= interval;
    });

    const BATCH = 10;
    for (let i = 0; i < due.length; i += BATCH) {
      await Promise.all(due.slice(i, i + BATCH).map(c => checkSite(db, c, globalCfg)));
    }
  } catch (err) {
    console.error('[monitor] tick:', err.message);
  }
}

export async function checkSiteById(requestId) {
  if (!isConnected()) return;
  const db = getDb();
  const globalCfg = (await db.collection('monitor_config').findOne({ _id: 'global' })) || {};
  const config = (await db.collection('monitor_config').findOne({ _id: requestId })) || { _id: requestId };
  await checkSite(db, config, globalCfg);
}

async function checkSite(db, config, globalCfg) {
  const id = config._id;
  lastCheck[id] = Date.now();
  // Persisted so a service restart doesn't re-check every site at once
  db.collection('monitor_config').updateOne(
    { _id: id },
    { $set: { last_check_ts: lastCheck[id] } },
    { upsert: true }
  ).catch(() => {});

  const activeFilter = { status: { $in: ['success', 'partial_success'] } };
  let site = null;
  try { site = await db.collection('requests').findOne({ _id: new ObjectId(id), ...activeFilter }); } catch {}
  if (!site) {
    try { site = await db.collection('requests').findOne({ _id: id, ...activeFilter }); } catch {}
  }
  if (!site) return;

  const ts = new Date();
  const results = {};

  if (config.check_url !== false && site.fqdn) {
    const r = await checkUrl(site.fqdn);
    results.url = r;
    await db.collection('monitor_results').insertOne({ request_id: id, check_type: 'url', ts, ...r });
  }

  if (config.check_port !== false && site.host_port) {
    let hostname = site.host_name;
    if (site.host_id) {
      try {
        const host = await db.collection('hosts').findOne({ _id: new ObjectId(String(site.host_id)) });
        if (host?.hostname) hostname = host.hostname;
      } catch {}
    }
    if (hostname) {
      const r = await checkPort(hostname, site.host_port);
      results.port = r;
      await db.collection('monitor_results').insertOne({ request_id: id, check_type: 'port', ts, ...r });
    }
  }

  if (config.check_host !== false && site.host_id) {
    let host = null;
    try { host = await db.collection('hosts').findOne({ _id: new ObjectId(String(site.host_id)) }); } catch {}
    if (host) {
      const r = await checkHost(host);
      results.host = r;
      await db.collection('monitor_results').insertOne({ request_id: id, check_type: 'host', ts, ...r });
    }
  }

  await handleAlerts(db, config, globalCfg, site, results, ts);
}

async function handleAlerts(db, config, globalCfg, site, results, ts) {
  const threshold = config.alert_threshold ?? globalCfg.alert_threshold ?? 3;

  const allWebhooks = await db.collection('webhooks').find({ enabled: true }).toArray();
  if (!allWebhooks.length) return;

  for (const [type, result] of Object.entries(results)) {
    const failKey = `cf_${type}`;
    let eventType = null;
    let payload   = null;

    if (!result.ok) {
      const updated = await db.collection('monitor_config').findOneAndUpdate(
        { _id: config._id },
        { $inc: { [failKey]: 1 }, $setOnInsert: { _id: config._id } },
        { upsert: true, returnDocument: 'after' }
      );
      const fails = updated?.[failKey] || 1;
      if (fails >= threshold) {
        await db.collection('monitor_config').updateOne({ _id: config._id }, { $set: { [failKey]: 0 } });
        eventType = 'alert';
        payload = { event: 'alert', request_id: config._id, fqdn: site?.fqdn, check_type: type, consecutive_failures: fails, ts: ts.toISOString() };
      }
    } else {
      const doc = await db.collection('monitor_config').findOne({ _id: config._id });
      if ((doc?.[failKey] || 0) > 0) {
        await db.collection('monitor_config').updateOne({ _id: config._id }, { $set: { [failKey]: 0 } });
        eventType = 'recovery';
        payload = { event: 'recovery', request_id: config._id, fqdn: site?.fqdn, check_type: type, ts: ts.toISOString() };
      }
    }

    if (!eventType) continue;

    for (const wh of allWebhooks) {
      if (!wh.events?.includes(eventType)) continue;
      const sc = wh.scope || { type: 'all' };
      let match = false;
      switch (sc.type) {
        case 'all':    match = true; break;
        case 'site':   match = sc.value === config._id; break;
        case 'domain': match = Boolean(site?.fqdn && (site.fqdn === sc.value || site.fqdn.endsWith('.' + sc.value))); break;
        case 'host':   match = Boolean(site?.host_id && String(site.host_id) === sc.value); break;
        case 'user':   match = site?.requested_by_user_id === sc.value; break;
        case 'team': {
          try {
            const team = await db.collection('teams').findOne({ _id: new ObjectId(sc.value) });
            match = Boolean(team?.member_ids?.includes(site?.requested_by_user_id));
          } catch {}
          break;
        }
      }
      if (match) sendWebhook(wh.url, payload);
    }
  }
}

function sendWebhook(url, payload) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(err => console.error('[monitor] webhook:', err.message));
}

async function rollup() {
  if (!isConnected()) return;
  const db = getDb();
  try {
    await rollupHourly(db);
    await rollupWeekly(db);
  } catch (err) {
    console.error('[monitor] rollup:', err.message);
  }
}

async function rollupHourly(db) {
  const since = new Date(Date.now() - 25 * 3_600_000);
  const buckets = await db.collection('monitor_results').aggregate([
    { $match: { ts: { $gte: since } } },
    {
      $group: {
        _id: {
          request_id: '$request_id',
          check_type: '$check_type',
          bucket: {
            $toDate: {
              $multiply: [{ $floor: { $divide: [{ $toLong: '$ts' }, 3_600_000] } }, 3_600_000]
            }
          }
        },
        checks:       { $sum: 1 },
        ok_count:     { $sum: { $cond: ['$ok', 1, 0] } },
        avg_latency:  { $avg: '$latency_ms' },
        avg_ssl_days: { $avg: '$ssl_days_remaining' },
        avg_cpu:      { $avg: '$cpu_pct' },
        avg_mem:      { $avg: '$mem_pct' },
        avg_disk:     { $avg: '$disk_pct' },
      }
    }
  ]).toArray();

  for (const b of buckets) {
    await db.collection('monitor_hourly').updateOne(
      { request_id: b._id.request_id, check_type: b._id.check_type, bucket: b._id.bucket },
      {
        $set: {
          checks:       b.checks,
          ok_count:     b.ok_count,
          uptime_pct:   Math.round((b.ok_count / b.checks) * 100),
          avg_latency:  b.avg_latency  != null ? Math.round(b.avg_latency)  : null,
          avg_ssl_days: b.avg_ssl_days != null ? Math.round(b.avg_ssl_days) : null,
          avg_cpu:      b.avg_cpu      != null ? Math.round(b.avg_cpu)      : null,
          avg_mem:      b.avg_mem      != null ? Math.round(b.avg_mem)      : null,
          avg_disk:     b.avg_disk     != null ? Math.round(b.avg_disk)     : null,
        }
      },
      { upsert: true }
    );
  }
}

async function rollupWeekly(db) {
  const dayStart = new Date(Date.now() - 25 * 3_600_000);
  const dayEnd   = new Date(Date.now() - 23 * 3_600_000);

  const buckets = await db.collection('monitor_hourly').aggregate([
    { $match: { bucket: { $gte: dayStart, $lt: dayEnd } } },
    {
      $group: {
        _id: {
          request_id: '$request_id',
          check_type: '$check_type',
          bucket: {
            $toDate: {
              $multiply: [{ $floor: { $divide: [{ $toLong: '$bucket' }, 604_800_000] } }, 604_800_000]
            }
          }
        },
        checks:       { $sum: '$checks' },
        ok_count:     { $sum: '$ok_count' },
        avg_latency:  { $avg: '$avg_latency' },
        avg_ssl_days: { $avg: '$avg_ssl_days' },
        avg_cpu:      { $avg: '$avg_cpu' },
        avg_mem:      { $avg: '$avg_mem' },
        avg_disk:     { $avg: '$avg_disk' },
      }
    }
  ]).toArray();

  for (const b of buckets) {
    await db.collection('monitor_weekly').updateOne(
      { request_id: b._id.request_id, check_type: b._id.check_type, bucket: b._id.bucket },
      {
        $set: {
          checks:       b.checks,
          ok_count:     b.ok_count,
          uptime_pct:   b.checks ? Math.round((b.ok_count / b.checks) * 100) : null,
          avg_latency:  b.avg_latency  != null ? Math.round(b.avg_latency)  : null,
          avg_ssl_days: b.avg_ssl_days != null ? Math.round(b.avg_ssl_days) : null,
          avg_cpu:      b.avg_cpu      != null ? Math.round(b.avg_cpu)      : null,
          avg_mem:      b.avg_mem      != null ? Math.round(b.avg_mem)      : null,
          avg_disk:     b.avg_disk     != null ? Math.round(b.avg_disk)     : null,
        }
      },
      { upsert: true }
    );
  }
}
