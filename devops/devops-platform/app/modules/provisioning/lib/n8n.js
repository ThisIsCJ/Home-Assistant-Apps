const ENDPOINTS = {
  zones: '/webhook/cloudflare-domains',
  allDns: '/webhook/all-dns',
  addDns: '/webhook/add-dns',
};

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBase(rawUrl) {
  // Strip trailing slash and any accidental /webhook/... path the user may have pasted
  return clean(rawUrl).replace(/\/$/, '').replace(/\/webhook(\/.*)?$/, '');
}

function buildHeaders(apiKey, hasBody) {
  const h = { 'x-api-key': apiKey };
  if (hasBody) h['Content-Type'] = 'application/json';
  return h;
}

async function n8nRaw(config, path, init = {}) {
  const base = normalizeBase(config.webhook_base_url);
  const apiKey = clean(config.api_key);
  if (!base || !apiKey) throw new Error('n8n webhook URL and API key are required.');

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...buildHeaders(apiKey, Boolean(init.body)), ...(init.headers || {}) },
  });

  const text = await response.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }
  return { ok: response.ok, status: response.status, text, data };
}

async function n8nFetch(config, path, init = {}) {
  const result = await n8nRaw(config, path, init);
  if (!result.ok) {
    throw new Error(`n8n request failed (${result.status}): ${result.text.slice(0, 200)}`);
  }
  if (result.data === null && result.text) {
    throw new Error(`n8n returned non-JSON response: ${result.text.slice(0, 200)}`);
  }
  return result.data;
}

export function hasN8nCredentials(config = {}) {
  return Boolean(normalizeBase(config.webhook_base_url) && clean(config.api_key));
}

export async function verifyN8n(config = {}) {
  if (!hasN8nCredentials(config)) {
    return { ok: false, message: 'n8n webhook URL and API key are required.' };
  }
  try {
    const data = await n8nFetch(config, ENDPOINTS.zones);
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    return {
      ok: true,
      message: `n8n connected. Found ${count} domain${count === 1 ? '' : 's'}.`,
    };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function listN8nZones(config = {}) {
  const data = await n8nFetch(config, ENDPOINTS.zones);
  return (data?.data || []).map((zone) => ({
    id: zone.Zone_ID,
    name: zone.URL,
    status: 'active',
    paused: false,
    type: 'full',
    account: { name: 'n8n' },
    name_servers: [],
  }));
}

export async function listN8nDnsRecords(config = {}, domainName) {
  const domain = clean(domainName);
  if (!domain) throw new Error('Domain name is required.');

  const data = await n8nFetch(config, ENDPOINTS.allDns, {
    method: 'POST',
    body: JSON.stringify({ URL: domain }),
  });

  const records = data?.result || [];
  return records.sort((a, b) => {
    const nc = (a.name || '').localeCompare(b.name || '');
    return nc !== 0 ? nc : (a.type || '').localeCompare(b.type || '');
  });
}

function isAlreadyInUse(text = '') {
  const lower = text.toLowerCase();
  return lower.includes('already in use') || lower.includes('already exists') || lower.includes('duplicate record');
}

export async function addN8nDnsRecord(config = {}, { domainUrl, subdomain }) {
  if (!domainUrl || !subdomain) {
    throw new Error('Domain URL and subdomain name are required.');
  }

  const res = await n8nRaw(config, ENDPOINTS.addDns, {
    method: 'POST',
    body: JSON.stringify({ URL: domainUrl, SUB: subdomain }),
  });

  const alreadyExists = isAlreadyInUse(res.text);

  if (!res.ok && !alreadyExists) {
    throw new Error(`n8n add-dns failed (${res.status}): ${res.text.slice(0, 200)}`);
  }

  return { changed: !alreadyExists, alreadyExists, record: res.data };
}

export async function deleteN8nDnsRecord(config = {}, { domainUrl, subdomain }) {
  if (!domainUrl || !subdomain) {
    throw new Error('Domain URL and subdomain name are required.');
  }
  const data = await n8nFetch(config, '/webhook/delete-dns', {
    method: 'POST',
    body: JSON.stringify({ URL: domainUrl, SUB: subdomain }),
  });
  return { deleted: true, result: data };
}
