import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD_PATH } from './config.js';
import { safeJoin, userSlug } from './paths.js';
import { repoDir, draftDir } from './overlay.js';

const BUILD_TIMEOUT = 10 * 60_000;

export const workspaceDir = (site, username) =>
  path.join(BUILD_PATH, site.id, userSlug(username));

// The preview root for a built site: <workspace>/<output_dir>.
export function builtOutputDir(site, username) {
  const ws = workspaceDir(site, username);
  if (!site.output_dir) return ws;
  return safeJoin(ws, site.output_dir) || ws;
}

// Copy repo (minus .git) into a per-user workspace, overlay the user's draft
// files, then run the configured build command inside it. The command runs
// with cwd pinned to the workspace; it is admin-configured, so it is trusted
// to the same degree as the add-on configuration itself.
export function runBuild(site, username) {
  const ws = workspaceDir(site, username);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  fs.cpSync(repoDir(site), ws, {
    recursive: true,
    filter: (src) => path.basename(src) !== '.git',
  });
  const dd = draftDir(site, username);
  if (fs.existsSync(dd)) fs.cpSync(dd, ws, { recursive: true });

  return new Promise((resolve) => {
    execFile('bash', ['-c', site.build_cmd], {
      cwd: ws,
      timeout: BUILD_TIMEOUT,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, HOME: ws, CI: 'true' },
    }, (err, stdout, stderr) => {
      const log = [stdout, stderr].filter(Boolean).join('\n').slice(-20_000);
      resolve({ ok: !err, log: err ? `${log}\n${err.message}` : log });
    });
  });
}
