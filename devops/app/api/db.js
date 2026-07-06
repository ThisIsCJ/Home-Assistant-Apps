import { MongoClient } from 'mongodb';

let client = null;
let db     = null;

export async function connect() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.warn('[db] MONGO_URI not set — running without database'); return; }
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
    console.log('[db] connected');
    await ensureIndexes();
  } catch (e) {
    console.error('[db] connection failed:', e.message);
    db = null;
  }
}

export async function disconnect() {
  await client?.close();
}

export function getDb() { return db; }
export function isConnected() { return db !== null; }

async function ensureIndexes() {
  if (!db) return;
  await db.collection('users').createIndex({ external_auth_id: 1 }, { unique: true, sparse: true });
}
