import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useApp, timeAgo } from '../lib/state.jsx';
import { Icons, StatusIcon } from '../components/Icons.jsx';

const EMPTY_SITE = {
  name: '', repo_url: '', branch: 'main', ssh_key_id: '',
  build_cmd: '', output_dir: '', users: [], user_can_sync: true, user_can_push: true,
};

function SiteModal({ site, keys, onClose, onSaved }) {
  const { toast } = useApp();
  const isNew = !site.id;
  const [form, setForm] = useState({ ...EMPTY_SITE, ...site, ssh_key_id: site.ssh_key_id || '' });
  const [userInput, setUserInput] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addUser = () => {
    const u = userInput.trim();
    if (u && !form.users.includes(u)) set('users', [...form.users, u]);
    setUserInput('');
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, ssh_key_id: form.ssh_key_id || null };
      if (isNew) await api.post('/sites', body);
      else await api.patch(`/sites/${site.id}`, body);
      toast('success', isNew ? 'Site created — cloning repository…' : 'Site updated');
      onSaved();
    } catch (err) {
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span className="modal-title">{isNew ? 'Add Site' : `Edit ${site.name}`}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="form-section">
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Site name</label>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="My Static Site" disabled={!isNew} />
              {!isNew && <div className="input-hint">The site id is derived from the name and cannot change.</div>}
            </div>
            <div className="input-group">
              <label className="input-label">Branch</label>
              <input className="input mono" value={form.branch} onChange={(e) => set('branch', e.target.value)} />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">GitHub repository URL</label>
            <input className="input mono" value={form.repo_url} onChange={(e) => set('repo_url', e.target.value)}
              placeholder="git@github.com:user/site.git" />
          </div>
          <div className="input-group">
            <label className="input-label">SSH key</label>
            <select className="input" value={form.ssh_key_id} onChange={(e) => set('ssh_key_id', e.target.value)}>
              <option value="">None (public HTTPS repo, read-only push will fail)</option>
              {keys.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.fingerprint?.slice(0, 20)}…)</option>)}
            </select>
            <div className="input-hint">Add keys on the SSH Keys tab. The key needs write access to push.</div>
          </div>
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Build command (optional)</label>
              <input className="input mono" value={form.build_cmd || ''} onChange={(e) => set('build_cmd', e.target.value)}
                placeholder="hugo  ·  npm ci && npm run build" />
            </div>
            <div className="input-group">
              <label className="input-label">Static output directory</label>
              <input className="input mono" value={form.output_dir || ''} onChange={(e) => set('output_dir', e.target.value)}
                placeholder="public  ·  dist  ·  _site" />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">User access (HA usernames)</label>
            <div className="flex gap-2">
              <input className="input" value={userInput} onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUser(); } }}
                placeholder="alice" />
              <button className="btn btn-sec btn-sm" onClick={addUser}><Icons.Plus size={13} /></button>
            </div>
            <div className="flex gap-1 mt-1" style={{ flexWrap: 'wrap' }}>
              {form.users.map((u) => (
                <span key={u} className="badge badge-blue" style={{ gap: 4 }}>
                  {u}
                  <button className="icon-btn" style={{ border: 'none', background: 'none', height: 'auto', minWidth: 0, padding: 0 }}
                    onClick={() => set('users', form.users.filter((x) => x !== u))}>
                    <Icons.X size={10} />
                  </button>
                </span>
              ))}
              {form.users.length === 0 && <span className="text-xs text-muted">Only admins can access this site.</span>}
            </div>
          </div>
          <div className="form-row">
            <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={form.user_can_sync} onChange={(e) => set('user_can_sync', e.target.checked)} />
              Users may sync from GitHub
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={form.user_can_push} onChange={(e) => set('user_can_push', e.target.checked)} />
              Users may push to GitHub
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={busy || !form.name.trim() || !form.repo_url.trim()} onClick={save}>
            {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.Check size={13} />}
            {isNew ? 'Create & Clone' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SitesTab({ keys }) {
  const { sites, refreshSites, toast } = useApp();
  const [editing, setEditing] = useState(null); // site object or {} for new

  const remove = async (site) => {
    if (!window.confirm(`Delete "${site.name}"? The local clone and all drafts are removed. The GitHub repository is not touched.`)) return;
    try {
      await api.del(`/sites/${site.id}`);
      toast('success', 'Site deleted');
      refreshSites();
    } catch (err) {
      toast('error', err.message);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Sites</span>
        <button className="btn btn-pri btn-sm" onClick={() => setEditing({})}>
          <Icons.Plus size={13} /> Add Site
        </button>
      </div>
      {sites.length === 0
        ? <div className="empty-state">
            <Icons.Globe size={30} className="empty-state-icon" />
            <div className="empty-state-text">No sites configured</div>
          </div>
        : <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr><th>Status</th><th>Site</th><th>Repository</th><th>Users</th><th>Synced</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td><StatusIcon status={s.status} /></td>
                    <td>
                      <div className="font-bold">{s.name}</div>
                      <div className="text-xs text-muted mono">{s.id}</div>
                    </td>
                    <td>
                      <div className="mono text-xs truncate" style={{ maxWidth: 220 }}>{s.repo_url}</div>
                      <div className="text-xs text-muted mono">{s.branch}{s.build_cmd ? ' · builds' : ''}</div>
                    </td>
                    <td>
                      {s.users.length
                        ? s.users.map((u) => <span key={u} className="badge badge-blue" style={{ marginRight: 3 }}>{u}</span>)
                        : <span className="text-xs text-muted">admins only</span>}
                    </td>
                    <td className="td-mono">{timeAgo(s.last_synced_at)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditing(s)}><Icons.Edit size={12} /></button>
                        <button className="btn btn-ghost btn-xs" title="Re-clone"
                          onClick={() => api.post(`/sites/${s.id}/reclone`).then(refreshSites).catch((e) => toast('error', e.message))}>
                          <Icons.RefreshCw size={12} />
                        </button>
                        <button className="btn btn-danger btn-xs" onClick={() => remove(s)}><Icons.Trash size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      {editing && (
        <SiteModal site={editing} keys={keys}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshSites(); }} />
      )}
    </div>
  );
}

function KeysTab({ keys, reload }) {
  const { toast } = useApp();
  const [mode, setMode] = useState(null); // 'generate' | 'import'
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(null); // key id whose public key is shown

  const submit = async () => {
    setBusy(true);
    try {
      const created = mode === 'generate'
        ? await api.post('/keys/generate', { name })
        : await api.post('/keys', { name, private_key: privateKey });
      toast('success', `Key "${created.name}" added`);
      setMode(null); setName(''); setPrivateKey('');
      setRevealed(created.id);
      reload();
    } catch (err) {
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (k) => {
    if (!window.confirm(`Delete key "${k.name}"?`)) return;
    try {
      await api.del(`/keys/${k.id}`);
      reload();
    } catch (err) {
      toast('error', err.message);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title purple">SSH Keys</span>
        <div className="flex gap-2">
          <button className="btn btn-pri btn-sm" onClick={() => setMode('generate')}>
            <Icons.Key size={13} /> Generate Key
          </button>
          <button className="btn btn-sec btn-sm" onClick={() => setMode('import')}>
            <Icons.Plus size={13} /> Import Key
          </button>
        </div>
      </div>
      <div className="card-body">
        <div className="text-sm text-muted mb-3">
          Private keys are stored on the add-on volume with restricted permissions and are never
          shown again after being saved — only the fingerprint and public key remain visible. Add
          the public key to your GitHub repository as a <b>deploy key with write access</b>.
        </div>
        {keys.length === 0 && (
          <div className="empty-state">
            <Icons.Key size={30} className="empty-state-icon" />
            <div className="empty-state-text">No SSH keys yet</div>
            <div className="empty-state-sub">Generate a key here, then add its public half to GitHub.</div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <div key={k.id} className="card" style={{ background: 'var(--bg-2)' }}>
              <div className="card-body" style={{ padding: 10 }}>
                <div className="flex items-center gap-2">
                  <Icons.Key size={14} style={{ color: 'var(--purple)' }} />
                  <span className="font-bold">{k.name}</span>
                  <span className="mono text-xs text-muted">{k.fingerprint}</span>
                  <div className="topbar-spacer" />
                  <button className="btn btn-ghost btn-xs" onClick={() => setRevealed(revealed === k.id ? null : k.id)}>
                    <Icons.Eye size={12} /> Public key
                  </button>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(k)}><Icons.Trash size={12} /></button>
                </div>
                {revealed === k.id && (
                  <div className="mt-2">
                    <textarea className="input mono text-xs" readOnly rows={3} value={k.public_key || ''}
                      onFocus={(e) => e.target.select()} />
                    <div className="input-hint mt-1">
                      GitHub → repo → Settings → Deploy keys → Add deploy key → paste this, tick "Allow write access".
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {mode && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setMode(null); }}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{mode === 'generate' ? 'Generate SSH key' : 'Import SSH key'}</span>
              <button className="icon-btn" onClick={() => setMode(null)}><Icons.X size={14} /></button>
            </div>
            <div className="form-section">
              <div className="input-group">
                <label className="input-label">Key name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="site-key-1" />
              </div>
              {mode === 'import' && (
                <div className="input-group">
                  <label className="input-label">Private key (unencrypted PEM/OpenSSH)</label>
                  <textarea className="input mono text-xs" rows={8} value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                  <div className="input-hint">The key is stored on the add-on volume and never displayed again.</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button>
              <button className="btn btn-pri" disabled={busy || !name.trim() || (mode === 'import' && !privateKey.trim())} onClick={submit}>
                {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.Check size={13} />}
                {mode === 'generate' ? 'Generate' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Admin() {
  const { sites } = useApp();
  const [tab, setTab] = useState('sites');
  const [keys, setKeys] = useState([]);
  const { toast } = useApp();

  const loadKeys = () => api.get('/keys').then(setKeys).catch((e) => toast('error', e.message));
  useEffect(() => { loadKeys(); }, []);

  const draftCount = sites.filter((s) => s.draft).length;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Admin</h1>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="lbl">Sites</div><div className="val">{sites.length}</div></div>
        <div className="kpi"><div className="lbl">SSH Keys</div><div className="val purple">{keys.length}</div></div>
        <div className="kpi"><div className="lbl">Open Drafts</div><div className={`val ${draftCount ? 'orange' : 'green'}`}>{draftCount}</div></div>
        <div className="kpi"><div className="lbl">Errors</div><div className={`val ${sites.some((s) => s.status === 'error') ? 'red' : 'green'}`}>{sites.filter((s) => s.status === 'error').length}</div></div>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'sites' ? ' active' : ''}`} onClick={() => setTab('sites')}>Sites</button>
        <button className={`tab${tab === 'keys' ? ' active' : ''}`} onClick={() => setTab('keys')}>SSH Keys</button>
      </div>

      {tab === 'sites' ? <SitesTab keys={keys} /> : <KeysTab keys={keys} reload={loadKeys} />}
    </>
  );
}
