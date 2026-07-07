import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db, { now } from '../db.js';
import { KEYS_PATH } from './config.js';

const run = promisify(execFile);

fs.mkdirSync(KEYS_PATH, { recursive: true, mode: 0o700 });

export function keyFilePath(id) {
  // ids are generated server-side (hex), so this stays inside KEYS_PATH.
  return path.join(KEYS_PATH, id);
}

async function fingerprintOf(file) {
  try {
    const { stdout } = await run('ssh-keygen', ['-lf', file]);
    return stdout.trim().split(/\s+/)[1] || null;
  } catch {
    return null;
  }
}

// Store a pasted private key. The key material is written to disk with 0600
// and is never returned by the API again — only name/fingerprint/public key.
export async function importKey(name, privateKey) {
  const id = crypto.randomBytes(8).toString('hex');
  const file = keyFilePath(id);
  const material = String(privateKey).replace(/\r\n/g, '\n').trimEnd() + '\n';
  fs.writeFileSync(file, material, { mode: 0o600 });

  // Derive the public key so admins can copy it into GitHub deploy keys.
  let publicKey = null;
  try {
    const { stdout } = await run('ssh-keygen', ['-y', '-f', file]);
    publicKey = stdout.trim();
  } catch {
    fs.rmSync(file, { force: true });
    throw new Error('Not a valid (unencrypted) SSH private key');
  }
  const fingerprint = await fingerprintOf(file);

  db.prepare('INSERT INTO ssh_keys (id, name, fingerprint, public_key, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, fingerprint, publicKey, now());
  return { id, name, fingerprint, public_key: publicKey };
}

// Generate a fresh ed25519 keypair. The public key is shown so it can be
// added to the GitHub repository as a deploy key with write access.
export async function generateKey(name) {
  const id = crypto.randomBytes(8).toString('hex');
  const file = keyFilePath(id);
  await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `site-editor-${id}`, '-f', file]);
  fs.chmodSync(file, 0o600);
  const publicKey = fs.readFileSync(`${file}.pub`, 'utf8').trim();
  const fingerprint = await fingerprintOf(file);

  db.prepare('INSERT INTO ssh_keys (id, name, fingerprint, public_key, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, fingerprint, publicKey, now());
  return { id, name, fingerprint, public_key: publicKey };
}

export function deleteKey(id) {
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM sites WHERE ssh_key_id = ?').get(id).n;
  if (inUse > 0) throw new Error(`Key is used by ${inUse} site(s)`);
  db.prepare('DELETE FROM ssh_keys WHERE id = ?').run(id);
  fs.rmSync(keyFilePath(id), { force: true });
  fs.rmSync(`${keyFilePath(id)}.pub`, { force: true });
}

export function listKeys() {
  return db.prepare('SELECT id, name, fingerprint, public_key, created_at FROM ssh_keys ORDER BY created_at').all();
}
