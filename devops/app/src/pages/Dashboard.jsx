import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons, StatusIcon } from '../components/Icons.jsx';
import { overallStatus, CheckDot } from './Status.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_BADGE = {
  success:        { cls: 'badge-green',  label: 'Success' },
  partial_success:{ cls: 'badge-orange', label: 'Partial' },
  failed:         { cls: 'badge-red',    label: 'Failed'  },
  running:        { cls: 'badge-blue',   label: 'Running' },
  pending:        { cls: 'badge-muted',  label: 'Pending' },
};

function dotClass(st) {
  if (st === 'healthy') return 'dh-healthy';
  if (st === 'warn')    return 'dh-warn';
  if (st === 'down')    return 'dh-down';
  if (st === 'off')     return 'dh-off';
  return 'dh-pending';
}

function SiteHealthSection({ accessToken }) {
  const navigate = useNavigate();
  const [sites, setSites]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/monitor/sites', accessToken)
      .then(d => setSites(d.sites || []))
      .catch(() => setSites([]))
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Only show monitored sites in the dashboard preview
  const monitored = (sites || []).filter(s => s.monitoring_enabled);

  if (!loading && monitored.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span className="card-title">Site Health</span>
        <button className="btn btn-sm btn-sec" onClick={() => navigate('/app/status')}>View all</button>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
            <Icons.Loader size={18} className="spin" style={{ color: 'var(--muted)' }} />
          </div>
        ) : (
          <div className="dash-health-grid">
            {monitored.map(site => {
              const st  = overallStatus(site);
              const url = site.checks.url;
              return (
                <div key={site.request_id} className="dh-card" onClick={() => navigate('/app/status')}>
                  <div className="dh-row">
                    <div className="dh-fqdn">{site.fqdn}</div>
                    <span className={`dh-status-dot ${dotClass(st)}`} title={st} />
                  </div>
                  <div className="dh-row">
                    <div className="chk-dots" style={{ gap: 3 }}>
                      <CheckDot result={site.checks.url}  enabled={site.check_url}  label="URL" />
                      <CheckDot result={site.checks.port} enabled={site.check_port} label="Port" />
                      <CheckDot result={site.checks.host} enabled={site.check_host} label="Host" />
                    </div>
                    {url?.latency_ms != null && (
                      <span className="dh-lat">{url.latency_ms}ms</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { accessToken, profile } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [stats, setStats]       = useState({ total: 0, success: 0, failed: 0, pending: 0 });
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/requests?limit=10', accessToken)
      .then(data => {
        setRequests(data.requests || []);
        setStats(data.stats || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  const failed = requests.filter(r => r.status === 'failed' || r.status === 'partial_success');

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Welcome back{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}</h1>
          <span className="page-subtitle">Create and track site requests using the hosts and domains assigned to you.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri" data-tour="new-request" onClick={() => navigate('/app/requests/new')}>
            <Icons.Plus size={14} /> New Site Request
          </button>
        </div>
      </div>

      <div className="kpi-grid" data-tour="kpi-grid">
        <div className="kpi">
          <div className="lbl">Total Requests</div>
          <div className="val">{loading ? '—' : stats.total ?? requests.length}</div>
          <div className="sub">all time</div>
        </div>
        <div className="kpi">
          <div className="lbl">Successful</div>
          <div className="val green">{loading ? '—' : stats.success ?? 0}</div>
          <div className="sub">fully provisioned</div>
        </div>
        <div className="kpi">
          <div className="lbl">Failed / Partial</div>
          <div className="val orange">{loading ? '—' : (stats.failed ?? 0) + (stats.partial ?? 0)}</div>
          <div className="sub">need attention</div>
        </div>
        <div className="kpi">
          <div className="lbl">In Progress</div>
          <div className="val">{loading ? '—' : stats.pending ?? 0}</div>
          <div className="sub">currently running</div>
        </div>
      </div>

      {failed.length > 0 && (
        <div className="alert alert-warn mb-3" style={{marginBottom:12}}>
          <Icons.AlertTriangle size={14} style={{flexShrink:0,marginTop:2}} />
          <div>
            <strong>{failed.length} request{failed.length > 1 ? 's' : ''} need{failed.length === 1 ? 's' : ''} attention</strong> — one or more automation steps failed.{' '}
            <span style={{cursor:'pointer', textDecoration:'underline'}} onClick={() => navigate('/app/requests')}>Review requests →</span>
          </div>
        </div>
      )}

      {accessToken && <SiteHealthSection accessToken={accessToken} />}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Requests</span>
          <button className="btn btn-sm btn-sec" onClick={() => navigate('/app/requests')}>View all</button>
        </div>
        <div className="card-body no-pad">
          {loading ? (
            <div className="empty-state">
              <Icons.Loader size={24} className="spin" style={{color:'var(--muted)'}} />
            </div>
          ) : requests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Icons.List size={32} /></div>
              <div className="empty-state-text">No requests yet</div>
              <div className="empty-state-sub">Submit your first site request to get started.</div>
              <button className="btn btn-pri btn-sm" style={{marginTop:8}} onClick={() => navigate('/app/requests/new')}>
                <Icons.Plus size={13} /> New Site Request
              </button>
            </div>
          ) : (
            <div className="table-wrap" style={{border:'none',borderRadius:0}}>
              <table>
                <thead>
                  <tr>
                    <th>FQDN</th>
                    <th>Host</th>
                    <th className="num">Port</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => {
                    const sb = STATUS_BADGE[r.status] || STATUS_BADGE.pending;
                    return (
                      <tr key={r._id} style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                        <td><span className="mono">{r.fqdn || '—'}</span></td>
                        <td style={{color:'var(--muted2)'}}>{r.host_name || r.host_id}</td>
                        <td className="num">{r.host_port}</td>
                        <td>
                          <span className={`badge ${sb.cls}`}>
                            <StatusIcon status={r.status} size={10} /> {sb.label}
                          </span>
                        </td>
                        <td style={{color:'var(--muted2)'}}>{fmtDate(r.created_at)}</td>
                        <td>
                          <Icons.ChevronRight size={14} style={{color:'var(--muted)'}} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
