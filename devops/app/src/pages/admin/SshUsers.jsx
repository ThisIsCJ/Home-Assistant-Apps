import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

function PrivateKeyBox({ privateKey, username }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([privateKey], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${username || 'id_ed25519'}.pem`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{marginTop:12}}>
      <div className="alert" style={{
        background:'rgba(234,179,8,0.1)',
        border:'1px solid rgba(234,179,8,0.35)',
        color:'var(--fg)',
        marginBottom:8,
      }}>
        <Icons.AlertTriangle size={14} style={{flexShrink:0, marginTop:1, color:'#ca8a04'}} />
        <span><strong>Save this private key now</strong> — it will not be shown again. The server does not store it.</span>
      </div>
      <div style={{position:'relative'}}>
        <textarea
          readOnly
          className="input"
          rows={6}
          value={privateKey}
          style={{fontFamily:'var(--font-mono)', fontSize:'0.68rem', resize:'none', paddingRight:80}}
        />
        <div style={{position:'absolute', top:6, right:6, display:'flex', gap:4}}>
          <button className="btn btn-xs btn-sec" onClick={copy}>
            {copied ? <Icons.Check size={11} /> : <Icons.Download size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn btn-xs btn-sec" onClick={download}>
            <Icons.Download size={11} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function SshUserModal({ user, onClose, onSave, accessToken }) {
  const blank = { username: '', description: '', public_key: '' };
  const [form, setForm] = useState(user || blank);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const generate = async () => {
    setGenerating(true);
    setGeneratedPrivateKey(null);
    try {
      const pair = await api.post('/admin/ssh-users/generate-key', { comment: form.username || '' }, accessToken);
      set('public_key', pair.publicKey);
      setGeneratedPrivateKey(pair.privateKey);
    } catch(e) {
      alert('Key generation failed: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch(e) { alert(e.message); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:580}}>
        <div className="modal-header">
          <span className="modal-title">{user ? 'Edit SSH User' : 'Add SSH User'}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Username *</label>
              <input
                className="input"
                style={{fontFamily:'var(--font-mono)'}}
                placeholder="deploy"
                value={form.username}
                onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              />
              <span className="input-hint">Lowercase, alphanumeric, dashes, underscores only.</span>
            </div>
            <div className="input-group">
              <label className="input-label">Description</label>
              <input
                className="input"
                placeholder="Automation deploy user"
                value={form.description}
                onChange={e => set('description', e.target.value)}
              />
            </div>
          </div>

          <div className="input-group">
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4}}>
              <label className="input-label" style={{margin:0}}>Public SSH key *</label>
              <button
                className="btn btn-xs btn-sec"
                onClick={generate}
                disabled={generating}
                type="button"
              >
                {generating
                  ? <><Icons.Loader size={11} className="spin" /> Generating…</>
                  : <><Icons.Key size={11} /> Generate key pair</>
                }
              </button>
            </div>
            <textarea
              className="input"
              rows={4}
              placeholder="ssh-ed25519 AAAA… user@host"
              style={{fontFamily:'var(--font-mono)', fontSize:'0.72rem', resize:'vertical'}}
              value={form.public_key}
              onChange={e => set('public_key', e.target.value)}
            />
            <span className="input-hint">Paste an existing public key, or use <strong>Generate key pair</strong> to create one.</span>
          </div>

          {generatedPrivateKey && (
            <PrivateKeyBox privateKey={generatedPrivateKey} username={form.username} />
          )}

          {!generatedPrivateKey && (
            <div className="alert alert-info">
              <Icons.Info size={14} style={{flexShrink:0,marginTop:1}} />
              Use the <strong>Setup Instructions</strong> on the Hosts page to generate the commands needed to provision this user on each host.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={save} disabled={saving || !form.username || !form.public_key}>
            {saving ? 'Saving…' : 'Save user'}
          </button>
        </div>
      </div>
    </div>
  );
}

function keyPreview(key) {
  if (!key) return '—';
  const parts = key.trim().split(/\s+/);
  if (parts.length >= 2) {
    const b64 = parts[1];
    return `${parts[0]} ${b64.slice(0, 8)}…${b64.slice(-8)}`;
  }
  return key.slice(0, 32) + '…';
}

export function SshUsers() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = () =>
    api.get('/admin/ssh-users', accessToken)
      .then(d => setUsers(d.users || []))
      .finally(() => setLoading(false));

  useEffect(() => { if (accessToken) load(); }, [accessToken]);

  const save = async (form) => {
    if (form._id) await api.patch(`/admin/ssh-users/${form._id}`, form, accessToken);
    else await api.post('/admin/ssh-users', form, accessToken);
    load();
  };

  const remove = async (u) => {
    if (!confirm(`Delete SSH user "${u.username}"?`)) return;
    await api.del(`/admin/ssh-users/${u._id}`, accessToken);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">SSH Users</h1>
          <span className="page-subtitle">Manage SSH users and their public keys for host provisioning.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri" onClick={() => setModal({})}>
            <Icons.Plus size={14} /> Add SSH User
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty-state">
            <Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} />
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.Key size={28} /></div>
            <div className="empty-state-text">No SSH users configured</div>
            <div className="empty-state-sub">Add SSH users to manage key-based access to your hosts.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Description</th>
                <th>Public Key</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id}>
                  <td style={{fontWeight:600, fontFamily:'var(--font-mono)'}}>{u.username}</td>
                  <td style={{color:'var(--muted)'}}>{u.description || '—'}</td>
                  <td style={{fontFamily:'var(--font-mono)', fontSize:'0.7rem', color:'var(--muted)'}}>{keyPreview(u.public_key)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-xs btn-sec" onClick={() => setModal(u)}>
                        <Icons.Edit size={11} />
                      </button>
                      <button className="btn btn-xs btn-sec" onClick={() => remove(u)} style={{color:'var(--red)'}}>
                        <Icons.Trash size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal !== null && (
        <SshUserModal
          user={modal._id ? modal : null}
          onClose={() => setModal(null)}
          onSave={save}
          accessToken={accessToken}
        />
      )}
    </div>
  );
}
