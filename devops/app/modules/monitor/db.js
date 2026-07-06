import { MongoClient } from 'mongodb';

let client = null;
let db     = null;

export async function connect() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.warn('[monitor-db] MONGO_URI not set — running without database'); return; }
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
    console.log('[monitor-db] connected');
    await ensureIndexes();
  } catch (e) {
    console.error('[monitor-db] connection failed:', e.message);
    db = null;
  }
}

export function getDb()       { return db; }
export function isConnected() { return db !== null; }

async function ensureIndexes() {
  if (!db) return;
  await db.collection('monitor_results').createIndex({ ts: 1 }, { expireAfterSeconds: 604_800 });
  await db.collection('monitor_results').createIndex({ request_id: 1, check_type: 1, ts: -1 });
  await db.collection('monitor_hourly').createIndex({ bucket: 1 }, { expireAfterSeconds: 2_592_000 });
  await db.collection('monitor_hourly').createIndex({ request_id: 1, check_type: 1, bucket: 1 });
  await db.collection('monitor_weekly').createIndex({ bucket: 1 }, { expireAfterSeconds: 31_536_000 });
  await db.collection('monitor_weekly').createIndex({ request_id: 1, check_type: 1, bucket: 1 });
  await db.collection('webhooks').createIndex({ enabled: 1 });
}
