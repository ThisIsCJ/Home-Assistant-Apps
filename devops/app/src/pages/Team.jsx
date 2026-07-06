import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons } from '../components/Icons.jsx';

export function Team() {
  const { accessToken } = useAuth();
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/app/team', accessToken)
      .then(setTeam)
      .catch(() => setTeam({ teams: [], domains: [], hosts: [] }))
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) return <div className="empty-state"><Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} /></div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Team Access</h1>
          <span className="page-subtitle">Resources available to you through direct assignment or team membership.</span>
        </div>
      </div>

      <div className="grid-2" style={{marginBottom:12}}>
        <div className="card">
          <div className="card-header"><span className="card-title">Your teams</span></div>
          <div className="card-body no-pad">
            {!team?.teams?.length ? (
              <div className="empty-state" style={{padding:'24px 16px'}}>
                <div className="empty-state-icon"><Icons.Users size={24} /></div>
                <div className="empty-state-text">No teams</div>
                <div className="empty-state-sub">You are not a member of any team.</div>
              </div>
            ) : (
              <table>
                <thead><tr><th>Team</th><th>Description</th></tr></thead>
                <tbody>
                  {team.teams.map(t => (
                    <tr key={t._id}>
                      <td style={{fontWeight:600}}>{t.name}</td>
                      <td style={{color:'var(--muted2)'}}>{t.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title purple">Accessible domains</span></div>
          <div className="card-body no-pad">
            {!team?.domains?.length ? (
              <div className="empty-state" style={{padding:'24px 16px'}}>
                <div className="empty-state-icon"><Icons.Globe size={24} /></div>
                <div className="empty-state-text">No domains assigned</div>
                <div className="empty-state-sub">Contact an admin to get domain access.</div>
              </div>
            ) : (
              <table>
                <thead><tr><th>Domain</th><th>Access via</th></tr></thead>
                <tbody>
                  {team.domains.map(d => (
                    <tr key={d._id}>
                      <td className="mono">{d.domain_name}</td>
                      <td><span className={`badge ${d.via === 'direct' ? 'badge-blue' : 'badge-purple'}`}>{d.via}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title orange">Accessible hosts</span></div>
        <div className="card-body no-pad">
          {!team?.hosts?.length ? (
            <div className="empty-state" style={{padding:'24px 16px'}}>
              <div className="empty-state-icon"><Icons.Server size={24} /></div>
              <div className="empty-state-text">No hosts assigned</div>
              <div className="empty-state-sub">Contact an admin to get host access.</div>
            </div>
          ) : (
            <table>
              <thead><tr><th>Name</th><th>Hostname</th><th>Environment</th><th>Access via</th></tr></thead>
              <tbody>
                {team.hosts.map(h => (
                  <tr key={h._id}>
                    <td style={{fontWeight:600}}>{h.name}</td>
                    <td className="mono">{h.hostname}</td>
                    <td><span className="badge badge-muted">{h.environment || '—'}</span></td>
                    <td><span className={`badge ${h.via === 'direct' ? 'badge-blue' : 'badge-purple'}`}>{h.via}</span></td>
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
