function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNpmBaseUrl(config = {}) {
  const raw = clean(config.base_url || config.host);
  if (!raw) return '';

  try {
    const withScheme = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
    return new URL(withScheme).origin;
  } catch {
    return '';
  }
}

function getNpmConfig(config = {}) {
  const baseUrl = normalizeNpmBaseUrl(config);
  const username = clean(config.username);
  const password = clean(config.password);

  if (!baseUrl || !username || !password || password === '***') return null;
  return { baseUrl, username, password };
}

async function npmFetch(config, path, init = {}) {
  const npm = getNpmConfig(config);
  if (!npm) {
    throw new Error('Configure NGINX Proxy Manager base URL, username, and password.');
  }

  const tokenResponse = await fetch(`${npm.baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identity: npm.username, secret: npm.password }),
  });

  const tokenData = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !tokenData?.token) {
    throw new Error(tokenData?.message || 'Could not authenticate to NGINX Proxy Manager.');
  }

  const response = await fetch(`${npm.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${tokenData.token}`,
      ...(init.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.error?.message || `NGINX Proxy Manager API request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export async function verifyNpm(config = {}) {
  try {
    const data = await npmFetch(config, '/api/');
    return { ok: true, message: `Connected to NGINX Proxy Manager ${data?.version?.major ?? ''}.${data?.version?.minor ?? ''}.${data?.version?.revision ?? ''}`.replace(/\.$/, '') };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function listProxyHosts(config = {}) {
  return npmFetch(config, '/api/nginx/proxy-hosts');
}

async function listCertificates(config = {}) {
  return npmFetch(config, '/api/nginx/certificates');
}

function wildcardForDomain(domainName) {
  return domainName ? `*.${domainName}` : '';
}

function findCertificateId(certificates, hint, domainName) {
  const normalizedHint = clean(hint);
  const wildcard = wildcardForDomain(domainName);

  const matches = certificates.find((cert) =>
    cert.nice_name === normalizedHint ||
    cert.nice_name === wildcard ||
    cert.domain_names?.includes(normalizedHint) ||
    cert.domain_names?.includes(wildcard) ||
    cert.domain_names?.includes(domainName)
  );

  return matches?.id || 0;
}

function buildProxyPayload({ fqdn, forwardHost, forwardPort, certificateId }) {
  return {
    domain_names: [fqdn],
    forward_scheme: 'http',
    forward_host: forwardHost,
    forward_port: Number(forwardPort),
    access_list_id: 0,
    certificate_id: certificateId,
    ssl_forced: Boolean(certificateId),
    block_exploits: true,
    caching_enabled: false,
    advanced_config: '',
    enabled: true,
    locations: [],
  };
}

export async function ensureProxyHost(config = {}, { fqdn, forwardHost, forwardPort, certificateHint, domainName }) {
  if (!fqdn || !forwardHost || !forwardPort) {
    throw new Error('FQDN, forward host, and forward port are required for NGINX route creation.');
  }

  const [proxyHosts, certificates] = await Promise.all([
    listProxyHosts(config),
    listCertificates(config),
  ]);

  const certificateId = findCertificateId(certificates, certificateHint, domainName);
  const existing = proxyHosts.find((host) => host.domain_names?.includes(fqdn));
  const payload = buildProxyPayload({ fqdn, forwardHost, forwardPort, certificateId });

  if (existing) {
    const matchesUpstream = existing.forward_host === forwardHost && Number(existing.forward_port) === Number(forwardPort);
    const matchesCertificate = Number(existing.certificate_id || 0) === Number(certificateId || 0);

    if (!matchesUpstream || !matchesCertificate) {
      try {
        const updated = await npmFetch(config, `/api/nginx/proxy-hosts/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        return {
          changed: true,
          existing: true,
          updated: true,
          host: updated,
          certificateId,
          matchesUpstream: true,
        };
      } catch (error) {
        return {
          changed: false,
          existing: true,
          updateFailed: true,
          error: error.message,
          host: existing,
          certificateId,
          matchesUpstream,
        };
      }
    }

    return {
      changed: false,
      existing: true,
      host: existing,
      certificateId,
      matchesUpstream,
    };
  }

  const created = await npmFetch(config, '/api/nginx/proxy-hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    created: true,
    changed: true,
    existing: false,
    host: created,
    certificateId,
    matchesUpstream: true,
  };
}

export async function deleteProxyHost(config = {}, fqdn) {
  if (!fqdn) throw new Error('FQDN is required.');

  const proxyHosts = await listProxyHosts(config);
  const existing = proxyHosts.find((host) => host.domain_names?.includes(fqdn));

  if (!existing) {
    return { deleted: false, existed: false };
  }

  await npmFetch(config, `/api/nginx/proxy-hosts/${existing.id}`, { method: 'DELETE' });
  return { deleted: true, existed: true, id: existing.id };
}
