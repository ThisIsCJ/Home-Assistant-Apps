const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

function clean(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed === '***' ? '' : trimmed;
}

function buildZonesQuery(config = {}, params = {}) {
  const accountId = clean(config.account_id);
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') search.set(key, String(value));
  });

  if (accountId) {
    search.set('account.id', accountId);
  }

  const query = search.toString();
  return query ? `/zones?${query}` : '/zones';
}

export function getCloudflareAuth(config = {}) {
  const authMode = clean(config.auth_mode);
  const apiToken = clean(config.api_token);
  const apiKey = clean(config.api_key);
  const email = clean(config.email);

  if (authMode === 'global_key' && apiKey && email) {
    return {
      mode: 'global_key',
      headers: {
        'X-Auth-Key': apiKey,
        'X-Auth-Email': email,
      },
    };
  }

  if (authMode === 'token' && apiToken) {
    return {
      mode: 'token',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    };
  }

  if (apiKey && email) {
    return {
      mode: 'global_key',
      headers: {
        'X-Auth-Key': apiKey,
        'X-Auth-Email': email,
      },
    };
  }

  if (apiToken) {
    return {
      mode: 'token',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    };
  }

  return null;
}

export function hasCloudflareCredentials(config = {}) {
  return Boolean(getCloudflareAuth(config));
}

async function cfFetch(config, path, init = {}) {
  const auth = getCloudflareAuth(config);
  if (!auth) {
    throw new Error('Configure either a Cloudflare API token or a Global API key with account email.');
  }

  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...auth.headers,
      ...(init.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    const message = data?.errors?.[0]?.message || `Cloudflare API request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export async function verifyCloudflare(config = {}) {
  const auth = getCloudflareAuth(config);
  if (!auth) {
    return { ok: false, message: 'No Cloudflare credentials configured.' };
  }

  try {
    // Listing zones is the capability the app actually uses (it's exactly what
    // domain sync does), so treat it as the source of truth for the test. The
    // previous account-scoped /tokens/verify call reported "Invalid API Token"
    // for tokens that are valid for zones but not scoped to verify themselves —
    // so a token that syncs fine would fail the test. Don't do that.
    const isToken = auth.mode === 'token';
    const kind = isToken ? 'API token' : 'Global API key';

    const data = await cfFetch(config, buildZonesQuery(config, { per_page: 1 }));
    const count = data?.result_info?.count ?? data?.result?.length ?? 0;

    if (count === 0) {
      return {
        ok: false,
        message: isToken
          ? 'Cloudflare token is valid, but it cannot see any zones. Grant Zone:Read and DNS:Edit for the target zone, or use the correct Cloudflare account.'
          : 'Cloudflare credentials are valid, but no zones are visible to this account.',
      };
    }

    return {
      ok: true,
      message: `Cloudflare ${kind} is valid. Found ${count} accessible zone${count === 1 ? '' : 's'}.`,
    };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function listCloudflareZones(config = {}) {
  const zones = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await cfFetch(config, buildZonesQuery(config, { per_page: 100, page }));
    zones.push(...(data.result || []));
    totalPages = data?.result_info?.total_pages || 1;
    page += 1;
  } while (page <= totalPages);

  return zones;
}

function buildDomainSelector(zone = {}) {
  return zone.id
    ? { $or: [{ cloudflare_zone_id: zone.id }, { domain_name: zone.name }] }
    : { domain_name: zone.name };
}

function buildDomainUpdate(zone = {}, existing = null, now = new Date()) {
  const update = {
    domain_name: zone.name,
    cloudflare_zone_id: zone.id,
    active: existing?.active ?? true,
    updated_at: now,
    cloudflare_account_name: zone.account?.name || '',
    cloudflare_name_servers: zone.name_servers || [],
  };

  if (!existing?.created_at) {
    update.created_at = now;
  }

  return update;
}

export async function upsertCloudflareZones(db, zones = []) {
  const synced = [];

  for (const zone of zones) {
    const now = new Date();
    const selector = buildDomainSelector(zone);

    const existing = await db.collection('domains').findOne(selector);
    const update = buildDomainUpdate(zone, existing, now);

    const result = await db.collection('domains').findOneAndUpdate(
      selector,
      {
        $set: update,
        $setOnInsert: {
          nginx_cert_profile: '',
          dns_target: zone.name,
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    );

    synced.push(result);
  }

  return synced;
}

export async function upsertCloudflareDomains(db, config = {}, options = {}) {
  const zones = await listCloudflareZones(config);
  const requestedZoneIds = new Set((options.zoneIds || []).map(clean).filter(Boolean));
  const filteredZones = requestedZoneIds.size
    ? zones.filter((zone) => requestedZoneIds.has(zone.id))
    : zones;

  return upsertCloudflareZones(db, filteredZones);
}

export async function resolveCloudflareZoneId(config = {}, domain = {}) {
  const explicitZoneId = clean(domain.cloudflare_zone_id) || clean(config.default_zone_id);
  if (explicitZoneId) return explicitZoneId;

  const domainName = clean(domain.domain_name);
  if (!domainName) return '';

  const zones = await listCloudflareZones(config);
  const match = zones.find((zone) => zone.name === domainName);
  return match?.id || '';
}

export async function listCloudflareDnsRecords(config = {}, zoneId) {
  const cleanedZoneId = clean(zoneId);
  if (!cleanedZoneId) {
    throw new Error('Cloudflare zone id is required.');
  }
  if (clean(config.account_id) && cleanedZoneId === clean(config.account_id)) {
    throw new Error('The saved Cloudflare zone ID matches the account ID. Import the real zone from Cloudflare or set the domain to the actual zone ID.');
  }

  const records = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await cfFetch(config, `/zones/${cleanedZoneId}/dns_records?per_page=100&page=${page}`);
    records.push(...(data.result || []));
    totalPages = data?.result_info?.total_pages || 1;
    page += 1;
  } while (page <= totalPages);

  return records.sort((left, right) => {
    const nameCompare = (left.name || '').localeCompare(right.name || '');
    if (nameCompare !== 0) return nameCompare;
    return (left.type || '').localeCompare(right.type || '');
  });
}

export async function ensureCloudflareDnsRecord(config = {}, { zoneId, name, content, proxied = true }) {
  if (!zoneId) {
    throw new Error('Cloudflare zone id is required.');
  }
  if (clean(config.account_id) && zoneId === clean(config.account_id)) {
    throw new Error('Configured Cloudflare zone ID matches the account ID. Set the domain to the actual zone ID before creating DNS records.');
  }
  if (!name || !content) {
    throw new Error('DNS record name and target are required.');
  }

  const query = `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`;
  const existingData = await cfFetch(config, query);
  const existing = (existingData.result || []).find(record => record.name === name);

  const payload = {
    type: 'CNAME',
    name,
    content,
    proxied,
    ttl: 1,
  };

  if (existing) {
    const sameContent = existing.type === payload.type
      && existing.content === payload.content
      && Boolean(existing.proxied) === Boolean(payload.proxied);

    if (sameContent) {
      return { changed: false, record: existing };
    }

    const updated = await cfFetch(config, `/zones/${zoneId}/dns_records/${existing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { changed: true, record: updated.result };
  }

  const created = await cfFetch(config, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return { changed: true, record: created.result };
}
