import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { NodeSSH } from 'node-ssh';

function shEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function generateSshKeyPair(comment = '') {
  const { privateKey: privObj, publicKey: pubObj } = generateKeyPairSync('ed25519');

  const spkiDer = pubObj.export({ type: 'spki', format: 'der' });
  const rawPub = spkiDer.slice(12);

  const pkcs8Der = privObj.export({ type: 'pkcs8', format: 'der' });
  const rawSeed = pkcs8Der.slice(16);

  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const strBuf = (s) => { const d = Buffer.isBuffer(s) ? s : Buffer.from(s); return Buffer.concat([u32(d.length), d]); };

  const sshPubBytes = Buffer.concat([strBuf('ssh-ed25519'), strBuf(rawPub)]);
  const publicKey = comment
    ? `ssh-ed25519 ${sshPubBytes.toString('base64')} ${comment}`
    : `ssh-ed25519 ${sshPubBytes.toString('base64')}`;

  const check = randomBytes(4);
  const privBlob = Buffer.concat([
    check, check,
    strBuf('ssh-ed25519'),
    strBuf(rawPub),
    strBuf(Buffer.concat([rawSeed, rawPub])),
    strBuf(''),
  ]);
  const pad = (8 - (privBlob.length % 8)) % 8;
  const padBytes = Buffer.from(Array.from({ length: pad }, (_, i) => i + 1));

  const keyData = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    strBuf('none'), strBuf('none'), strBuf(''),
    u32(1),
    strBuf(sshPubBytes),
    strBuf(Buffer.concat([privBlob, padBytes])),
  ]);

  const b64Lines = keyData.toString('base64').match(/.{1,70}/g) || [];
  const privateKey = [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    ...b64Lines,
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n') + '\n';

  return { publicKey, privateKey };
}

export function buildFirewallSudoInstructions(host) {
  const sudoFile = `/etc/sudoers.d/${host.ssh_username}`;
  return [
    `echo "${host.ssh_username} ALL=(ALL) NOPASSWD: /usr/bin/firewall-cmd" | sudo tee ${sudoFile}`,
    `sudo chmod 440 ${sudoFile}`,
    `sudo visudo -cf ${sudoFile}`,
  ].join('\n');
}

async function connect(options) {
  const ssh = new NodeSSH();
  try {
    await ssh.connect(options);
    return ssh;
  } catch (error) {
    ssh.dispose();

    const message = error?.level === 'client-authentication'
      ? `SSH authentication failed for ${options.username}@${options.host}:${options.port}.`
      : error?.message || 'SSH connection failed.';

    const wrapped = new Error(message);
    wrapped.status = error?.level === 'client-authentication' ? 400 : 502;
    wrapped.code = error?.level === 'client-authentication' ? 'SSH_AUTH_FAILED' : 'SSH_CONNECT_FAILED';
    throw wrapped;
  }
}

function buildConnectionOptions(host, credentials = {}) {
  const options = {
    host: host.hostname,
    username: host.ssh_username,
    port: Number(host.ssh_port || 22),
    readyTimeout: 20000,
    tryKeyboard: false,
  };

  if (credentials.password) {
    return { ...options, password: credentials.password };
  }

  if (credentials.privateKey || host.managed_ssh_private_key) {
    return { ...options, privateKey: credentials.privateKey || host.managed_ssh_private_key };
  }

  throw new Error(`No SSH credentials available for host ${host.name || host.hostname}.`);
}

export async function installManagedKey(host, password, keyPair) {
  const ssh = await connect(buildConnectionOptions(host, { password }));
  try {
    const homeResult = await ssh.execCommand('printf %s "$HOME"');
    if (homeResult.code !== 0 || !homeResult.stdout.trim()) {
      throw new Error(homeResult.stderr || 'Could not determine remote home directory.');
    }

    const homeDir = homeResult.stdout.trim();
    const sshDir = `${homeDir}/.ssh`;
    const authKeys = `${sshDir}/authorized_keys`;
    const publicKey = keyPair.publicKey.trim();

    const ensureKeyCommand = [
      `mkdir -p ${shEscape(sshDir)}`,
      `touch ${shEscape(authKeys)}`,
      `chmod 700 ${shEscape(sshDir)}`,
      `chmod 600 ${shEscape(authKeys)}`,
      `grep -qxF ${shEscape(publicKey)} ${shEscape(authKeys)} || printf '%s\\n' ${shEscape(publicKey)} >> ${shEscape(authKeys)}`,
    ].join(' && ');

    const result = await ssh.execCommand(ensureKeyCommand);
    if (result.code !== 0) {
      throw new Error(result.stderr || 'Failed to install managed SSH key.');
    }

    return {
      homeDir,
      authorizedKeysPath: authKeys,
    };
  } finally {
    ssh.dispose();
  }
}

export async function testHostReadiness(host) {
  const ssh = await connect(buildConnectionOptions(host));
  try {
    const checks = [];

    const sshCheck = await ssh.execCommand('echo ok');
    checks.push({ name: 'SSH reachable', ok: sshCheck.code === 0, detail: sshCheck.stderr || sshCheck.stdout || '' });

    const remoteUser = await ssh.execCommand('id -un');
    checks.push({ name: 'Remote user valid', ok: remoteUser.code === 0, detail: remoteUser.stdout.trim() || remoteUser.stderr || '' });

    const firewallSudo = await ssh.execCommand('sudo -n firewall-cmd --state');
    checks.push({ name: 'Passwordless sudo for firewall-cmd', ok: firewallSudo.code === 0, detail: firewallSudo.stdout.trim() || firewallSudo.stderr || '' });

    const firewallBinary = await ssh.execCommand('command -v firewall-cmd');
    checks.push({ name: 'firewall-cmd available', ok: firewallBinary.code === 0, detail: firewallBinary.stdout.trim() || firewallBinary.stderr || '' });

    const curlBinary = await ssh.execCommand('command -v curl');
    checks.push({ name: 'curl available', ok: curlBinary.code === 0, detail: curlBinary.stdout.trim() || curlBinary.stderr || '' });

    return {
      ok: checks.every((check) => check.ok),
      checks,
    };
  } finally {
    ssh.dispose();
  }
}

export async function verifyPortListening(host, port) {
  const ssh = await connect(buildConnectionOptions(host));
  try {
    const command = `sh -lc "ss -ltn | awk '{print \\$4}' | grep -E '(^|[:.])${Number(port)}$'"`;
    const result = await ssh.execCommand(command);
    const listening = result.code === 0 && Boolean(result.stdout.trim());
    return {
      listening,
      output: result.stdout.trim() || result.stderr.trim(),
    };
  } finally {
    ssh.dispose();
  }
}

export async function ensureFirewallPort(host, port) {
  const ssh = await connect(buildConnectionOptions(host));
  try {
    const query = await ssh.execCommand(`sudo -n firewall-cmd --query-port=${Number(port)}/tcp`);
    if (query.code === 0 && query.stdout.trim() === 'yes') {
      return { changed: false, output: 'already-present' };
    }

    const apply = await ssh.execCommand(`sudo -n firewall-cmd --add-port=${Number(port)}/tcp --permanent && sudo -n firewall-cmd --reload`);
    if (apply.code !== 0) {
      throw new Error(apply.stderr || 'Failed to add firewall rule.');
    }

    return { changed: true, output: apply.stdout.trim() || 'added' };
  } finally {
    ssh.dispose();
  }
}

export async function removeFirewallPort(host, port) {
  const ssh = await connect(buildConnectionOptions(host));
  try {
    const query = await ssh.execCommand(`sudo -n firewall-cmd --query-port=${Number(port)}/tcp`);
    if (query.code !== 0 || query.stdout.trim() !== 'yes') {
      return { changed: false, output: 'not-present' };
    }

    const remove = await ssh.execCommand(`sudo -n firewall-cmd --remove-port=${Number(port)}/tcp --permanent && sudo -n firewall-cmd --reload`);
    if (remove.code !== 0) {
      throw new Error(remove.stderr || 'Failed to remove firewall rule.');
    }

    return { changed: true, output: remove.stdout.trim() || 'removed' };
  } finally {
    ssh.dispose();
  }
}

export async function checkSiteReachability(host, port) {
  const ssh = await connect(buildConnectionOptions(host));
  try {
    const result = await ssh.execCommand(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${Number(port)}`);
    const statusCode = Number(result.stdout.trim());
    return {
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      output: result.stdout.trim() || result.stderr.trim(),
    };
  } finally {
    ssh.dispose();
  }
}
