import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }

export function AdminUsers() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tourReset, setTourReset] = useState({});

  const resetTour = useCallback(async (userId) => {
    setTourReset(s => ({ ...s, [userId]: 'loading' }));
    try {
      await api.post(`/admin/users/${userId}/reset-tour`, {}, accessToken);
      setTourReset(s => ({ ...s, [userId]: 'done' }));
      setTimeout(() => setTourReset(s => { const n = { ...s }; delete n[userId]; return n; }), 2000);
    } catch {
      setTourReset(s => { const n = { ...s }; delete n[userId]; return n; });
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/admin/users', accessToken)
      .then(d => setUsers(d.users || d))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const visible = users.filter(u =>
    !search || u.email?.includes(search) || (u.display_name || u.name || '').includes(search)
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Users</h1>
          <span className="page-subtitle">All authenticated users synced from Authentik.</span>
        </div>
      </div>

      <div style={{marginBottom:12}}>
        <div style={{position:'relative',maxWidth:280}}>
          <Icons.Search size={13} style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',color:'var(--muted)',pointerEvents:'none'}} />
          <input className="input" placeholder="Search users…" value={search}
            onChange={e => setSearch(e.target.value)} style={{paddingLeft:26}} />
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <div className="empty-state"><Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} /></div>
        : visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.User size={28} /></div>
            <div className="empty-state-text">{users.length === 0 ? 'No users yet' : 'No match'}</div>
            <div className="empty-state-sub">Users are created when they first sign in via Authentik.</div>
          </div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Groups</th><th>First seen</th><th></th></tr></thead>
            <tbody>
              {visible.map(u => {
                const resetState = tourReset[u._id];
                return (
                <tr key={u._id}>
                  <td style={{fontWeight:600}}>{u.display_name || u.name || u.email || '—'}</td>
                  <td style={{color:'var(--muted2)'}}>{u.email}</td>
                  <td><span className={`badge ${u.role === 'admin' ? 'badge-purple' : 'badge-blue'}`}>{u.role || 'user'}</span></td>
                  <td><span className={`badge ${u.status === 'active' ? 'badge-green' : 'badge-muted'}`}>{u.status || 'active'}</span></td>
                  <td>
                    <div className="flex gap-1" style={{flexWrap:'wrap'}}>
                      {(u.groups || []).slice(0, 2).map(g => <span key={g} className="badge badge-muted">{g}</span>)}
                      {(u.groups || []).length > 2 && <span className="badge badge-muted">+{u.groups.length - 2}</span>}
                    </div>
                  </td>
                  <td style={{color:'var(--muted2)'}}>{fmtDate(u.created_at)}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-sec"
                      style={{whiteSpace:'nowrap'}}
                      disabled={!!resetState}
                      onClick={() => resetTour(u._id)}
                      title="Clear this user's tour completion so it shows again on their next visit"
                    >
                      {resetState === 'loading' ? <Icons.Loader size={11} className="spin" /> : resetState === 'done' ? '✓ Reset' : 'Reset tour'}
                    </button>
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
