import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

function relTime(ts) {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// Build a CSV from `columns` ({ label, value(row) }) over `rows` and download it.
function downloadCsv(filename, columns, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map(c => escape(c.label)).join(','),
    ...rows.map(r => columns.map(c => escape(c.value(r))).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvDate() {
  return new Date().toISOString().slice(0, 10);
}

function StatusBadge({ status }) {
  const map = {
    matched:  { cls: 'badge-green',  icon: <Icons.Check size={10} />,         label: 'Matched' },
    no_host:  { cls: 'badge-orange', icon: <Icons.AlertTriangle size={10} />, label: 'No host' },
    ok:       { cls: 'badge-green',  icon: <Icons.Check size={10} />,         label: 'In NGINX' },
    no_nginx: { cls: 'badge-orange', icon: <Icons.AlertTriangle size={10} />, label: 'No NGINX route' },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <span className={`badge ${m.cls}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {m.icon} {m.label}
    </span>
  );
}

// ── Public IP editor ─────────────────────────────────────────────────────────

function PublicIpField({ value, onChange, onSave, saving, saved }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label className="input-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>Public IP</label>
      <input
        className="input"
        type="text"
        placeholder="e.g. 203.0.113.10"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={e => e.key === 'Enter' && onSave()}
        style={{ width: 170 }}
      />
      {saved && (
        <span style={{ fontSize: '0.72rem', color: 'var(--green2)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <Icons.Check size={12} /> Saved
        </span>
      )}
      {saving && <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>Saving…</span>}
      <span style={{ fontSize: '0.68rem', color: 'var(--muted2)' }}>
        Only Cloudflare A records pointing to this IP are shown.
      </span>
    </div>
  );
}

// ── NGINX table ──────────────────────────────────────────────────────────────

function AdoptResult({ result }) {
  if (!result) return null;
  const ok = result.testResult?.ok;
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-3)', borderRadius: 6, fontSize: '0.7rem' }}>
      <div style={{ fontWeight: 600, color: ok === false ? 'var(--orange)' : 'var(--green2)', marginBottom: 4 }}>
        {result.testResult?.message}
      </div>
      {result.testResult?.checks?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {result.testResult.checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {c.ok
                ? <Icons.Check size={10} style={{ color: 'var(--green2)', flexShrink: 0 }} />
                : <Icons.X size={10} style={{ color: 'var(--red)', flexShrink: 0 }} />}
              <span style={{ color: 'var(--muted2)' }}>{c.name}</span>
              {c.detail && <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{c.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NginxTable({ entries, navigate, onAdopt, adopting, adoptResults }) {
  const [filter, setFilter] = useState('all');

  const visible = entries.filter(e => {
    if (filter === 'matched')   return e.status === 'matched';
    if (filter === 'no_host')   return e.status === 'no_host';
    if (filter === 'untracked') return e.status === 'matched' && !e.tracked;
    return true;
  });

  const noHostCount    = entries.filter(e => e.status === 'no_host').length;
  const untrackedCount = entries.filter(e => e.status === 'matched' && !e.tracked).length;

  const exportCsv = () => downloadCsv(
    `discovery-nginx-${csvDate()}.csv`,
    [
      { label: 'FQDN',         value: e => e.fqdn || (e.fqdns || []).join(' ') },
      { label: 'Forward host', value: e => e.forward_host },
      { label: 'Port',         value: e => e.forward_port },
      { label: 'Enabled',      value: e => (e.enabled ? 'yes' : 'no') },
      { label: 'Status',       value: e => e.status },
      { label: 'Tracked',      value: e => (e.tracked ? 'yes' : 'no') },
      { label: 'Matched host', value: e => e.host_name || '' },
    ],
    visible,
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{entries.length} proxy hosts</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {[
            ['all', 'All'],
            ['matched', 'Matched'],
            ['untracked', `Adopt (${untrackedCount})`],
            ['no_host', 'No host'],
          ].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${filter === v ? 'btn-pri' : 'btn-sec'}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
          <button className="btn btn-sm btn-sec" onClick={exportCsv} disabled={!visible.length} title="Export the rows in view to CSV">
            <Icons.Download size={12} /> CSV
          </button>
        </div>
      </div>

      {noHostCount > 0 && (
        <div className="alert alert-info" style={{ marginBottom: 10 }}>
          <Icons.Info size={14} style={{ flexShrink: 0 }} />
          {noHostCount} proxy host{noHostCount !== 1 ? 's' : ''} have no matching host in the database. Click "Add host" to pre-fill the hostname and add it now.
        </div>
      )}

      {untrackedCount > 0 && (
        <div className="alert alert-info" style={{ marginBottom: 10 }}>
          <Icons.Info size={14} style={{ flexShrink: 0 }} />
          {untrackedCount} site{untrackedCount !== 1 ? 's are' : ' is'} matched but not yet tracked by this platform. Click "Adopt" to run the host test and add them.
        </div>
      )}

      <div className="table-wrap">
        {visible.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div className="empty-state-text">No proxy hosts found</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>FQDN</th>
                <th>Forward host</th>
                <th className="num">Port</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, idx) => {
                const isDisabled = !e.enabled;
                const adoptState = adopting[e.fqdn];
                const adoptResult = adoptResults[e.fqdn];
                return (
                  <>
                    <tr key={idx} className={isDisabled ? 'tr-disc-disabled' : ''}>
                      <td>
                        <span className="mono" style={{ fontSize: '0.78rem' }}>{e.fqdn || e.fqdns?.join(', ') || '—'}</span>
                        {isDisabled && <span className="badge badge-muted" style={{ marginLeft: 6 }}>Disabled</span>}
                        {e.status === 'matched' && e.tracked && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Tracked</span>}
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--muted2)' }}>{e.forward_host}</span>
                      </td>
                      <td className="num" style={{ fontSize: '0.75rem' }}>{e.forward_port}</td>
                      <td><StatusBadge status={e.status} /></td>
                      <td>
                        {e.status === 'matched' && !e.tracked && (
                          <button
                            className="btn btn-pri btn-sm"
                            onClick={() => onAdopt(e)}
                            disabled={adoptState === 'running' || adoptState === 'ok'}
                          >
                            {adoptState === 'running'
                              ? <><Icons.Loader size={11} className="spin" /> Adopting…</>
                              : adoptState === 'ok'
                              ? <><Icons.Check size={11} /> Adopted</>
                              : <><Icons.Download size={11} /> Adopt</>}
                          </button>
                        )}
                        {e.status === 'matched' && e.tracked && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{e.host_name}</span>
                        )}
                        {e.status === 'no_host' && (
                          <button
                            className="btn btn-sec btn-sm"
                            onClick={() => navigate('/admin/hosts', {
                              state: { prefill: { hostname: e.forward_host, name: e.forward_host.split('.')[0] } }
                            })}
                            title={`Add host: ${e.forward_host}`}
                          >
                            <Icons.Server size={11} /> Add host
                          </button>
                        )}
                      </td>
                    </tr>
                    {adoptResult && (
                      <tr key={`${idx}-result`} className={isDisabled ? 'tr-disc-disabled' : ''}>
                        <td colSpan={5} style={{ paddingTop: 0, paddingBottom: 8 }}>
                          <AdoptResult result={adoptResult} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Cloudflare table ──────────────────────────────────────────────────────────

function CloudflareTable({ entries, publicIp }) {
  const [filter, setFilter] = useState('all');

  const visible = entries.filter(e => {
    if (filter === 'ok')       return e.status === 'ok';
    if (filter === 'no_nginx') return e.status === 'no_nginx';
    return true;
  });

  const noNginxCount = entries.filter(e => e.status === 'no_nginx').length;

  const exportCsv = () => downloadCsv(
    `discovery-cloudflare-${csvDate()}.csv`,
    [
      { label: 'FQDN',           value: e => e.fqdn },
      { label: 'Zone',           value: e => e.zone_name },
      { label: 'Type',           value: e => e.type },
      { label: 'Content',        value: e => e.content },
      { label: 'Proxied',        value: e => (e.proxied ? 'yes' : 'no') },
      { label: 'Status',         value: e => e.status },
      { label: 'NGINX upstream', value: e => e.forward_host || '' },
    ],
    visible,
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>
          {entries.length} A record{entries.length !== 1 ? 's' : ''} → {publicIp || '(any)'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {[['all', 'All'], ['ok', 'In NGINX'], ['no_nginx', 'No route']].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${filter === v ? 'btn-pri' : 'btn-sec'}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
          <button className="btn btn-sm btn-sec" onClick={exportCsv} disabled={!visible.length} title="Export the rows in view to CSV">
            <Icons.Download size={12} /> CSV
          </button>
        </div>
      </div>

      {noNginxCount > 0 && (
        <div className="alert alert-info" style={{ marginBottom: 10 }}>
          <Icons.Info size={14} style={{ flexShrink: 0 }} />
          {noNginxCount} DNS record{noNginxCount !== 1 ? 's' : ''} point to your public IP but have no NGINX proxy route.
          Create a site request or add the route manually in NGINX Proxy Manager.
        </div>
      )}

      <div className="table-wrap">
        {visible.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div className="empty-state-text">No matching DNS records</div>
            <div className="empty-state-sub">
              {!publicIp
                ? 'Set a public IP above and run discovery again.'
                : `No Cloudflare A records point to ${publicIp}.`}
            </div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>FQDN</th>
                <th>Zone</th>
                <th>Proxied</th>
                <th>Status</th>
                <th>NGINX upstream</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, idx) => (
                <tr key={idx}>
                  <td><span className="mono" style={{ fontSize: '0.78rem' }}>{e.fqdn}</span></td>
                  <td><span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{e.zone_name}</span></td>
                  <td>
                    {e.proxied
                      ? <span className="badge badge-orange" style={{ fontSize: '0.65rem' }}>Proxied</span>
                      : <span className="badge badge-muted"  style={{ fontSize: '0.65rem' }}>DNS only</span>}
                  </td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>
                    {e.status === 'ok' && e.forward_host
                      ? <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{e.forward_host}</span>
                      : <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Discovery() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  const [publicIp, setPublicIp]       = useState('');
  const [savingIp, setSavingIp]       = useState(false);
  const [ipSaved, setIpSaved]         = useState(false);
  const [running, setRunning]         = useState(false);
  const [result, setResult]           = useState(null);
  const [loadingResult, setLoadingResult] = useState(true);
  const [activeTab, setActiveTab]     = useState('nginx');
  const [adopting, setAdopting]       = useState({});   // fqdn → 'running'|'ok'|'fail'
  const [adoptResults, setAdoptResults] = useState({}); // fqdn → response

  // Load config + latest result on mount
  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      api.get('/admin/discovery/config', accessToken),
      api.get('/admin/discovery/latest', accessToken),
    ]).then(([cfg, latest]) => {
      setPublicIp(cfg?.publicIp || '');
      setResult(latest || null);
    }).catch(() => {}).finally(() => setLoadingResult(false));
  }, [accessToken]);

  const saveIp = async () => {
    setSavingIp(true);
    try {
      await api.post('/admin/discovery/config', { publicIp }, accessToken);
      setIpSaved(true);
      setTimeout(() => setIpSaved(false), 2000);
    } catch (e) { alert(e.message); }
    finally { setSavingIp(false); }
  };

  const handleAdopt = async (entry) => {
    const { fqdn, host_id, forward_port } = entry;
    setAdopting(s => ({ ...s, [fqdn]: 'running' }));
    try {
      const res = await api.post('/admin/discovery/adopt', { fqdn, host_id, forward_port }, accessToken);
      setAdopting(s => ({ ...s, [fqdn]: 'ok' }));
      setAdoptResults(s => ({ ...s, [fqdn]: res }));
      // Mark as tracked in local result state
      setResult(r => r ? {
        ...r,
        nginx_entries: r.nginx_entries.map(e => e.fqdn === fqdn ? { ...e, tracked: true } : e),
      } : r);
    } catch (e) {
      setAdopting(s => ({ ...s, [fqdn]: 'fail' }));
      setAdoptResults(s => ({ ...s, [fqdn]: { ok: false, testResult: { ok: false, checks: [], message: e.message } } }));
    }
  };

  const runDiscovery = async () => {
    setRunning(true);
    try {
      // Always persist the current IP before running so the scan uses the latest value
      await api.post('/admin/discovery/config', { publicIp }, accessToken);
      const res = await api.post('/admin/discovery/run', {}, accessToken);
      setResult(res);
      // Auto-switch to the section with issues
      if ((res.stats?.cf_no_nginx || 0) > 0) setActiveTab('cloudflare');
      else setActiveTab('nginx');
    } catch (e) { alert(e.message); }
    finally { setRunning(false); }
  };

  const stats = result?.stats || {};

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Discovery</h1>
          <span className="page-subtitle">Scan NGINX and Cloudflare to find sites not yet in the platform.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri btn-sm" onClick={runDiscovery} disabled={running}>
            {running ? <Icons.Loader size={14} className="spin" /> : <Icons.Scan size={14} />}
            {running ? 'Scanning…' : 'Run Discovery'}
          </button>
        </div>
      </div>

      {/* Public IP config */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__body">
          <PublicIpField
            value={publicIp}
            onChange={setPublicIp}
            onSave={saveIp}
            saving={savingIp}
            saved={ipSaved}
          />
        </div>
      </div>

      {/* Last run meta */}
      {result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted2)' }}>
            Last scan: {relTime(result.ts)} · {stats.nginx_total || 0} NGINX hosts · {stats.cf_total || 0} CF records
          </span>
          {result.errors?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {result.errors.map((e, i) => (
                <span key={i} className="badge badge-orange" style={{ fontSize: '0.65rem' }}>
                  <Icons.AlertTriangle size={10} style={{ marginRight: 3 }} />
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {loadingResult ? (
        <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>
      ) : !result ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icons.Scan size={28} /></div>
          <div className="empty-state-text">No discovery data yet</div>
          <div className="empty-state-sub">Set your public IP above and click "Run Discovery" to scan NGINX and Cloudflare.</div>
        </div>
      ) : (
        <div>
          {/* Summary cards */}
          <div className="mon-stats" style={{ marginBottom: 16 }}>
            <div className="mon-stat">
              <div className="mon-stat-n">{stats.nginx_total || 0}</div>
              <div className="mon-stat-l">NGINX hosts</div>
            </div>
            <div className={`mon-stat ${stats.nginx_matched > 0 ? 'mon-stat-ok' : ''}`}>
              <div className="mon-stat-n">{stats.nginx_matched || 0}</div>
              <div className="mon-stat-l">Matched</div>
            </div>
            {(stats.nginx_no_host || 0) > 0 && (
              <div className="mon-stat mon-stat-down">
                <div className="mon-stat-n">{stats.nginx_no_host}</div>
                <div className="mon-stat-l">No host</div>
              </div>
            )}
            <div className="mon-stat" style={{ marginLeft: 'auto' }}>
              <div className="mon-stat-n">{stats.cf_total || 0}</div>
              <div className="mon-stat-l">CF records</div>
            </div>
            <div className={`mon-stat ${stats.cf_ok > 0 ? 'mon-stat-ok' : ''}`}>
              <div className="mon-stat-n">{stats.cf_ok || 0}</div>
              <div className="mon-stat-l">In NGINX</div>
            </div>
            {(stats.cf_no_nginx || 0) > 0 && (
              <div className="mon-stat mon-stat-down">
                <div className="mon-stat-n">{stats.cf_no_nginx}</div>
                <div className="mon-stat-l">No route</div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
            {[
              { key: 'nginx',      label: 'NGINX Proxy Hosts', count: stats.nginx_total, warn: stats.nginx_no_host },
              { key: 'cloudflare', label: 'Cloudflare DNS',    count: stats.cf_total,    warn: stats.cf_no_nginx },
            ].map(tab => (
              <button
                key={tab.key}
                className={`disc-tab${activeTab === tab.key ? ' disc-tab-active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                <span className="disc-tab-count">{tab.count || 0}</span>
                {(tab.warn || 0) > 0 && (
                  <span className="badge badge-orange" style={{ fontSize: '0.6rem', padding: '1px 5px' }}>{tab.warn}</span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'nginx' && (
            <NginxTable
              entries={result.nginx_entries || []}
              navigate={navigate}
              onAdopt={handleAdopt}
              adopting={adopting}
              adoptResults={adoptResults}
            />
          )}
          {activeTab === 'cloudflare' && (
            <CloudflareTable entries={result.cf_entries || []} publicIp={result.public_ip} />
          )}
        </div>
      )}
    </div>
  );
}
