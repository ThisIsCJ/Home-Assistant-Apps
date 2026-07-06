import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons, StatusIcon } from '../components/Icons.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_BADGE = {
  success:         { cls: 'badge-green',  label: 'Success'  },
  partial_success: { cls: 'badge-orange', label: 'Partial'  },
  failed:          { cls: 'badge-red',    label: 'Failed'   },
  running:         { cls: 'badge-blue',   label: 'Running'  },
  pending:         { cls: 'badge-muted',  label: 'Pending'  },
  removed:         { cls: 'badge-muted',  label: 'Removed'  },
  teardown_failed: { cls: 'badge-red',    label: 'Teardown Failed' },
};

const FILTERS = ['all', 'success', 'partial_success', 'failed', 'running', 'removed'];

export function RequestHistory() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmId, setConfirmId]   = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/requests', accessToken)
      .then(data => setRequests(data.requests || data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  const deleteRequest = async (id) => {
    setDeletingId(id);
    setConfirmId(null);
    try {
      await api.del(`/requests/${id}`, accessToken);
      setRequests(prev => prev.filter(r => r._id !== id));
    } catch (e) {
      alert(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const visible = requests.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search && !r.fqdn?.includes(search) && !r.host_name?.includes(search)) return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Request History</h1>
          <span className="page-subtitle">All site requests you have submitted.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri" onClick={() => navigate('/app/requests/new')}>
            <Icons.Plus size={14} /> New Request
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-3" style={{marginBottom:12}}>
        <div style={{position:'relative'}}>
          <Icons.Search size={13} style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',color:'var(--muted)',pointerEvents:'none'}} />
          <input className="input" placeholder="Search by FQDN or host…" value={search}
            onChange={e => setSearch(e.target.value)} style={{paddingLeft:26}} />
        </div>
        <div className="flex gap-1" style={{overflowX:'auto',WebkitOverflowScrolling:'touch',paddingBottom:2}}>
          {FILTERS.map(f => (
            <button key={f} className={`btn btn-sm ${filter === f ? 'btn-pri' : 'btn-sec'}`}
              style={{flexShrink:0}}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : STATUS_BADGE[f]?.label || f}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty-state"><Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} /></div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.List size={28} /></div>
            <div className="empty-state-text">{requests.length === 0 ? 'No requests yet' : 'No requests match'}</div>
            <div className="empty-state-sub">{requests.length === 0 ? 'Submit a new site request to see it here.' : 'Try changing the filter or search.'}</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>FQDN</th>
                <th>Host</th>
                <th className="num">Port</th>
                <th>Status</th>
                <th>Last Step</th>
                <th>Requested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const sb = STATUS_BADGE[r.status] || STATUS_BADGE.pending;
                const isDeleting = deletingId === r._id;
                const isConfirming = confirmId === r._id;
                return (
                  <tr key={r._id}>
                    <td style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                      <span className="mono">{r.fqdn || '—'}</span>
                    </td>
                    <td style={{color:'var(--muted2)',cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                      {r.host_name || r.host_id}
                    </td>
                    <td className="num" style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                      {r.host_port}
                    </td>
                    <td style={{cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                      <span className={`badge ${sb.cls}`} style={{display:'inline-flex',gap:4,alignItems:'center'}}>
                        <StatusIcon status={r.status} size={10} /> {sb.label}
                      </span>
                    </td>
                    <td style={{color:'var(--muted2)', fontSize:'0.72rem',cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                      {r.last_step || '—'}
                    </td>
                    <td style={{color:'var(--muted2)',cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)}>
                      {fmtDate(r.created_at)}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {isDeleting ? (
                        <Icons.Loader size={13} className="spin" style={{color:'var(--muted)'}} />
                      ) : isConfirming ? (
                        <span style={{display:'flex',alignItems:'center',gap:4}}>
                          <button className="btn btn-danger btn-xs" onClick={() => deleteRequest(r._id)}>Delete</button>
                          <button className="btn btn-sec btn-xs" onClick={() => setConfirmId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <span style={{display:'flex',alignItems:'center',gap:6}}>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{padding:'3px 5px'}}
                            title="Delete from history"
                            disabled={r.status === 'running'}
                            onClick={e => { e.stopPropagation(); setConfirmId(r._id); }}
                          >
                            <Icons.Trash size={13} style={{color:'var(--muted)'}} />
                          </button>
                          <Icons.ChevronRight size={14} style={{color:'var(--muted)',cursor:'pointer'}} onClick={() => navigate(`/app/requests/${r._id}`)} />
                        </span>
                      )}
                    </td>
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
