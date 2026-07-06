import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

function HostModal({ host, onClose, onSave }) {
  const isEdit = Boolean(host?._id);
  const blank = { name: '', hostname: '', ssh_port: 22, ssh_username: 'root', ssh_password: '', environment: '', active: true };
  const [form, setForm] = useState({ ...blank, ...(host || {}), ssh_password: '' });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

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
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Host' : 'Add Host'}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Display name *</label>
              <input className="input" placeholder="web-prod-01" value={form.name} onChange={(event) => set('name', event.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Hostname / IP *</label>
              <input className="input" placeholder="10.0.1.10" value={form.hostname} onChange={(event) => set('hostname', event.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="input-group">
              <label className="input-label">SSH port</label>
              <input className="input" type="number" value={form.ssh_port} onChange={(event) => set('ssh_port', Number(event.target.value))} />
            </div>
            <div className="input-group">
              <label className="input-label">SSH username</label>
              <input className="input" value={form.ssh_username} onChange={(event) => set('ssh_username', event.target.value)} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">SSH password {isEdit ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span> : '*'}</label>
            <input className="input" type="password" value={form.ssh_password || ''} onChange={(event) => set('ssh_password', event.target.value)} autoComplete="new-password" />
            <span className="input-hint">Used once to install the managed SSH key on the host. Leave blank on later edits unless you want to reinstall the key.</span>
          </div>

          <div className="input-group">
            <label className="input-label">Environment tag</label>
            <input className="input" placeholder="production, staging, dev" value={form.environment} onChange={(event) => set('environment', event.target.value)} />
          </div>

          <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.76rem' }}>
            <input type="checkbox" checked={form.active} onChange={(event) => set('active', event.target.checked)} />
            Active
          </label>

          <div className="alert alert-info">
            <Icons.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            After the key is installed, the app will show the exact commands to grant passwordless <span className="mono">sudo firewall-cmd</span> on that host.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={save} disabled={saving || !form.name || !form.hostname || (!isEdit && !form.ssh_password)}>
            {saving ? 'Saving…' : 'Save host'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessModal({ host, accessToken, onClose }) {
  const [grants, setGrants] = useState([]);
  const [principals, setPrincipals] = useState({ users: [], teams: [] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ principal_type: 'user', principal_id: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [grantData, principalData] = await Promise.all([
      api.get(`/admin/hosts/${host._id}/access`, accessToken),
      api.get('/admin/principals', accessToken),
    ]);
    setGrants(grantData.grants || []);
    setPrincipals(principalData || { users: [], teams: [] });
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const options = useMemo(
    () => (form.principal_type === 'team' ? principals.teams || [] : principals.users || []),
    [form.principal_type, principals]
  );

  const add = async () => {
    if (!form.principal_id) return;
    setSaving(true);
    try {
      await api.post(`/admin/hosts/${host._id}/access`, form, accessToken);
      await load();
      setForm((current) => ({ ...current, principal_id: '' }));
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (grantId) => {
    try {
      await api.del(`/admin/hosts/${host._id}/access/${grantId}`, accessToken);
      await load();
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title">Access — <span className="mono">{host.name}</span></span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Principal type</label>
              <select className="input" value={form.principal_type} onChange={(event) => setForm((current) => ({ ...current, principal_type: event.target.value, principal_id: '' }))}>
                <option value="user">User</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label className="input-label">Principal</label>
              <select className="input" value={form.principal_id} onChange={(event) => setForm((current) => ({ ...current, principal_id: event.target.value }))}>
                <option value="">Select…</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end" style={{ marginBottom: 12 }}>
            <button className="btn btn-pri btn-sm" onClick={add} disabled={saving || !form.principal_id}>
              {saving ? 'Adding…' : 'Add access'}
            </button>
          </div>

          <div className="table-wrap">
            {loading ? <div className="empty-state" style={{ padding: 16 }}><Icons.Loader size={18} className="spin" style={{ color: 'var(--muted)' }} /></div>
            : grants.length === 0 ? <div className="empty-state" style={{ padding: 16 }}><div className="empty-state-sub">No access grants yet.</div></div>
            : (
              <table>
                <thead><tr><th>Type</th><th>Principal</th><th></th></tr></thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant._id}>
                      <td><span className={`badge ${grant.principal_type === 'team' ? 'badge-purple' : 'badge-blue'}`}>{grant.principal_type}</span></td>
                      <td>{grant.principal_label || grant.principal_id}</td>
                      <td><button className="btn btn-xs btn-danger" onClick={() => remove(grant._id)}><Icons.Trash size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const CHECKLIST = [
  'SSH reachable',
  'Remote user valid',
  'Passwordless sudo for firewall-cmd',
  'firewall-cmd available',
  'curl available',
];

export function Hosts() {
  const { accessToken } = useAuth();
  const location = useLocation();
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [accessModal, setAccessModal] = useState(null);
  const [testing, setTesting] = useState({});
  const [setupResult, setSetupResult] = useState(null);
  const [readiness, setReadiness] = useState(null);

  const load = () => api.get('/admin/hosts', accessToken).then((data) => setHosts(data.hosts || data));
  useEffect(() => { if (accessToken) load().finally(() => setLoading(false)); }, [accessToken]);

  // Open add-host modal pre-filled when navigated from Discovery
  useEffect(() => {
    if (location.state?.prefill) {
      setModal(location.state.prefill);
      window.history.replaceState({}, '');
    }
  }, []);

  const save = async (form) => {
    const result = form._id
      ? await api.patch(`/admin/hosts/${form._id}`, form, accessToken)
      : await api.post('/admin/hosts', form, accessToken);
    setSetupResult(result);
    await load();
  };

  const test = async (host) => {
    setTesting((current) => ({ ...current, [host._id]: 'running' }));
    try {
      const result = await api.post(`/admin/hosts/${host._id}/test`, {}, accessToken);
      setTesting((current) => ({ ...current, [host._id]: result.ok ? 'ok' : 'fail' }));
      setReadiness({ host, ...result });
    } catch (error) {
      setTesting((current) => ({ ...current, [host._id]: 'fail' }));
      setReadiness({ host, ok: false, message: error.message, checks: [] });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Hosts</h1>
          <span className="page-subtitle">Add hosts, install the managed key, and control which users and teams can target each server.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri" onClick={() => setModal({})}>
            <Icons.Plus size={14} /> Add Host
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>
        ) : hosts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.Server size={28} /></div>
            <div className="empty-state-text">No hosts configured</div>
            <div className="empty-state-sub">Add hosts to enable site provisioning automation.</div>
          </div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Hostname</th><th className="num">SSH Port</th><th>Environment</th><th>Key</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {hosts.map((host) => {
                const testState = testing[host._id];
                return (
                  <tr key={host._id}>
                    <td style={{ fontWeight: 600 }}>{host.name}</td>
                    <td className="mono">{host.hostname}</td>
                    <td className="num">{host.ssh_port || 22}</td>
                    <td>{host.environment ? <span className="badge badge-muted">{host.environment}</span> : '—'}</td>
                    <td><span className={`badge ${host.has_managed_key ? 'badge-green' : 'badge-muted'}`}>{host.has_managed_key ? 'Installed' : 'Missing'}</span></td>
                    <td><span className={`badge ${host.active ? 'badge-green' : 'badge-muted'}`}>{host.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-sec" onClick={() => test(host)} disabled={testState === 'running'}>
                          {testState === 'running' ? <Icons.Loader size={11} className="spin" /> : testState === 'ok' ? <Icons.Check size={11} /> : testState === 'fail' ? <Icons.X size={11} /> : 'Test'}
                        </button>
                        <button className="btn btn-xs btn-sec" onClick={() => setAccessModal(host)}>Access</button>
                        <button className="btn btn-xs btn-sec" onClick={() => setModal(host)}><Icons.Edit size={11} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {setupResult?.sudo_instructions && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">Host onboarding</span>
            <button className="btn btn-xs btn-sec" onClick={() => navigator.clipboard.writeText(setupResult.sudo_instructions)}>
              <Icons.Download size={11} /> Copy
            </button>
          </div>
          <div className="card-body">
            <div className="alert alert-ok" style={{ marginBottom: 12 }}>
              <Icons.Check size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              Managed SSH key installed. Run these commands on the host to allow passwordless <span className="mono">firewall-cmd</span>.
            </div>
            <pre>{setupResult.sudo_instructions}</pre>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><span className="card-title">Host readiness requirements</span></div>
        <div className="card-body">
          <div className="checklist">
            {CHECKLIST.map((item) => (
              <div className="check-item na" key={item}>
                <Icons.Check size={13} /> {item}
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: 10 }}>
            The managed SSH key handles remote access. Passwordless <strong>sudo</strong> for <code>firewall-cmd</code> still needs the one-time commands shown after onboarding.
          </p>
        </div>
      </div>

      {readiness && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">{readiness.host.name} readiness</span>
            <span className={`badge ${readiness.ok ? 'badge-green' : 'badge-red'}`}>{readiness.ok ? 'Ready' : 'Needs attention'}</span>
          </div>
          <div className="card-body">
            <div className={`alert ${readiness.ok ? 'alert-ok' : 'alert-warn'}`} style={{ marginBottom: 12 }}>
              <Icons.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {readiness.message}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>
                  {(readiness.checks || []).map((check) => (
                    <tr key={check.name}>
                      <td>{check.name}</td>
                      <td><span className={`badge ${check.ok ? 'badge-green' : 'badge-red'}`}>{check.ok ? 'OK' : 'Fail'}</span></td>
                      <td className="mono" style={{ color: 'var(--muted2)' }}>{check.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {modal && <HostModal host={modal} onClose={() => setModal(null)} onSave={save} />}
      {accessModal && <AccessModal host={accessModal} accessToken={accessToken} onClose={() => setAccessModal(null)} />}
    </div>
  );
}
