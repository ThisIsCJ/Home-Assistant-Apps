import { MongoClient } from 'mongodb';
import { getMongoUri, getMongoDb } from './config.js';

let client = null;
let db = null;
let connectionError = null;

export async function connect(uri, dbName) {
  if (client) {
    await client.close().catch(() => {});
    client = null;
    db = null;
  }

  const mongoUri = uri || getMongoUri();
  if (!mongoUri) throw new Error('No MongoDB URI configured');

  const newClient = new MongoClient(mongoUri, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
  });

  await newClient.connect();
  client = newClient;
  db = client.db(dbName || getMongoDb());
  connectionError = null;

  client.on('error', (err) => {
    connectionError = err.message;
  });

  return db;
}

export async function testConnection(uri, dbName) {
  const testClient = new MongoClient(uri, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await testClient.connect();
    const testDb = testClient.db(dbName || 'atlas');
    await testDb.command({ ping: 1 });
    return { ok: true };
  } finally {
    await testClient.close().catch(() => {});
  }
}

export function getDb() {
  if (!db) throw new Error('Database not connected');
  return db;
}

export function isConnected() {
  return !!db;
}

export function getConnectionError() {
  return connectionError;
}
