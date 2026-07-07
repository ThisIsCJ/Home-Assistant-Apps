import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Halifax', 'America/Toronto', 'America/Vancouver',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw',
  'Europe/Helsinki', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
  'Asia/Seoul', 'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
  'Pacific/Honolulu',
];

export default function Profile() {
  const { accessToken, profile } = useAuth();
  const fileRef = useRef(null);

  const [form, setForm] = useState({ displayName: '', timezone: 'America/New_York' });
  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Load from DB (not just OIDC token) so we get the stored avatar + timezone
  useEffect(() => {
    if (!accessToken) return;
    api.get('/me', accessToken).then(u => {
      setForm({
        displayName: u.displayName || profile?.name || '',
        timezone: u.preferences?.timezone || 'America/New_York',
      });
      setAvatarUrl(u.avatarUrl || profile?.avatarUrl || '');
    }).catch(() => {
      if (profile) {
        setForm(f => ({ ...f, displayName: profile.name }));
        setAvatarUrl(profile.avatarUrl || '');
      }
    });
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAvatarClick = () => fileRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, WebP, or GIF).');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/me/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      setAvatarUrl(data.avatarUrl + '?t=' + Date.now()); // bust cache
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/me', {
        displayName: form.displayName,
        preferences: { timezone: form.timezone },
      }, accessToken);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const initials = form.displayName
    ? form.displayName.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
    : profile?.initials || 'U';

  return (
    <>
      <div className="page-header">
        <div className="page-title">Profile</div>
      </div>

      <div style={{ maxWidth: 560 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Icons.Profile size={13} /> Account</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Avatar upload */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={handleAvatarClick}
                  disabled={uploading}
                  title="Click to upload a new avatar"
                  style={{
                    width: 64, height: 64, borderRadius: '50%', border: '2px solid var(--border2)',
                    padding: 0, cursor: 'pointer', overflow: 'hidden', background: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {avatarUrl
                    ? <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--accent), #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
                        {initials}
                      </div>
                  }
                  {/* Hover overlay */}
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', opacity: uploading ? 1 : 0,
                    transition: 'opacity 0.15s',
                  }}
                    className="avatar-overlay"
                  >
                    {uploading
                      ? <div style={{ width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      : <Icons.Camera size={16} style={{ color: '#fff' }} />
                    }
                  </div>
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{form.displayName || profile?.name}</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--muted)', marginTop: 2 }}>{profile?.email}</div>
                <button
                  onClick={handleAvatarClick}
                  disabled={uploading}
                  style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.7rem', color: 'var(--accent)', textDecoration: 'underline' }}
                >
                  {uploading ? 'Uploading…' : 'Change avatar'}
                </button>
              </div>
            </div>

            {/* Display name */}
            <div className="input-group">
              <label className="input-label">Display Name</label>
              <input
                className="input"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>

            {/* Timezone */}
            <div className="input-group">
              <label className="input-label">Timezone</label>
              <select
                className="input"
                value={form.timezone}
                onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              >
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
              </select>
            </div>

            {error && (
              <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7 }}>
                {error}
              </div>
            )}

            <button className="btn btn-pri" style={{ alignSelf: 'flex-start' }} onClick={handleSave} disabled={saving}>
              {saved ? <><Icons.Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-header">
            <div className="card-title orange"><Icons.Info size={13} /> Health Disclaimer</div>
          </div>
          <div className="card-body" style={{ fontSize: '0.73rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
            This app is a personal health tracking tool. It is <strong>not a medical device</strong> and does not provide medical advice.
            Nutrition estimates, AI suggestions, and medication information are for personal tracking purposes only.
            Always consult a qualified healthcare provider for medical decisions.
          </div>
        </div>
      </div>

      <style>{`
        button:hover .avatar-overlay { opacity: 1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
