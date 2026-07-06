import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

function fmtDate(d) { return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'; }
function fmtMs(s, e) {
  if (!s || !e) return null;
  const ms = new Date(e) - new Date(s);
  return ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;
}

const STATUS_BADGE = {
  success:        { cls: 'badge-green',  label: 'Success' },
  partial_success:{ cls: 'badge-orange', label: 'Partial' },
  failed:         { cls: 'badge-red',    label: 'Failed'  },
  running:        { cls: 'badge-blue',   label: 'Running' },
  pending:        { cls: 'badge-muted',  label: 'Pending' },
};

export function Runs() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!accessToken) return;
    api.get('/admin/runs', accessToken)
      .then(d => setRuns(d.runs || d))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const visible = runs.filter(r => filter === 'all' || r.final_status === filter);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Automation Runs</h1>
          <span className="page-subtitle">All site provisioning runs across all users.</span>
        </div>
      </div>

      <div className="flex gap-1 mb-3" style={{marginBottom:12, overflowX:'auto', WebkitOverflowScrolling:'touch', paddingBottom:2}}>
        {['all', 'success', 'partial_success', 'failed', 'running'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-pri' : 'btn-sec'}`} style={{flexShrink:0}} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : STATUS_BADGE[f]?.label || f}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        {loading ? <div className="empty-state"><Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} /></div>
        : visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.Terminal size={28} /></div>
            <div className="empty-state-text">No runs found</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>FQDN</th>
                <th>Initiated by</th>
                <th>Status</th>
                <th>Steps</th>
                <th>Duration</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const sb = STATUS_BADGE[r.final_status] || STATUS_BADGE.pending;
                const dur = fmtMs(r.started_at, r.ended_at);
                return (
                  <tr key={r._id} style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r.site_request_id}`)}>
                    <td className="mono">{r.fqdn || '—'}</td>
                    <td style={{color:'var(--muted2)'}}>{r.initiated_by_email || r.initiated_by}</td>
                    <td>
                      <span className={`badge ${sb.cls}`} style={{display:'inline-flex',gap:4,alignItems:'center'}}>
                        <StatusIcon status={r.final_status} size={10} /> {sb.label}
                      </span>
                    </td>
                    <td>
                      <span style={{color:'var(--green2)',fontFamily:'JetBrains Mono',fontSize:'0.71rem'}}>{r.success_count ?? 0}✓</span>
                      {(r.fail_count ?? 0) > 0 && <span style={{color:'var(--red)',fontFamily:'JetBrains Mono',fontSize:'0.71rem',marginLeft:4}}>{r.fail_count}✗</span>}
                    </td>
                    <td className="td-mono">{dur || '—'}</td>
                    <td style={{color:'var(--muted2)'}}>{fmtDate(r.started_at)}</td>
                    <td><Icons.ChevronRight size={14} style={{color:'var(--muted)'}} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
