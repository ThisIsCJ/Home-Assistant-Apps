import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Icons } from '../components/Icons.jsx';
import { api } from '../lib/api.js';
import { SKINS, FONT_SIZES, applyAppearance, saveAppearance, loadAppearance } from '../lib/appearance.js';

const THEMES = [
  {
    id: 'dark', label: 'Dark',
    preview: (
      <div style={{ background: '#090e1a', borderRadius: 6, width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.Moon size={18} style={{ color: '#60a5fa' }} />
      </div>
    ),
  },
  {
    id: 'light', label: 'Light',
    preview: (
      <div style={{ background: '#f8fafc', borderRadius: 6, width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
        <Icons.Sun size={18} style={{ color: '#f59e0b' }} />
      </div>
    ),
  },
  {
    id: 'system', label: 'System',
    preview: (
      <div style={{ background: 'linear-gradient(135deg, #090e1a 50%, #f8fafc 50%)', borderRadius: 6, width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.Monitor size={18} style={{ color: '#94a3b8' }} />
      </div>
    ),
  },
];

const SIZE_PREVIEW = { sm: '0.72rem', md: '0.88rem', lg: '1.05rem', xl: '1.25rem' };

function AppearanceTab({ accessToken }) {
  const saved = loadAppearance();
  const [theme, setTheme]       = useState(saved.theme    || 'dark');
  const [skin, setSkin]         = useState(saved.skin     || 'default');
  const [fontSize, setFontSize] = useState(saved.fontSize || 'md');
  const [saving, setSaving]     = useState(false);
  const [didSave, setDidSave]   = useState(false);
  const saveTimer               = useRef(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/settings/me', accessToken).then(d => {
      const t = d.theme    || 'dark';
      const s = d.skin     || 'default';
      const f = d.fontSize || 'md';
      setTheme(t); setSkin(s); setFontSize(f);
      applyAppearance({ theme: t, skin: s, fontSize: f });
      saveAppearance({ theme: t, skin: s, fontSize: f });
    }).catch(() => {});
  }, [accessToken]);

  const apply = (next) => { applyAppearance(next); saveAppearance(next); };

  const scheduleSave = (next) => {
    clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.put('/settings/me', next, accessToken);
        setDidSave(true);
        setTimeout(() => setDidSave(false), 1500);
      } catch { /* silent */ }
      finally { setSaving(false); }
    }, 600);
  };

  const handleTheme = (v) => {
    setTheme(v);
    const next = { theme: v, skin, fontSize };
    apply(next); scheduleSave(next);
  };
  const handleSkin = (v) => {
    setSkin(v);
    const next = { theme, skin: v, fontSize };
    apply(next); scheduleSave(next);
  };
  const handleSize = (v) => {
    setFontSize(v);
    const next = { theme, skin, fontSize: v };
    apply(next); scheduleSave(next);
  };

  return (
    <div>
      {/* Theme */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Theme</span>
          {(saving || didSave) && (
            <span style={{ fontSize: '0.68rem', color: didSave ? 'var(--green2)' : 'var(--muted2)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {didSave ? <><Icons.Check size={11} /> Saved</> : 'Saving…'}
            </span>
          )}
        </div>
        <div className="panel__body">
          <div className="ap-theme-grid">
            {THEMES.map(t => (
              <button key={t.id} className={`ap-card${theme === t.id ? ' ap-active' : ''}`} onClick={() => handleTheme(t.id)}>
                {t.preview}
                <span className="ap-card-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skin */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel__header">Color scheme</div>
        <div className="panel__body">
          <div className="ap-skin-grid">
            {SKINS.map(s => (
              <button key={s.id} className={`ap-card ap-skin-card${skin === s.id ? ' ap-active' : ''}`} onClick={() => handleSkin(s.id)}>
                <div className="ap-dots">
                  {s.dots.map((d, i) => <span key={i} className="ap-dot" style={{ background: d }} />)}
                </div>
                <span className="ap-card-label">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Font size */}
      <div className="panel">
        <div className="panel__header">Font size</div>
        <div className="panel__body">
          <div className="ap-theme-grid">
            {FONT_SIZES.map(f => (
              <button key={f.id} className={`ap-card${fontSize === f.id ? ' ap-active' : ''}`} onClick={() => handleSize(f.id)}>
                <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', borderRadius: 6 }}>
                  <span style={{ fontSize: SIZE_PREVIEW[f.id], fontWeight: 600, color: 'var(--muted2)' }}>Aa</span>
                </div>
                <span className="ap-card-label">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Profile() {
  const { profile, logout, appConfig, accessToken } = useAuth();
  const adminGroup = appConfig?.adminGroup || '';
  const isAdmin = adminGroup && profile?.groups?.includes(adminGroup);
  const [tab, setTab] = useState('profile');

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Profile</h1>
          <span className="page-subtitle">Your account and appearance settings.</span>
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 16 }}>
        <button className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>
          <Icons.User size={13} /> Account
        </button>
        <button className={`tab${tab === 'appearance' ? ' active' : ''}`} onClick={() => setTab('appearance')}>
          <Icons.Palette size={13} /> Appearance
        </button>
      </div>

      {tab === 'profile' && (
        <>
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__header">Identity</div>
            <div className="panel__body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className="topbar-avatar" style={{ width: 52, height: 52, fontSize: '1.1rem', borderRadius: 14, flexShrink: 0 }}>
                  {profile?.initials || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{profile?.name || '—'}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{profile?.email}</div>
                  {isAdmin && <span className="badge badge-purple" style={{ marginTop: 4 }}>Admin</span>}
                </div>
              </div>
              <div className="divider" />
              <div className="meta-grid" style={{ marginTop: 12 }}>
                <div className="meta-item"><span className="meta-key">Subject</span><span className="meta-val mono" style={{ fontSize: '0.65rem' }}>{profile?.sub}</span></div>
                <div className="meta-item"><span className="meta-key">Email</span><span className="meta-val">{profile?.email}</span></div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__header" style={{ color: 'var(--purple)' }}>Group memberships</div>
            <div className="panel__body">
              {!profile?.groups?.length ? (
                <div style={{ color: 'var(--muted)', fontSize: '0.76rem' }}>No groups assigned.</div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {profile.groups.map(g => (
                    <span key={g} className={`badge ${g === adminGroup ? 'badge-purple' : 'badge-blue'}`}>{g}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel__header" style={{ color: 'var(--red)' }}>Session</div>
            <div className="panel__body">
              <p style={{ color: 'var(--muted2)', fontSize: '0.76rem', marginBottom: 14 }}>
                You are authenticated via SSO. Signing out will clear your session token.
              </p>
              <button className="btn btn-danger" onClick={logout}>
                <Icons.LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'appearance' && <AppearanceTab accessToken={accessToken} />}
    </div>
  );
}
