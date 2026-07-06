import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

function TeamModal({ team, users, onClose, onSave }) {
  const [form, setForm] = useState(team || { name: '', description: '', member_ids: [] });
  const [saving, setSaving] = useState(false);

  const selected = new Set(form.member_ids || []);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleMember = (memberId) => {
    setForm((current) => {
      const next = new Set(current.member_ids || []);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return { ...current, member_ids: [...next] };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (error) {
      alert(error.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span className="modal-title">{team ? 'Edit Team' : 'New Team'}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="input-group">
            <label className="input-label">Team name *</label>
            <input className="input" placeholder="platform-team" value={form.name} onChange={(event) => set('name', event.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">Description</label>
            <input className="input" placeholder="Optional description" value={form.description} onChange={(event) => set('description', event.target.value)} />
          </div>

          <div className="input-group">
            <label className="input-label">Members</label>
            {!users.length ? (
              <div className="alert alert-info">
                <Icons.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                Users appear here after they sign in through Authentik.
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr><th></th><th>Name</th><th>Email</th></tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td style={{ width: 40 }}>
                          <input type="checkbox" checked={selected.has(user.id)} onChange={() => toggleMember(user.id)} />
                        </td>
                        <td style={{ fontWeight: 600 }}>{user.display_name || user.email}</td>
                        <td style={{ color: 'var(--muted2)' }}>{user.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={save} disabled={saving || !form.name}>
            {saving ? 'Saving…' : 'Save team'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminTeams() {
  const { accessToken } = useAuth();
  const [teams, setTeams] = useState([]);
  const [principals, setPrincipals] = useState({ users: [], teams: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = async () => {
    const [teamsData, principalsData] = await Promise.all([
      api.get('/admin/teams', accessToken),
      api.get('/admin/principals', accessToken),
    ]);
    setTeams(teamsData.teams || teamsData || []);
    setPrincipals(principalsData || { users: [], teams: [] });
  };

  useEffect(() => {
    if (!accessToken) return;
    load().finally(() => setLoading(false));
  }, [accessToken]);

  const save = async (form) => {
    if (form._id) await api.patch(`/admin/teams/${form._id}`, form, accessToken);
    else await api.post('/admin/teams', form, accessToken);
    await load();
  };

  const del = async (id) => {
    if (!confirm('Delete this team?')) return;
    await api.del(`/admin/teams/${id}`, accessToken);
    await load();
  };

  const userById = useMemo(() => new Map((principals.users || []).map((user) => [user.id, user])), [principals.users]);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Teams</h1>
          <span className="page-subtitle">Organize signed-in users into teams and grant shared access to domains and hosts.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri" onClick={() => setModal({})}>
            <Icons.Plus size={14} /> New Team
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>
        : teams.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.Users size={28} /></div>
            <div className="empty-state-text">No teams yet</div>
            <div className="empty-state-sub">Create teams to grant shared domain and host access.</div>
          </div>
        ) : (
          <table>
            <thead><tr><th>Team name</th><th>Description</th><th>Members</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {teams.map((team) => {
                const members = (team.member_ids || [])
                  .map((memberId) => userById.get(memberId))
                  .filter(Boolean);

                return (
                  <tr key={team._id}>
                    <td style={{ fontWeight: 600 }}>{team.name}</td>
                    <td style={{ color: 'var(--muted2)' }}>{team.description || '—'}</td>
                    <td>
                      {!members.length ? '—' : (
                        <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                          {members.slice(0, 3).map((member) => (
                            <span key={member.id} className="badge badge-muted">{member.display_name || member.email}</span>
                          ))}
                          {members.length > 3 && <span className="badge badge-muted">+{members.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted2)' }}>{team.created_at ? new Date(team.created_at).toLocaleDateString() : '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-sec" onClick={() => setModal(team)}><Icons.Edit size={11} /></button>
                        <button className="btn btn-xs btn-danger" onClick={() => del(team._id)}><Icons.Trash size={11} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <TeamModal
          team={modal._id ? modal : null}
          users={principals.users || []}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
