import https from 'node:https';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { NodeSSH } from 'node-ssh';

const TIMEOUT_MS = 10_000;

// HTTPS GET against the PUBLIC fqdn — latency + SSL cert expiry for what users actually see.
// Uses rejectUnauthorized:false so we can report cert details even when the cert is invalid.
export async function checkUrl(fqdn) {
  const start = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };

    const req = https.request(
      { hostname: fqdn, path: '/', method: 'GET', timeout: TIMEOUT_MS, rejectUnauthorized: false },
      (res) => {
        const latency_ms = Math.round(performance.now() - start);
        const http_status = res.statusCode;
        const ok = http_status < 500;

        let ssl_valid = false;
        let ssl_days_remaining = null;
        const cert = res.socket?.getPeerCertificate?.();
        if (cert?.valid_to) {
          const exp = new Date(cert.valid_to);
          ssl_valid = exp > new Date();
          ssl_days_remaining = Math.floor((exp - Date.now()) / 86_400_000);
        }

        res.resume();
        done({ ok, latency_ms, http_status, ssl_valid, ssl_days_remaining, error: null });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, latency_ms: null, http_status: null, ssl_valid: false, ssl_days_remaining: null, error: 'timeout' });
    });
    req.on('error', (err) =>
      done({ ok: false, latency_ms: null, http_status: null, ssl_valid: false, ssl_days_remaining: null, error: err.message })
    );
    req.end();
  });
}

// TCP connect check
export async function checkPort(hostname, port) {
  const start = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };

    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); done({ ok: false, latency_ms: null, error: 'timeout' }); }, TIMEOUT_MS);

    socket.connect(port, hostname, () => {
      clearTimeout(timer);
      socket.destroy();
      done({ ok: true, latency_ms: Math.round(performance.now() - start), error: null });
    });
    socket.on('error', (err) => { clearTimeout(timer); done({ ok: false, latency_ms: null, error: err.message }); });
  });
}

// SSH connect + CPU/mem/disk metrics via /proc
export async function checkHost(hostDoc) {
  const start = performance.now();
  const ssh = new NodeSSH();
  try {
    const opts = {
      host: hostDoc.hostname,
      port: hostDoc.ssh_port || 22,
      username: hostDoc.ssh_username || 'root',
      readyTimeout: TIMEOUT_MS,
    };
    if (hostDoc.managed_ssh_private_key) {
      opts.privateKey = hostDoc.managed_ssh_private_key;
    } else if (hostDoc.ssh_password) {
      opts.password = hostDoc.ssh_password;
    } else {
      return { ok: false, latency_ms: null, cpu_pct: null, mem_pct: null, disk_pct: null, error: 'No SSH credentials' };
    }

    await ssh.connect(opts);
    const latency_ms = Math.round(performance.now() - start);

    const { stdout } = await ssh.execCommand(
      "cat /proc/loadavg && nproc && grep -E 'MemTotal:|MemAvailable:' /proc/meminfo && df / --output=pcent 2>/dev/null | tail -1 || df / | awk 'NR==2{print $5}'"
    );

    const lines = stdout.trim().split('\n');
    let cpu_pct = null, mem_pct = null, disk_pct = null;

    try {
      const load1 = parseFloat(lines[0].split(' ')[0]);
      const ncpus = parseInt(lines[1]) || 1;
      cpu_pct = Math.min(100, Math.round((load1 / ncpus) * 100));
    } catch {}

    try {
      const mTotal = lines.find(l => l.startsWith('MemTotal:'));
      const mAvail = lines.find(l => l.startsWith('MemAvailable:'));
      if (mTotal && mAvail) {
        const total = parseInt(mTotal.match(/\d+/)[0]);
        const avail = parseInt(mAvail.match(/\d+/)[0]);
        mem_pct = Math.round(((total - avail) / total) * 100);
      }
    } catch {}

    try {
      const diskLine = lines[lines.length - 1];
      disk_pct = parseInt(diskLine.replace('%', '').trim());
    } catch {}

    await ssh.dispose();
    return { ok: true, latency_ms, cpu_pct, mem_pct, disk_pct, error: null };
  } catch (err) {
    try { ssh.dispose(); } catch {}
    return { ok: false, latency_ms: null, cpu_pct: null, mem_pct: null, disk_pct: null, error: err.message };
  }
}
