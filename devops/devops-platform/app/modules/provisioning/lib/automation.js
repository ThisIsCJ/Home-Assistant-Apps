import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { ensureCloudflareDnsRecord, hasCloudflareCredentials, resolveCloudflareZoneId } from './cloudflare.js';
import { addN8nDnsRecord, deleteN8nDnsRecord, hasN8nCredentials } from './n8n.js';
import { deleteProxyHost, ensureProxyHost, listProxyHosts, normalizeNpmBaseUrl } from './nginxProxyManager.js';
import { checkSiteReachability, ensureFirewallPort, removeFirewallPort, verifyPortListening } from './ssh.js';

const STEPS = [
  { name: 'permission_validation', order: 0, label: 'Access Validation' },
  { name: 'port_verification', order: 1, label: 'Host Port Check' },
  { name: 'firewall_check', order: 2, label: 'Firewall Rule Check' },
  { name: 'site_reachability', order: 3, label: 'Site Reachability' },
  { name: 'nginx_route', order: 4, label: 'NGINX Route Creation' },
  { name: 'cloudflare_dns', order: 5, label: 'Cloudflare DNS Creation' },
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasSsh(host) {
  return Boolean(clean(host?.managed_ssh_private_key));
}

function hasNginx(config = {}) {
  return Boolean(normalizeNpmBaseUrl(config) && clean(config.username) && clean(config.password) && clean(config.password) !== '***');
}

function buildStepResult(status, summary, detail = null) {
  return { status, summary, detail };
}

function computeFinalStatus(results) {
  const hasFailed = results.some((result) => result.status === 'failed');
  const hasWarning = results.some((result) => result.status === 'warning');
  const hasSuccess = results.some((result) => result.status === 'success');

  if (hasFailed && !hasSuccess && !hasWarning) return 'failed';
  if (hasFailed || hasWarning) return 'partial_success';
  if (hasSuccess) return 'success';
  return 'failed';
}

function buildDnsTarget(request, domain) {
  const fqdn = clean(request.fqdn);
  const target = clean(domain?.dns_target) || clean(domain?.domain_name);

  if (!target) {
    throw new Error('No DNS target is configured for this domain.');
  }

  if (!request.subdomain && target === fqdn) {
    throw new Error('Apex requests need a DNS target that is different from the zone apex.');
  }

  return target;
}

async function runRealStep(stepName, context) {
  const { request, host, domain, configs } = context;

  switch (stepName) {
    case 'permission_validation': {
      if (!host) {
        return buildStepResult('failed', 'Host referenced by the request was not found.', { host_id: String(request.host_id || '') });
      }
      if (!domain) {
        return buildStepResult('failed', 'Domain referenced by the request was not found.', { domain_id: String(request.domain_id || '') });
      }
      if (host.active === false) {
        return buildStepResult('failed', 'Host is inactive.', { host: host.name, hostname: host.hostname });
      }
      if (domain.active === false) {
        return buildStepResult('failed', 'Domain is inactive.', { domain: domain.domain_name });
      }

      return buildStepResult('success', 'Request resources are valid and active.', {
        fqdn: request.fqdn,
        host: host.name,
        hostname: host.hostname,
        domain: domain.domain_name,
      });
    }

    case 'port_verification': {
      if (!host) {
        return buildStepResult('failed', 'Host is missing, so port verification could not run.');
      }
      if (!hasSsh(host)) {
        return buildStepResult('warning', 'Managed SSH key is not installed for this host. Skipping port check.', {});
      }

      const result = await verifyPortListening(host, request.host_port);
      if (result.listening) {
        return buildStepResult('success', `Port ${request.host_port} is listening on ${host.hostname}.`, {
          port: request.host_port,
          listening: true,
          output: result.output,
        });
      }

      return buildStepResult('warning', `Port ${request.host_port} is not listening on ${host.hostname}.`, {
        port: request.host_port,
        listening: false,
        output: result.output,
      });
    }

    case 'firewall_check': {
      if (!host) {
        return buildStepResult('failed', 'Host is missing, so firewall validation could not run.');
      }
      if (!hasSsh(host)) {
        return buildStepResult('warning', 'Managed SSH key is not installed for this host. Skipping firewall check.', {});
      }

      const result = await ensureFirewallPort(host, request.host_port);
      return buildStepResult('success', result.changed
        ? `Opened TCP ${request.host_port} in firewalld.`
        : `TCP ${request.host_port} is already allowed in firewalld.`, {
        port: request.host_port,
        changed: result.changed,
        output: result.output,
      });
    }

    case 'site_reachability': {
      if (!host) {
        return buildStepResult('failed', 'Host is missing, so reachability checks could not run.');
      }
      if (!hasSsh(host)) {
        return buildStepResult('warning', 'Managed SSH key is not installed for this host. Skipping reachability check.', {});
      }

      const result = await checkSiteReachability(host, request.host_port);
      if (!result.statusCode) {
        return buildStepResult('failed', `Could not reach http://127.0.0.1:${request.host_port} from the target host.`, result);
      }
      if (result.statusCode >= 200 && result.statusCode < 400) {
        return buildStepResult('success', `Service responded with HTTP ${result.statusCode}.`, result);
      }
      if (result.statusCode >= 400 && result.statusCode < 600) {
        return buildStepResult('warning', `Service is reachable but returned HTTP ${result.statusCode}.`, result);
      }

      return buildStepResult('failed', 'Unexpected reachability result.', result);
    }

    case 'nginx_route': {
      const nginx = configs.nginx || {};
      if (!hasNginx(nginx)) {
        return buildStepResult('warning', 'NGINX Proxy Manager is not configured. Skipping route creation.', {});
      }
      if (!host) {
        return buildStepResult('failed', 'Host is missing, so an NGINX route could not be created.');
      }

      const result = await ensureProxyHost(nginx, {
        fqdn: request.fqdn,
        forwardHost: host.hostname,
        forwardPort: request.host_port,
        certificateHint: domain?.nginx_cert_profile,
        domainName: domain?.domain_name,
      });

      if (result.created || (result.changed && !result.existing)) {
        return buildStepResult('success', 'NGINX route created.', {
          route_id: result.host?.id,
          fqdn: request.fqdn,
          forward_host: host.hostname,
          forward_port: request.host_port,
          certificate_id: result.certificateId,
        });
      }

      if (result.updated) {
        return buildStepResult('success', 'NGINX route updated to match the requested upstream.', {
          route_id: result.host?.id,
          fqdn: request.fqdn,
          forward_host: host.hostname,
          forward_port: request.host_port,
          certificate_id: result.certificateId,
        });
      }

      if (result.updateFailed) {
        return buildStepResult('warning', `NGINX route already exists but could not be updated automatically: ${result.error}`, {
          route_id: result.host?.id,
          current_forward_host: result.host?.forward_host,
          current_forward_port: result.host?.forward_port,
          requested_forward_host: host.hostname,
          requested_forward_port: request.host_port,
        });
      }

      if (result.existing && result.matchesUpstream) {
        return buildStepResult('success', 'NGINX route already exists and matches the requested upstream.', {
          route_id: result.host?.id,
          fqdn: request.fqdn,
          forward_host: result.host?.forward_host,
          forward_port: result.host?.forward_port,
        });
      }

      return buildStepResult('warning', 'NGINX route exists but does not match the requested upstream.', {
        route_id: result.host?.id,
        current_forward_host: result.host?.forward_host,
        current_forward_port: result.host?.forward_port,
        requested_forward_host: host.hostname,
        requested_forward_port: request.host_port,
      });
    }

    case 'cloudflare_dns': {
      const n8n = configs.n8n || {};
      const cloudflare = configs.cloudflare || {};

      if (!domain) {
        return buildStepResult('failed', 'Domain is missing, so DNS could not be created.');
      }

      if (hasN8nCredentials(n8n)) {
        const domainName = clean(domain.domain_name);
        const fqdn = clean(request.fqdn);
        const subdomain = fqdn.endsWith('.' + domainName)
          ? fqdn.slice(0, -(domainName.length + 1))
          : fqdn;

        if (!subdomain) {
          return buildStepResult('failed', 'Could not extract subdomain from FQDN for n8n DNS creation.', {
            fqdn,
            domain: domainName,
          });
        }

        const result = await addN8nDnsRecord(n8n, { domainUrl: domainName, subdomain });

        if (result.alreadyExists) {
          const nginx = configs.nginx || {};
          if (hasNginx(nginx)) {
            try {
              const proxyHosts = await listProxyHosts(nginx);
              const existing = proxyHosts.find((h) => h.domain_names?.includes(fqdn));
              if (existing) {
                const sameHost = existing.forward_host === host?.hostname;
                const samePort = Number(existing.forward_port) === Number(request.host_port);
                if (sameHost && samePort) {
                  return buildStepResult('success', 'Site is already active — DNS record exists and NGINX route matches.', {
                    fqdn,
                    nginx_forward_host: existing.forward_host,
                    nginx_forward_port: existing.forward_port,
                  });
                }
                return buildStepResult('failed', `DNS record already in use — NGINX is routing ${fqdn} to a different upstream.`, {
                  fqdn,
                  current_forward_host: existing.forward_host,
                  current_forward_port: existing.forward_port,
                  requested_host: host?.hostname,
                  requested_port: request.host_port,
                });
              }
            } catch {
              /* NGINX check failed — fall through to generic warning */
            }
          }
          return buildStepResult('warning', `DNS record for ${fqdn} already exists. Could not verify NGINX route.`, {
            fqdn, subdomain, domain: domainName,
          });
        }

        return buildStepResult('success', result.changed ? 'DNS record created via n8n.' : 'DNS record already matched.', {
          name: fqdn,
          subdomain,
          domain: domainName,
          changed: result.changed,
        });
      }

      if (!hasCloudflareCredentials(cloudflare)) {
        return buildStepResult('warning', 'Neither n8n nor Cloudflare is configured. Skipping DNS creation.', {});
      }

      const zoneId = await resolveCloudflareZoneId(cloudflare, domain);
      if (!zoneId) {
        return buildStepResult('failed', 'Cloudflare zone ID could not be resolved for this domain.', {
          domain: domain.domain_name,
          configured_zone_id: domain.cloudflare_zone_id || cloudflare.default_zone_id || '',
        });
      }

      const target = buildDnsTarget(request, domain);
      const result = await ensureCloudflareDnsRecord(cloudflare, {
        zoneId,
        name: request.fqdn,
        content: target,
        proxied: true,
      });

      return buildStepResult('success', result.changed
        ? 'Cloudflare DNS record created or updated.'
        : 'Cloudflare DNS record already matched the requested target.', {
        zone_id: zoneId,
        record_id: result.record?.id,
        name: request.fqdn,
        content: target,
        proxied: true,
        changed: result.changed,
      });
    }

    default:
      return buildStepResult('skipped', 'Unknown step.', {});
  }
}

const TEARDOWN_STEPS = [
  { name: 'teardown_dns', order: 0, label: 'DNS Record Removal' },
  { name: 'teardown_nginx', order: 1, label: 'NGINX Route Removal' },
  { name: 'teardown_firewall', order: 2, label: 'Firewall Port Closure' },
];

async function runTeardownStep(stepName, context) {
  const { request, host, domain, configs } = context;

  switch (stepName) {
    case 'teardown_dns': {
      const n8n = configs.n8n || {};
      if (!hasN8nCredentials(n8n)) {
        return buildStepResult('warning', 'n8n is not configured. DNS record was not removed.', {});
      }

      const domainName = clean(request.domain_name || domain?.domain_name || '');
      const fqdn = clean(request.fqdn);
      const subdomain = fqdn.endsWith('.' + domainName)
        ? fqdn.slice(0, -(domainName.length + 1))
        : fqdn;

      if (!subdomain || !domainName) {
        return buildStepResult('failed', 'Could not extract subdomain/domain from request for DNS removal.', { fqdn, domain: domainName });
      }

      const result = await deleteN8nDnsRecord(n8n, { domainUrl: domainName, subdomain });
      return buildStepResult('success', `DNS record for ${fqdn} removed via n8n.`, {
        fqdn, subdomain, domain: domainName, result: result.result,
      });
    }

    case 'teardown_nginx': {
      const nginx = configs.nginx || {};
      if (!hasNginx(nginx)) {
        return buildStepResult('warning', 'NGINX Proxy Manager is not configured. Route was not removed.', {});
      }

      const result = await deleteProxyHost(nginx, clean(request.fqdn));
      if (!result.existed) {
        return buildStepResult('success', `No NGINX route found for ${request.fqdn} — nothing to remove.`, {});
      }
      return buildStepResult('success', `NGINX route for ${request.fqdn} deleted.`, { id: result.id });
    }

    case 'teardown_firewall': {
      if (!host) {
        return buildStepResult('failed', 'Host is missing, so the firewall port could not be closed.');
      }
      if (!hasSsh(host)) {
        return buildStepResult('warning', 'Managed SSH key is not installed for this host. Skipping firewall port closure.', {});
      }

      const result = await removeFirewallPort(host, request.host_port);
      return buildStepResult('success', result.changed
        ? `Closed TCP ${request.host_port} in firewalld on ${host.hostname}.`
        : `TCP ${request.host_port} was not present in firewalld — nothing to remove.`, {
        port: request.host_port,
        changed: result.changed,
        output: result.output,
      });
    }

    default:
      return buildStepResult('skipped', 'Unknown teardown step.', {});
  }
}

export async function startRun(requestId, initiatedBy) {
  const db = getDb();
  if (!db) {
    console.log('[automation] No DB configured, skipping run', requestId);
    return;
  }

  const requestObjectId = new ObjectId(requestId);
  const request = await db.collection('requests').findOne({ _id: requestObjectId });
  if (!request) return;

  const [cfgDocs, host, domain] = await Promise.all([
    db.collection('integrations').find({}).toArray(),
    request.host_id ? db.collection('hosts').findOne({ _id: request.host_id }) : null,
    request.domain_id ? db.collection('domains').findOne({ _id: request.domain_id }) : null,
  ]);

  const configs = {};
  cfgDocs.forEach((doc) => {
    configs[doc.provider] = doc;
  });

  const run = {
    site_request_id: requestObjectId,
    started_at: new Date(),
    ended_at: null,
    final_status: 'running',
    initiated_by: initiatedBy,
  };

  const { insertedId: runId } = await db.collection('runs').insertOne(run);
  await db.collection('requests').updateOne(
    { _id: requestObjectId },
    { $set: { status: 'running', run_id: runId, updated_at: new Date() } }
  );

  setImmediate(async () => {
    const results = [];
    const context = { request, host, domain, configs };

    for (const step of STEPS) {
      const startedAt = new Date();
      await db.collection('steps').insertOne({
        automation_run_id: runId,
        step_name: step.name,
        step_order: step.order,
        status: 'running',
        summary: null,
        detail_json: null,
        started_at: startedAt,
        ended_at: null,
      });

      let result;
      try {
        result = await runRealStep(step.name, context);
      } catch (error) {
        result = buildStepResult('failed', error.message, { error: error.message });
      }

      const endedAt = new Date();
      await db.collection('steps').updateOne(
        { automation_run_id: runId, step_name: step.name },
        {
          $set: {
            status: result.status,
            summary: result.summary,
            detail_json: result.detail,
            ended_at: endedAt,
          },
        }
      );

      await db.collection('requests').updateOne(
        { _id: requestObjectId },
        { $set: { last_step: step.name, updated_at: endedAt } }
      );

      results.push(result);
    }

    const finalStatus = computeFinalStatus(results);
    const endedAt = new Date();

    await db.collection('runs').updateOne(
      { _id: runId },
      { $set: { final_status: finalStatus, ended_at: endedAt } }
    );

    await db.collection('requests').updateOne(
      { _id: requestObjectId },
      {
        $set: {
          status: finalStatus,
          updated_at: endedAt,
        },
      }
    );

    console.log(`[automation] Run ${runId} completed: ${finalStatus}`);
  });
}

export async function startTeardown(requestId, initiatedBy) {
  const db = getDb();
  if (!db) {
    console.log('[automation] No DB configured, skipping teardown', requestId);
    return;
  }

  const requestObjectId = new ObjectId(requestId);
  const request = await db.collection('requests').findOne({ _id: requestObjectId });
  if (!request) return;

  const [cfgDocs, host, domain] = await Promise.all([
    db.collection('integrations').find({}).toArray(),
    request.host_id ? db.collection('hosts').findOne({ _id: request.host_id }) : null,
    request.domain_id ? db.collection('domains').findOne({ _id: request.domain_id }) : null,
  ]);

  const configs = {};
  cfgDocs.forEach((doc) => { configs[doc.provider] = doc; });

  const run = {
    site_request_id: requestObjectId,
    run_type: 'teardown',
    started_at: new Date(),
    ended_at: null,
    final_status: 'running',
    initiated_by: initiatedBy,
  };

  const { insertedId: runId } = await db.collection('runs').insertOne(run);
  await db.collection('requests').updateOne(
    { _id: requestObjectId },
    { $set: { status: 'running', run_id: runId, updated_at: new Date() } }
  );

  setImmediate(async () => {
    const results = [];
    const context = { request, host, domain, configs };

    for (const step of TEARDOWN_STEPS) {
      const startedAt = new Date();
      await db.collection('steps').insertOne({
        automation_run_id: runId,
        step_name: step.name,
        step_order: step.order,
        status: 'running',
        summary: null,
        detail_json: null,
        started_at: startedAt,
        ended_at: null,
      });

      let result;
      try {
        result = await runTeardownStep(step.name, context);
      } catch (error) {
        result = buildStepResult('failed', error.message, { error: error.message });
      }

      const endedAt = new Date();
      await db.collection('steps').updateOne(
        { automation_run_id: runId, step_name: step.name },
        { $set: { status: result.status, summary: result.summary, detail_json: result.detail, ended_at: endedAt } }
      );

      await db.collection('requests').updateOne(
        { _id: requestObjectId },
        { $set: { last_step: step.name, updated_at: endedAt } }
      );

      results.push(result);
    }

    const finalStatus = computeFinalStatus(results);
    const endedAt = new Date();

    await db.collection('runs').updateOne(
      { _id: runId },
      { $set: { final_status: finalStatus, ended_at: endedAt } }
    );

    const requestStatus = finalStatus === 'failed' ? 'teardown_failed' : 'removed';
    await db.collection('requests').updateOne(
      { _id: requestObjectId },
      { $set: { status: requestStatus, updated_at: endedAt } }
    );

    console.log(`[automation] Teardown ${runId} completed: ${finalStatus}`);
  });
}
