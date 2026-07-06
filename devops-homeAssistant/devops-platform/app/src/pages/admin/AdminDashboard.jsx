import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

function fmtDate(d) { return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'; }

export function AdminDashboard() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/admin/stats', accessToken)
      .then(setStats)
      .catch(() => setStats({}))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const s = stats || {};

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Admin Overview</h1>
          <span className="page-subtitle">System readiness, recent activity, and configuration status.</span>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="lbl">Users</div>
          <div className="val">{loading ? '—' : s.users ?? 0}</div>
          <div className="sub">registered</div>
        </div>
        <div className="kpi">
          <div className="lbl">Teams</div>
          <div className="val purple">{loading ? '—' : s.teams ?? 0}</div>
          <div className="sub">configured</div>
        </div>
        <div className="kpi">
          <div className="lbl">Hosts</div>
          <div className="val green">{loading ? '—' : s.hosts ?? 0}</div>
          <div className="sub">managed</div>
        </div>
        <div className="kpi">
          <div className="lbl">Domains</div>
          <div className="val">{loading ? '—' : s.domains ?? 0}</div>
          <div className="sub">configured</div>
        </div>
      </div>

      <div className="grid-2" style={{marginBottom:12}}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Integration health</span>
            <button className="btn btn-sm btn-sec" onClick={() => navigate('/admin/integrations')}>Configure</button>
          </div>
          <div className="card-body">
            {[
              { name: 'Authentik SSO', status: s.integrations?.authentik },
              { name: 'Cloudflare API', status: s.integrations?.cloudflare },
              { name: 'NGINX API',     status: s.integrations?.nginx },
            ].map(int => (
              <div className="int-row" key={int.name}>
                <div className="flex items-center gap-2">
                  <StatusIcon status={int.status || 'pending'} size={13} />
                  <span>{int.name}</span>
                </div>
                <span className={`badge ${int.status === 'success' ? 'badge-green' : int.status === 'failed' ? 'badge-red' : 'badge-muted'}`}>
                  {int.status === 'success' ? 'Connected' : int.status === 'failed' ? 'Error' : 'Not configured'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title orange">Recent failed steps</span>
            <button className="btn btn-sm btn-sec" onClick={() => navigate('/admin/runs')}>View runs</button>
          </div>
          <div className="card-body no-pad">
            {!s.recentFailures?.length ? (
              <div className="empty-state" style={{padding:'20px 16px'}}>
                <div className="empty-state-icon"><Icons.CheckCircle size={24} style={{color:'var(--green)'}} /></div>
                <div className="empty-state-text">No recent failures</div>
              </div>
            ) : (
              <table>
                <thead><tr><th>Step</th><th>FQDN</th><th>When</th></tr></thead>
                <tbody>
                  {s.recentFailures.map((f, i) => (
                    <tr key={i} style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${f.request_id}`)}>
                      <td style={{color:'var(--red)',fontWeight:600}}>{f.step}</td>
                      <td className="mono">{f.fqdn}</td>
                      <td style={{color:'var(--muted2)'}}>{fmtDate(f.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent requests</span>
          <button className="btn btn-sm btn-sec" onClick={() => navigate('/admin/runs')}>All runs</button>
        </div>
        <div className="card-body no-pad">
          {!s.recentRequests?.length ? (
            <div className="empty-state" style={{padding:'20px'}}>
              <div className="empty-state-text">No requests yet</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr><th>FQDN</th><th>By</th><th>Status</th><th>Requested</th></tr>
              </thead>
              <tbody>
                {s.recentRequests.map(r => (
                  <tr key={r._id} style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                    <td className="mono">{r.fqdn}</td>
                    <td style={{color:'var(--muted2)'}}>{r.user_email || r.user_id}</td>
                    <td><StatusIcon status={r.status} size={13} /></td>
                    <td style={{color:'var(--muted2)'}}>{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
