import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

function fmtDate(d) { return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }) : '—'; }

const ACTION_COLORS = {
  create: 'badge-green',
  update: 'badge-blue',
  delete: 'badge-red',
  grant:  'badge-purple',
  revoke: 'badge-orange',
  login:  'badge-muted',
  rerun:  'badge-blue',
};

export function Audit() {
  const { accessToken } = useAuth();
  const [logs, setLogs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]   = useState(0);
  const [expanded, setExpanded] = useState(null);
  const PER_PAGE = 50;

  useEffect(() => {
    if (!accessToken) return;
    api.get('/admin/audit', accessToken)
      .then(d => setLogs(d.logs || d))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const paged = logs.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pages = Math.ceil(logs.length / PER_PAGE);

  const exportCsv = () => {
    const rows = [['Timestamp', 'Actor', 'Action', 'Target Type', 'Target ID', 'Detail']];
    logs.forEach(l => rows.push([
      fmtDate(l.created_at), l.actor_email || l.actor_user_id,
      l.action_type, l.target_type, l.target_id,
      JSON.stringify(l.detail_json || {})
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv,' + encodeURIComponent(csv);
    a.download = 'audit-log.csv';
    a.click();
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Audit Log</h1>
          <span className="page-subtitle">All configuration changes and automation events with actor and timestamp.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-sec btn-sm" onClick={exportCsv}>
            <Icons.Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <div className="empty-state"><Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} /></div>
        : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.Clock size={28} /></div>
            <div className="empty-state-text">No audit events yet</div>
            <div className="empty-state-sub">Events are recorded when users and admins take actions.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {paged.map((l, i) => (
                <Fragment key={l._id}>
                  <tr style={{cursor:'pointer'}} onClick={() => setExpanded(expanded === l._id ? null : l._id)}>
                    <td className="td-mono" style={{whiteSpace:'nowrap'}}>{fmtDate(l.created_at)}</td>
                    <td>
                      <span className="audit-actor">{l.actor_email || l.actor_user_id || 'system'}</span>
                    </td>
                    <td>
                      <span className={`badge ${ACTION_COLORS[l.action_type] || 'badge-muted'}`}>{l.action_type}</span>
                    </td>
                    <td style={{color:'var(--muted2)'}}>
                      {l.target_type && <span>{l.target_type}</span>}
                      {l.target_id && <span className="mono" style={{marginLeft:4,fontSize:'0.65rem'}}>{l.target_id}</span>}
                    </td>
                    <td>
                      <span className="audit-action truncate" style={{maxWidth:200,display:'inline-block'}}>
                        {l.summary || (l.detail_json ? JSON.stringify(l.detail_json).slice(0, 60) : '—')}
                      </span>
                    </td>
                  </tr>
                  {expanded === l._id && l.detail_json && (
                    <tr>
                      <td colSpan={5} style={{padding:'8px 12px', background:'var(--bg)'}}>
                        <pre style={{fontFamily:'JetBrains Mono',fontSize:'0.68rem',color:'var(--muted2)',whiteSpace:'pre-wrap'}}>
                          {JSON.stringify(l.detail_json, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-3" style={{marginTop:12}}>
          <span style={{fontSize:'0.7rem',color:'var(--muted)'}}>Page {page + 1} of {pages} ({logs.length} total)</span>
          <div className="flex gap-1">
            <button className="btn btn-sec btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <Icons.ChevronLeft size={13} /> Prev
            </button>
            <button className="btn btn-sec btn-sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>
              Next <Icons.ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
