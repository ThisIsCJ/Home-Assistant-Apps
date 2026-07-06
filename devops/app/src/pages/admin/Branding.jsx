import { useEffect, useRef, useState } from 'react';
import { getApiBase, resolveAssetUrl } from '../../lib/env.js';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

const DEFAULT_NAV = [
  { path: '/app',              label: 'Dashboard' },
  { path: '/app/requests/new', label: 'New Site Request' },
  { path: '/app/requests',     label: 'Request History' },
  { path: '/app/status',       label: 'Site Status' },
  { path: '/app/team',         label: 'Team Access' },
];

function navFromOrder(order) {
  if (!order?.length) return DEFAULT_NAV;
  return [...DEFAULT_NAV].sort((a, b) => {
    const ai = order.indexOf(a.path);
    const bi = order.indexOf(b.path);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

const ACCENT_PRESETS = [
  { label: 'Blue',   value: 'blue',   hex: '#3b82f6' },
  { label: 'Purple', value: 'purple', hex: '#8b5cf6' },
  { label: 'Green',  value: 'green',  hex: '#22c55e' },
  { label: 'Orange', value: 'orange', hex: '#f97316' },
  { label: 'Red',    value: 'red',    hex: '#ef4444' },
];

function ImageUploadField({ label, value, onChange, accessToken, hint }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${getApiBase()}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();
      onChange(url);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="input-group">
      <label className="input-label">{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {value && (
          <img src={resolveAssetUrl(value)} alt={label} style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-3)' }} />
        )}
        <input
          className="input"
          style={{ flex: 1 }}
          type="text"
          placeholder="https://… or upload below"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
        />
        <button
          className="btn btn-sec btn-sm"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Icons.Loader size={13} className="spin" /> : <Icons.Download size={13} />}
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
      </div>
      {hint && <span className="input-hint">{hint}</span>}
    </div>
  );
}

export function Branding() {
  const { accessToken, appConfig, refreshAppConfig } = useAuth();
  const [form, setForm]   = useState({ siteName: '', logoUrl: '', faviconUrl: '', accentColor: '', adminGroup: '' });
  const [navItems, setNavItems] = useState(DEFAULT_NAV);
  const [adminUsers, setAdminUsers] = useState([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    if (!appConfig) return;
    setForm({
      siteName:    appConfig.appName || '',
      logoUrl:     appConfig.logoUrl || '',
      faviconUrl:  appConfig.faviconUrl || '',
      accentColor: appConfig.accentColor || '',
      adminGroup:  appConfig.adminGroup || '',
    });
    setNavItems(navFromOrder(appConfig.navOrder));
    setAdminUsers(appConfig.adminUsers || []);
  }, [appConfig]);

  const moveNav = (index, dir) => {
    setNavItems(items => {
      const next = [...items];
      const swap = index + dir;
      if (swap < 0 || swap >= next.length) return items;
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/config/site', { ...form, adminUsers, navOrder: navItems.map(i => i.path) }, accessToken);
      await refreshAppConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Branding</h1>
          <span className="page-subtitle">Customize your platform's appearance and identity.</span>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Identity</span></div>
          <div className="card-body">
            <div className="form-section">
              <div className="input-group">
                <label className="input-label">Site Name</label>
                <input className="input" type="text" placeholder="DevOps Platform" value={form.siteName} onChange={e => set('siteName', e.target.value)} />
                <span className="input-hint">Shown in the browser tab and sidebar.</span>
              </div>
              <ImageUploadField
                label="Logo"
                value={form.logoUrl}
                onChange={v => set('logoUrl', v)}
                accessToken={accessToken}
                hint="Displayed in the sidebar. SVG or PNG, square format recommended."
              />
              <ImageUploadField
                label="Favicon"
                value={form.faviconUrl}
                onChange={v => set('faviconUrl', v)}
                accessToken={accessToken}
                hint="32×32 or 64×64 PNG/ICO."
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Colors</span></div>
          <div className="card-body">
            <div className="form-section">
              <div className="input-group">
                <label className="input-label">Accent color</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {ACCENT_PRESETS.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      title={p.label}
                      style={{
                        width: 28, height: 28, borderRadius: '50%', background: p.hex, border: '2px solid',
                        borderColor: form.accentColor === p.hex ? '#fff' : 'transparent',
                        cursor: 'pointer', outline: form.accentColor === p.hex ? `2px solid ${p.hex}` : 'none',
                      }}
                      onClick={() => set('accentColor', p.hex)}
                    />
                  ))}
                </div>
                <input
                  className="input"
                  type="text"
                  placeholder="#3b82f6"
                  value={form.accentColor || ''}
                  onChange={e => set('accentColor', e.target.value)}
                />
                <span className="input-hint">Hex color for buttons, links, and highlights. Leave empty for default.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Navigation order</span></div>
          <div className="card-body">
            <span className="input-hint" style={{ display: 'block', marginBottom: 10 }}>
              Drag or use the arrows to reorder items in the left sidebar.
            </span>
            <div className="nav-order-list">
              {navItems.map((item, i) => (
                <div key={item.path} className="nav-order-item">
                  <span className="nav-order-grip">
                    <Icons.Menu size={13} />
                  </span>
                  <span className="nav-order-label">{item.label}</span>
                  <div className="nav-order-btns">
                    <button className="icon-btn" disabled={i === 0} onClick={() => moveNav(i, -1)} title="Move up">
                      <Icons.ChevronUp size={13} />
                    </button>
                    <button className="icon-btn" disabled={i === navItems.length - 1} onClick={() => moveNav(i, 1)} title="Move down">
                      <Icons.ChevronDown size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Access Groups</span></div>
          <div className="card-body">
            <div className="form-section">
              <div className="input-group">
                <label className="input-label">Admin group <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input className="input" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={form.adminGroup} onChange={e => set('adminGroup', e.target.value)} />
                <span className="input-hint">For Microsoft Entra ID, use the group Object ID (GUID). All group members will have admin access. Leave empty to use the Admin Users list only.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Admin Users</span></div>
          <div className="card-body">
            <span className="input-hint" style={{ display: 'block', marginBottom: 10 }}>
              Individual email addresses with admin access. Takes precedence over group membership.
            </span>
            {adminUsers.map(email => (
              <div key={email} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ flex: 1, fontSize: '0.8rem' }}>{email}</span>
                <button
                  className="btn btn-sec btn-sm"
                  style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,0.3)', flexShrink: 0 }}
                  onClick={() => setAdminUsers(u => u.filter(x => x !== email))}
                  title="Remove"
                >
                  <Icons.XCircle size={13} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: adminUsers.length ? 8 : 0 }}>
              <input
                className="input"
                type="email"
                placeholder="user@example.com"
                value={newAdminEmail}
                onChange={e => setNewAdminEmail(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const email = newAdminEmail.trim().toLowerCase();
                    if (email && !adminUsers.includes(email)) setAdminUsers(u => [...u, email]);
                    setNewAdminEmail('');
                  }
                }}
              />
              <button
                className="btn btn-sec btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  const email = newAdminEmail.trim().toLowerCase();
                  if (email && !adminUsers.includes(email)) setAdminUsers(u => [...u, email]);
                  setNewAdminEmail('');
                }}
              >
                <Icons.Plus size={13} /> Add
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-pri" onClick={save} disabled={saving}>
          {saved ? <><Icons.Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
