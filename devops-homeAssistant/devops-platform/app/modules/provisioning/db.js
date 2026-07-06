import { MongoClient } from 'mongodb';

let client = null;
let db     = null;

export async function connect() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.warn('[provisioning-db] MONGO_URI not set — running without database'); return; }
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
    console.log('[provisioning-db] connected');
    await ensureIndexes();
  } catch (e) {
    console.error('[provisioning-db] connection failed:', e.message);
    db = null;
  }
}

export function getDb()       { return db; }
export function isConnected() { return db !== null; }

async function ensureIndexes() {
  if (!db) return;
  await db.collection('users').createIndex({ external_auth_id: 1 }, { unique: true, sparse: true });
  await db.collection('requests').createIndex({ requested_by_user_id: 1, created_at: -1 });
  await db.collection('runs').createIndex({ site_request_id: 1 });
  await db.collection('steps').createIndex({ automation_run_id: 1, step_order: 1 });
  await db.collection('audit').createIndex({ created_at: -1 });
}
