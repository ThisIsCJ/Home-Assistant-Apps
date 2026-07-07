import { execFile } from 'node:child_process';
import path from 'node:path';
import { DATA_PATH } from './config.js';
import { keyFilePath } from './keys.js';

const GIT_TIMEOUT = 5 * 60_000;

// Accept only git-over-SSH and https remotes. Rejecting everything else (in
// particular file:// and plain local paths) keeps git sandboxed to real
// remote repositories.
export function validRepoUrl(url) {
  return /^(git@[\w.-]+:[\w./~-]+(\.git)?|ssh:\/\/[\w.@:/~-]+|https:\/\/[\w.-]+\/[\w./~-]+(\.git)?)$/.test(String(url || ''));
}

function gitEnv(sshKeyId) {
  const knownHosts = path.join(DATA_PATH, 'known_hosts');
  let ssh = `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${knownHosts}`;
  if (sshKeyId) ssh += ` -i ${keyFilePath(sshKeyId)} -o IdentitiesOnly=yes`;
  return {
    ...process.env,
    GIT_SSH_COMMAND: ssh,
    GIT_TERMINAL_PROMPT: '0',   // fail instead of prompting for credentials
    HOME: DATA_PATH,            // git config/known_hosts live under /data
  };
}

// All git invocations go through execFile — never a shell — with cwd pinned
// to the site's repository directory.
export function git(args, { cwd, sshKeyId } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: gitEnv(sshKeyId), timeout: GIT_TIMEOUT, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error((stderr || stdout || err.message).trim().split('\n').slice(-8).join('\n'));
          e.cause = err;
          return reject(e);
        }
        resolve(stdout);
      });
  });
}

export const clone = (url, branch, dest, sshKeyId) =>
  git(['clone', '--branch', branch, '--single-branch', url, dest], { sshKeyId });

export const pullFF = (cwd, sshKeyId) =>
  git(['pull', '--ff-only'], { cwd, sshKeyId });

export const head = async (cwd) =>
  (await git(['rev-parse', 'HEAD'], { cwd })).trim();

// Files touched on the remote between two commits — used to detect conflicts
// with a user's draft before pushing.
export async function changedBetween(cwd, from, to) {
  if (!from || from === to) return [];
  try {
    const out = await git(['diff', '--name-only', `${from}..${to}`], { cwd });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // unknown base (e.g. history rewritten) — treat as no overlap info
  }
}

export async function commitAndPush(cwd, { files, message, authorName, authorEmail, branch, sshKeyId }) {
  await git(['add', '--', ...files], { cwd });
  await git([
    '-c', `user.name=${authorName}`,
    '-c', `user.email=${authorEmail}`,
    'commit', '-m', message,
  ], { cwd });
  const hash = await head(cwd);
  try {
    await git(['push', 'origin', `HEAD:${branch}`], { cwd, sshKeyId });
  } catch (err) {
    // Roll the local commit back so the working tree matches the remote again
    // and the user's draft (still on disk) can be pushed after a sync.
    await git(['reset', '--hard', 'HEAD~1'], { cwd }).catch(() => {});
    throw err;
  }
  return hash;
}
