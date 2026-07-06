import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons } from '../components/Icons.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

function relTime(ts) {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function overallStatus(site) {
  if (!site.monitoring_enabled) return 'off';
  const active = [
    site.check_url  && site.checks.url,
    site.check_port && site.checks.port,
    site.check_host && site.checks.host,
  ].filter(Boolean);
  if (!active.length) return 'pending';
  if (active.every(c => c.ok)) {
    // Warn if SSL expiring
    if (site.check_url && site.checks.url?.ssl_days_remaining != null && site.checks.url.ssl_days_remaining < 14) return 'warn';
    return 'healthy';
  }
  return 'down';
}

// ── Shared sub-components ─────────────────────────────────────────────────────

export function CheckDot({ result, enabled, label }) {
  if (!enabled)   return <span className="chk-dot chk-off"  title={`${label}: disabled`} />;
  if (!result)    return <span className="chk-dot chk-pend" title={`${label}: no data yet`} />;
  if (!result.ok) return <span className="chk-dot chk-down" title={`${label}: ${result.error || 'failed'}`} />;
  if (label === 'URL' && result.ssl_days_remaining != null && result.ssl_days_remaining < 14)
    return <span className="chk-dot chk-warn" title={`${label}: OK · SSL expires in ${result.ssl_days_remaining}d`} />;
  return <span className="chk-dot chk-ok" title={`${label}: OK`} />;
}

function Sparkline({ data }) {
  const W = 120, H = 28;
  if (!data || data.length < 2) {
    return <div style={{ width: W, height: H, background: 'var(--bg-3)', borderRadius: 4 }} />;
  }
  const vals = data.map(d => d.avg_latency ?? 0);
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - (v / max) * (H - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function MetricBar({ label, value }) {
  if (value == null) return null;
  const cls = value > 95 ? 'mbar-crit' : value > 85 ? 'mbar-warn' : '';
  return (
    <div className="mbar-row">
      <span className="mbar-label">{label}</span>
      <div className="mbar-track"><div className={`mbar-fill ${cls}`} style={{ width: `${value}%` }} /></div>
      <span className="mbar-val">{value}%</span>
    </div>
  );
}

// ── Site card ─────────────────────────────────────────────────────────────────

function SiteCard({ site, selected, onClick }) {
  const st = overallStatus(site);
  const url  = site.checks.url;
  const port = site.checks.port;
  const host = site.checks.host;
  const lastTs = url?.ts || port?.ts || host?.ts;

  return (
    <button
      className={`sc sc-${st}${selected ? ' sc-selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className="sc-title">{site.fqdn || '(no domain)'}</div>

      <div className="sc-row2">
        <div className="chk-dots">
          <CheckDot result={url}  enabled={site.check_url}  label="URL" />
          <CheckDot result={port} enabled={site.check_port} label="Port" />
          <CheckDot result={host} enabled={site.check_host} label="Host" />
        </div>
        {(site.host_name || site.host_port) && (
          <span className="sc-sub">
            {site.host_name}{site.host_port ? <span className="sc-port">:{site.host_port}</span> : null}
          </span>
        )}
      </div>

      <div className="sc-metrics">
        {url?.latency_ms != null && (
          <span className={`sc-metric${url.latency_ms > 2000 ? ' sc-metric-bad' : url.latency_ms > 800 ? ' sc-metric-warn' : ''}`}>
            {url.latency_ms}ms
          </span>
        )}
        {url?.ssl_days_remaining != null && (
          <span className={`sc-metric${url.ssl_days_remaining < 14 ? ' sc-metric-bad' : url.ssl_days_remaining < 30 ? ' sc-metric-warn' : ''}`}>
            SSL {url.ssl_days_remaining}d
          </span>
        )}
        {host?.cpu_pct != null && (
          <span className={`sc-metric${host.cpu_pct > 90 ? ' sc-metric-bad' : host.cpu_pct > 75 ? ' sc-metric-warn' : ''}`}>
            CPU {host.cpu_pct}%
          </span>
        )}
      </div>

      <div className="sc-foot">
        {!site.monitoring_enabled
          ? <span className="sc-status-off">Monitoring off</span>
          : <span className={`sc-status-dot sc-status-dot-${st}`} />}
        <span className="sc-time">{relTime(lastTs) || 'Not checked'}</span>
      </div>
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ site, isAdmin, onToggle, onCheckNow, onClose, accessToken, navigate }) {
  const [history, setHistory] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setHistory(null);
    api.get(`/monitor/sites/${site.request_id}/history`, accessToken)
      .then(d => setHistory(d.hourly || []))
      .catch(() => setHistory([]));
  }, [site.request_id, accessToken]);

  const toggle = async () => {
    setToggling(true);
    try { await onToggle(site.request_id, !site.monitoring_enabled); }
    finally { setToggling(false); }
  };

  const checkNow = async () => {
    setChecking(true);
    try { await onCheckNow(site.request_id); }
    finally { setTimeout(() => setChecking(false), 3000); }
  };

  const { url, port, host } = site.checks;

  return (
    <div className="sc-detail">
      <div className="sc-detail-inner">
        <div className="sc-detail-hd">
          <div>
            <div className="sc-detail-title">{site.fqdn}</div>
            <div className="sc-detail-meta">{site.host_name} · port {site.host_port}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {isAdmin && (
              <button className="btn btn-sec btn-sm" onClick={checkNow} disabled={checking}>
                {checking ? <Icons.Loader size={12} className="spin" /> : <Icons.RefreshCw size={12} />}
                {checking ? 'Checking…' : 'Check now'}
              </button>
            )}
            <button className="btn btn-sec btn-sm" onClick={() => navigate(`/app/requests/${site.request_id}`)}>
              <Icons.ExternalLink size={12} /> Request
            </button>
            <button className="icon-btn" onClick={onClose} title="Close"><Icons.X size={14} /></button>
          </div>
        </div>

        <div className="sc-detail-body">

          {/* URL + Sparkline */}
          <div className="sc-detail-col">
            <div className="detail-lbl">URL · 24h latency</div>
            {history === null
              ? <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Loading…</div>
              : <Sparkline data={history} />}
            {url && (
              <div className="detail-badges" style={{ marginTop: 8 }}>
                <span className={`badge ${url.ok ? 'badge-green' : 'badge-red'}`}>{url.http_status || (url.ok ? 'OK' : 'Fail')}</span>
                {url.ssl_valid != null && (
                  <span className={`badge ${url.ssl_valid
                    ? url.ssl_days_remaining < 14 ? 'badge-orange' : 'badge-green'
                    : 'badge-red'}`}>
                    SSL {url.ssl_valid ? `${url.ssl_days_remaining}d` : 'invalid'}
                  </span>
                )}
                {url.latency_ms != null && <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{url.latency_ms}ms</span>}
                {url.error && <span className="detail-err">{url.error}</span>}
              </div>
            )}
          </div>

          {/* Port */}
          {port && (
            <div className="sc-detail-col">
              <div className="detail-lbl">Port {site.host_port}</div>
              <div className="detail-badges">
                <span className={`badge ${port.ok ? 'badge-green' : 'badge-red'}`}>{port.ok ? 'Open' : 'Closed'}</span>
                {port.latency_ms != null && <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>{port.latency_ms}ms</span>}
                {port.error && <span className="detail-err">{port.error}</span>}
              </div>
            </div>
          )}

          {/* Host metrics */}
          {host && (
            <div className="sc-detail-col">
              <div className="detail-lbl">Host · {site.host_name}</div>
              <div className="mbar-group">
                <MetricBar label="CPU"  value={host.cpu_pct} />
                <MetricBar label="Mem"  value={host.mem_pct} />
                <MetricBar label="Disk" value={host.disk_pct} />
              </div>
              {host.error && <div className="detail-err" style={{ marginTop: 4 }}>{host.error}</div>}
            </div>
          )}

          {/* Admin controls */}
          {isAdmin && (
            <div className="sc-detail-col">
              <div className="detail-lbl">Monitoring</div>
              <label className="mini-tog" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={site.monitoring_enabled} onChange={toggle} disabled={toggling} />
                <span className="mini-tog-track" /><span className="mini-tog-thumb" />
              </label>
              <div style={{ fontSize: '0.68rem', color: 'var(--muted2)', marginTop: 4 }}>
                {site.monitoring_enabled ? `Checking every ${Math.round(site.interval_seconds / 60)}min` : 'Disabled'}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Webhook manager ───────────────────────────────────────────────────────────

const SCOPE_TYPES = [
  { value: 'all',    label: 'All sites' },
  { value: 'site',   label: 'Site' },
  { value: 'domain', label: 'Domain' },
  { value: 'host',   label: 'Host' },
  { value: 'user',   label: 'User' },
  { value: 'team',   label: 'Team' },
];

const BLANK_FORM = { name: '', url: '', enabled: true, events: ['alert', 'recovery'], scope: { type: 'all', value: null } };

function scopeLabel(scope, opts) {
  if (!scope || scope.type === 'all') return 'All sites';
  const lists = { site: opts.sites, domain: opts.domains, host: opts.hosts, user: opts.users, team: opts.teams };
  const found = (lists[scope.type] || []).find(x => x.id === scope.value);
  const prefix = SCOPE_TYPES.find(s => s.value === scope.type)?.label || scope.type;
  return found ? `${prefix}: ${found.label}` : `${prefix}${scope.value ? ': ' + scope.value : ''}`;
}

function WebhookManager({ accessToken }) {
  const [webhooks, setWebhooks] = useState([]);
  const [opts, setOpts]         = useState({ sites: [], domains: [], hosts: [], users: [], teams: [] });
  const [editing, setEditing]   = useState(null); // null | 'new' | webhook object
  const [form, setForm]         = useState(BLANK_FORM);
  const [saving, setSaving]     = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    api.get('/monitor/webhooks', accessToken).then(d => setWebhooks(d.webhooks || [])).catch(() => {});
    api.get('/monitor/scope-options', accessToken).then(setOpts).catch(() => {});
  }, [accessToken]);

  const startNew  = () => { setForm(BLANK_FORM); setEditing('new'); };
  const startEdit = wh  => { setForm({ name: wh.name, url: wh.url, enabled: wh.enabled, events: wh.events || [], scope: wh.scope || { type: 'all', value: null } }); setEditing(wh); };
  const cancel    = ()  => setEditing(null);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setScope = (k, v) => setForm(f => ({ ...f, scope: { ...f.scope, [k]: v } }));
  const toggleEvent = ev => setForm(f => ({
    ...f, events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev],
  }));

  const save = async () => {
    setSaving(true);
    try {
      if (editing === 'new') {
        const d = await api.post('/monitor/webhooks', form, accessToken);
        setWebhooks(w => [...w, d.webhook]);
      } else {
        await api.put(`/monitor/webhooks/${editing._id}`, form, accessToken);
        setWebhooks(w => w.map(x => String(x._id) === String(editing._id) ? { ...x, ...form } : x));
      }
      setEditing(null);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const del = async id => {
    setDeletingId(id);
    try {
      await api.del(`/monitor/webhooks/${id}`, accessToken);
      setWebhooks(w => w.filter(x => String(x._id) !== id));
    } catch (e) { alert(e.message); }
    finally { setDeletingId(null); }
  };

  const toggleEnabled = async wh => {
    const next = { ...wh, enabled: !wh.enabled };
    await api.put(`/monitor/webhooks/${wh._id}`, next, accessToken).catch(() => {});
    setWebhooks(w => w.map(x => String(x._id) === String(wh._id) ? next : x));
  };

  const scopeValues = { site: opts.sites, domain: opts.domains, host: opts.hosts, user: opts.users, team: opts.teams };

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--fg)' }}>Webhooks</span>
        {editing !== 'new' && (
          <button className="btn btn-sec btn-sm" onClick={startNew}>
            <Icons.Plus size={12} /> Add webhook
          </button>
        )}
      </div>

      {editing && (
        <div className="webhook-form">
          <div className="webhook-form-row">
            <div className="input-group" style={{ flex: '1 1 140px', minWidth: 0 }}>
              <label className="input-label">Name</label>
              <input className="input" placeholder="My webhook" value={form.name} onChange={e => setF('name', e.target.value)} />
            </div>
            <div className="input-group" style={{ flex: '3 1 260px', minWidth: 0 }}>
              <label className="input-label">URL</label>
              <input className="input" type="url" placeholder="https://…" value={form.url} onChange={e => setF('url', e.target.value)} />
            </div>
          </div>
          <div className="webhook-form-row">
            <div className="input-group" style={{ flex: '0 0 auto' }}>
              <label className="input-label">Events</label>
              <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
                {['alert', 'recovery'].map(ev => (
                  <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} />
                    {ev.charAt(0).toUpperCase() + ev.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div className="input-group" style={{ flex: '1 1 130px', minWidth: 0 }}>
              <label className="input-label">Scope</label>
              <select className="input" value={form.scope.type}
                onChange={e => setForm(f => ({ ...f, scope: { type: e.target.value, value: null } }))}>
                {SCOPE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {form.scope.type !== 'all' && (
              <div className="input-group" style={{ flex: '2 1 180px', minWidth: 0 }}>
                <label className="input-label">
                  {SCOPE_TYPES.find(s => s.value === form.scope.type)?.label}
                </label>
                <select className="input" value={form.scope.value || ''}
                  onChange={e => setScope('value', e.target.value || null)}>
                  <option value="">— select —</option>
                  {(scopeValues[form.scope.type] || []).map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1, flexShrink: 0 }}>
              <button className="btn btn-pri btn-sm" onClick={save} disabled={saving || !form.url}>
                {saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Save'}
              </button>
              <button className="btn btn-sec btn-sm" onClick={cancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {webhooks.length === 0 && editing !== 'new' ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)', padding: '6px 0' }}>No webhooks configured.</div>
      ) : (
        <div className="webhook-list">
          {webhooks.map(wh => (
            <div key={String(wh._id)} className={`webhook-row${wh.enabled ? '' : ' webhook-row-off'}`}>
              <div className="webhook-row-name">{wh.name || 'Unnamed'}</div>
              <div className="webhook-row-scope">{scopeLabel(wh.scope, opts)}</div>
              <div className="webhook-row-events">
                {(wh.events || []).map(ev => (
                  <span key={ev} className={`badge ${ev === 'alert' ? 'badge-red' : 'badge-green'}`}>{ev}</span>
                ))}
              </div>
              <div className="webhook-row-actions">
                <label className="mini-tog" title={wh.enabled ? 'Enabled' : 'Disabled'}>
                  <input type="checkbox" checked={!!wh.enabled} onChange={() => toggleEnabled(wh)} />
                  <span className="mini-tog-track" /><span className="mini-tog-thumb" />
                </label>
                <button className="icon-btn" onClick={() => startEdit(wh)} title="Edit"><Icons.Edit size={12} /></button>
                <button className="icon-btn" onClick={() => del(String(wh._id))} disabled={deletingId === String(wh._id)} title="Delete">
                  {deletingId === String(wh._id) ? <Icons.Loader size={12} className="spin" /> : <Icons.Trash size={12} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Status() {
  const { accessToken, profile, appConfig } = useAuth();
  const navigate = useNavigate();
  const isAdmin = Boolean(profile?.groups?.includes(appConfig?.adminGroup || ''));

  const [sites, setSites]       = useState([]);
  const [globalConfig, setGlobalConfig] = useState({ interval_seconds: 300, alert_threshold: 3 });
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgSaved, setCfgSaved] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await api.get(`/monitor/sites${isAdmin ? '?scope=all' : ''}`, accessToken);
      setSites(data.sites || []);
      if (data.globalConfig) setGlobalConfig(g => ({ ...g, ...data.globalConfig }));
    } catch { setSites([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [accessToken, isAdmin]);

  useEffect(() => { if (accessToken) load(); }, [accessToken]);

  const handleToggle = async (id, enabled) => {
    await api.patch(`/monitor/sites/${id}`, { monitoring_enabled: enabled }, accessToken);
    setSites(s => s.map(site => site.request_id === id ? { ...site, monitoring_enabled: enabled } : site));
  };

  const handleCheckNow = id => api.post(`/monitor/sites/${id}/check-now`, {}, accessToken);

  const saveConfig = async () => {
    setSavingCfg(true);
    try {
      await api.post('/monitor/config', globalConfig, accessToken);
      setCfgSaved(true); setTimeout(() => setCfgSaved(false), 2000);
    } catch (e) { alert(e.message); }
    finally { setSavingCfg(false); }
  };

  const visible = sites.filter(s => {
    if (search && !s.fqdn.toLowerCase().includes(search.toLowerCase()) && !s.host_name?.toLowerCase().includes(search.toLowerCase())) return false;
    const st = overallStatus(s);
    if (filter === 'monitored') return s.monitoring_enabled;
    if (filter === 'issues')    return s.monitoring_enabled && (st === 'down' || st === 'warn');
    return true;
  });

  const monitoredCnt = sites.filter(s => s.monitoring_enabled).length;
  const healthyCnt   = sites.filter(s => overallStatus(s) === 'healthy').length;
  const warnCnt      = sites.filter(s => overallStatus(s) === 'warn').length;
  const downCnt      = sites.filter(s => overallStatus(s) === 'down').length;

  const selectedSite = sites.find(s => s.request_id === selectedId) || null;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Site Status</h1>
          <span className="page-subtitle">Uptime monitoring for your active sites.</span>
        </div>
        <div className="page-actions">
          {isAdmin && (
            <button className="btn btn-sec btn-sm" onClick={() => setShowSettings(v => !v)}>
              <Icons.Settings size={13} /> Monitor settings
            </button>
          )}
          <button className="btn btn-sec btn-sm" onClick={() => load(true)} disabled={refreshing || loading}>
            {refreshing ? <Icons.Loader size={13} className="spin" /> : <Icons.RefreshCw size={13} />}
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Global settings panel */}
      {isAdmin && showSettings && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel__header">Monitor settings</div>
          <div className="panel__body">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="input-group" style={{ flex: '1 1 150px' }}>
                <label className="input-label">Default interval (s)</label>
                <input className="input" type="number" min="60" max="3600"
                  value={globalConfig.interval_seconds}
                  onChange={e => setGlobalConfig(c => ({ ...c, interval_seconds: Number(e.target.value) }))} />
              </div>
              <div className="input-group" style={{ flex: '1 1 120px' }}>
                <label className="input-label">Alert after N failures</label>
                <input className="input" type="number" min="1" max="20"
                  value={globalConfig.alert_threshold}
                  onChange={e => setGlobalConfig(c => ({ ...c, alert_threshold: Number(e.target.value) }))} />
              </div>
              <button className="btn btn-pri btn-sm" onClick={saveConfig} disabled={savingCfg}>
                {cfgSaved ? <><Icons.Check size={13} /> Saved</> : savingCfg ? 'Saving…' : 'Save'}
              </button>
            </div>
            <WebhookManager accessToken={accessToken} />
          </div>
        </div>
      )}

      {/* Summary stats */}
      {!loading && sites.length > 0 && (
        <div className="mon-stats">
          <div className="mon-stat"><div className="mon-stat-n">{sites.length}</div><div className="mon-stat-l">Sites</div></div>
          <div className="mon-stat"><div className="mon-stat-n">{monitoredCnt}</div><div className="mon-stat-l">Monitored</div></div>
          <div className="mon-stat mon-stat-ok"><div className="mon-stat-n">{healthyCnt}</div><div className="mon-stat-l">Healthy</div></div>
          {warnCnt  > 0 && <div className="mon-stat mon-stat-warn"><div className="mon-stat-n">{warnCnt}</div><div className="mon-stat-l">Warning</div></div>}
          {downCnt  > 0 && <div className="mon-stat mon-stat-down"><div className="mon-stat-n">{downCnt}</div><div className="mon-stat-l">Down</div></div>}
        </div>
      )}

      {/* Search + filter */}
      {!loading && sites.length > 0 && (
        <div className="table-toolbar">
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
            <Icons.Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input className="input" placeholder="Search FQDN or host…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 26 }} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all', 'All'], ['monitored', 'Monitored'], ['issues', 'Issues']].map(([v, l]) => (
              <button key={v} className={`btn btn-sm ${filter === v ? 'btn-pri' : 'btn-sec'}`} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {/* Card grid */}
      {loading ? (
        <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icons.Activity size={28} /></div>
          <div className="empty-state-text">{sites.length === 0 ? 'No active sites' : 'No sites match'}</div>
          <div className="empty-state-sub">
            {sites.length === 0
              ? 'Successfully provisioned sites appear here. Enable monitoring to track uptime.'
              : 'Try adjusting the search or filter.'}
          </div>
        </div>
      ) : (
        <>
          <div className="sc-grid">
            {visible.map(site => (
              <SiteCard
                key={site.request_id}
                site={site}
                selected={selectedId === site.request_id}
                onClick={() => setSelectedId(id => id === site.request_id ? null : site.request_id)}
              />
            ))}
          </div>

          {selectedSite && (
            <DetailPanel
              site={selectedSite}
              isAdmin={isAdmin}
              onToggle={handleToggle}
              onCheckNow={handleCheckNow}
              onClose={() => setSelectedId(null)}
              accessToken={accessToken}
              navigate={navigate}
            />
          )}
        </>
      )}
    </div>
  );
}
