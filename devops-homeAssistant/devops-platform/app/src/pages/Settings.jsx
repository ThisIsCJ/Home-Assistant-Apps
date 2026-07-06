import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons } from '../components/Icons.jsx';
import { SKINS, FONT_SIZES, applyAppearance, saveAppearance } from '../lib/appearance.js';

const THEMES = [
  {
    id: 'dark', label: 'Dark',
    preview: (
      <div style={{ background: '#090e1a', borderRadius: 6, width: '100%', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.Moon size={20} style={{ color: '#60a5fa' }} />
      </div>
    ),
  },
  {
    id: 'light', label: 'Light',
    preview: (
      <div style={{ background: '#f8fafc', borderRadius: 6, width: '100%', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
        <Icons.Sun size={20} style={{ color: '#f59e0b' }} />
      </div>
    ),
  },
  {
    id: 'system', label: 'System',
    preview: (
      <div style={{ background: 'linear-gradient(135deg, #090e1a 50%, #f8fafc 50%)', borderRadius: 6, width: '100%', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.Monitor size={20} style={{ color: '#94a3b8' }} />
      </div>
    ),
  },
];

const SIZE_PREVIEW = { sm: '0.72rem', md: '0.88rem', lg: '1.05rem', xl: '1.25rem' };

export function Settings() {
  const { accessToken } = useAuth();
  const [theme, setTheme]       = useState('dark');
  const [skin, setSkin]         = useState('default');
  const [fontSize, setFontSize] = useState('md');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  // Load from API on mount
  useEffect(() => {
    if (!accessToken) return;
    api.get('/settings/me', accessToken).then(d => {
      if (d.theme)    setTheme(d.theme);
      if (d.skin)     setSkin(d.skin);
      if (d.fontSize) setFontSize(d.fontSize);
    }).catch(() => {});
  }, [accessToken]);

  const apply = (next) => {
    applyAppearance(next);
    saveAppearance(next);
  };

  const handleTheme = (v) => {
    setTheme(v);
    apply({ theme: v, skin, fontSize });
    save({ theme: v, skin, fontSize });
  };
  const handleSkin = (v) => {
    setSkin(v);
    apply({ theme, skin: v, fontSize });
    save({ theme, skin: v, fontSize });
  };
  const handleSize = (v) => {
    setFontSize(v);
    apply({ theme, skin, fontSize: v });
    save({ theme, skin, fontSize: v });
  };

  const save = async (prefs) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      await api.put('/settings/me', prefs, accessToken);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Appearance</h1>
          <span className="page-subtitle">Personalise the look and feel of the interface.</span>
        </div>
        {(saving || saved) && (
          <div style={{ fontSize: '0.72rem', color: saved ? 'var(--green2)' : 'var(--muted2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {saved ? <><Icons.Check size={12} /> Saved</> : 'Saving…'}
          </div>
        )}
      </div>

      {/* Theme */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__header">Theme</div>
        <div className="panel__body">
          <div className="ap-theme-grid">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`ap-card${theme === t.id ? ' ap-active' : ''}`}
                onClick={() => handleTheme(t.id)}
              >
                {t.preview}
                <span className="ap-card-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skin */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__header">Color scheme</div>
        <div className="panel__body">
          <div className="ap-skin-grid">
            {SKINS.map(s => (
              <button
                key={s.id}
                className={`ap-card ap-skin-card${skin === s.id ? ' ap-active' : ''}`}
                onClick={() => handleSkin(s.id)}
              >
                <div className="ap-dots">
                  {s.dots.map((d, i) => (
                    <span key={i} className="ap-dot" style={{ background: d }} />
                  ))}
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
              <button
                key={f.id}
                className={`ap-card${fontSize === f.id ? ' ap-active' : ''}`}
                onClick={() => handleSize(f.id)}
              >
                <div style={{ height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-3)', borderRadius: 6 }}>
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
