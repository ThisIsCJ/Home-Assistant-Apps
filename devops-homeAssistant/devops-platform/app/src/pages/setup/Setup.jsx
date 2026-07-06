import { useEffect, useState } from 'react';
import { getApiBase } from '../../lib/env.js';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

// ─── Database step ────────────────────────────────────────────────────────────
function DatabaseStep({ onComplete }) {
  const [platformName, setPlatformName] = useState('DevOps Platform');
  const [testing, setTesting]           = useState(false);
  const [result, setResult]             = useState(null);

  const testConnection = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`${getApiBase()}/health`);
      const data = await res.json();
      setResult({ ok: data.ok, msg: data.ok ? 'Database is connected and healthy.' : 'API responded but DB may not be connected.' });
    } catch {
      setResult({ ok: false, msg: 'Could not reach the API. Check that the container is running.' });
    } finally {
      setTesting(false);
    }
  };

  const handleComplete = async () => {
    if (platformName.trim()) {
      await api.post('/config/site', { siteName: platformName.trim() }).catch(() => {});
    }
    onComplete({ platformName });
  };

  return (
    <div className="form-section">
      <div className="input-group">
        <label className="input-label">Platform name</label>
        <input
          className="input"
          type="text"
          placeholder="DevOps Platform"
          value={platformName}
          onChange={e => setPlatformName(e.target.value)}
        />
        <span className="input-hint">Shown in the browser tab and sidebar. You can change this later in Admin → Branding.</span>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 14 }}>
        <Icons.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        Set <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>MONGO_URI</code> in your <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>.env</code> file before starting the container. All MongoDB-compatible databases are supported.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sec btn-sm" onClick={testConnection} disabled={testing}>
          {testing ? <Icons.Loader size={13} className="spin" /> : <Icons.Wifi size={13} />}
          Test connection
        </button>
        {result && (
          <span style={{ color: result.ok ? 'var(--green2)' : 'var(--red)', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            <StatusIcon status={result.ok ? 'success' : 'failed'} size={13} />
            {result.msg}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-pri btn-sm" onClick={handleComplete}>
          <Icons.Check size={13} />
          Mark complete
        </button>
      </div>
    </div>
  );
}

// ─── Auth step ────────────────────────────────────────────────────────────────
const PROVIDERS_DEF = [
  {
    key: 'authentik',
    name: 'Authentik',
    fields: [
      { key: 'authority',     label: 'Authority URL',              placeholder: 'https://auth.example.com/application/o/devops/' },
      { key: 'client_id',     label: 'Client ID',                  placeholder: 'your-client-id' },
      { key: 'client_secret', label: 'Client Secret (optional)',   secret: true, placeholder: 'Leave empty for public/PKCE clients' },
    ],
  },
  {
    key: 'microsoft',
    name: 'Microsoft (Entra ID)',
    fields: [
      { key: 'tenant_id',     label: 'Tenant ID',                  placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'Azure portal → Microsoft Entra ID → Overview → Tenant ID.' },
      { key: 'client_id',     label: 'Application (Client) ID',    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key: 'client_secret', label: 'Client Secret',              secret: true, placeholder: '••••••••' },
    ],
  },
  {
    key: 'google',
    name: 'Google',
    fields: [
      { key: 'authority',     label: 'Authority URL',              placeholder: 'https://accounts.google.com' },
      { key: 'client_id',     label: 'Client ID',                  placeholder: 'xxxxxx.apps.googleusercontent.com' },
      { key: 'client_secret', label: 'Client Secret',              secret: true, placeholder: '••••••••' },
    ],
  },
];

function AuthStep({ onComplete }) {
  const [selected, setSelected] = useState('authentik');
  const [form, setForm]         = useState({});
  const [adminEmail, setAdminEmail] = useState('');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [err, setErr]           = useState(null);

  const def = PROVIDERS_DEF.find(p => p.key === selected);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveProvider = async () => {
    setSaving(true);
    setErr(null);
    try {
      const data = { ...form, active: true };
      if (selected === 'microsoft' && data.tenant_id) {
        data.authority = `https://login.microsoftonline.com/${data.tenant_id.trim()}/v2.0`;
      }
      await api.post(`/config/auth-providers/${selected}`, data);
      setSaved(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (adminEmail.trim()) {
      await api.post('/config/site', { adminUsers: [adminEmail.trim().toLowerCase()] }).catch(() => {});
    }
    onComplete();
  };

  return (
    <div className="form-section">
      <div className="input-group">
        <label className="input-label">Provider</label>
        <select className="input" value={selected} onChange={e => { setSelected(e.target.value); setForm({}); setSaved(false); }}>
          {PROVIDERS_DEF.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <span className="input-hint">You can configure additional providers later from Admin → Authentication.</span>
      </div>

      {def?.fields.map(f => (
        <div className="input-group" key={f.key}>
          <label className="input-label">{f.label}</label>
          <input
            className="input"
            type={f.secret ? 'password' : 'text'}
            placeholder={f.placeholder || ''}
            value={form[f.key] || ''}
            onChange={e => set(f.key, e.target.value)}
            autoComplete="off"
          />
          {f.hint && <span className="input-hint">{f.hint}</span>}
        </div>
      ))}

      {saved && (
        <div className="input-group" style={{ marginTop: 8 }}>
          <label className="input-label">First admin email</label>
          <input
            className="input"
            type="email"
            placeholder="admin@example.com"
            value={adminEmail}
            onChange={e => setAdminEmail(e.target.value)}
            autoComplete="off"
          />
          <span className="input-hint">This person will have admin access. Add more from Admin → Branding after setup.</span>
        </div>
      )}

      {err && <div className="alert alert-err"><Icons.XCircle size={13} /> {err}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-sec btn-sm" onClick={saveProvider} disabled={saving}>
          {saved ? <><Icons.Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save provider'}
        </button>
        <button className="btn btn-pri btn-sm" onClick={handleComplete} disabled={!saved}>
          <Icons.Check size={13} />
          Mark complete
        </button>
      </div>
    </div>
  );
}

// ─── Branding step ────────────────────────────────────────────────────────────
function BrandingStep({ onComplete }) {
  return (
    <div className="form-section">
      <div className="alert alert-info" style={{ marginBottom: 14 }}>
        <Icons.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        Logo, colors, and group-based access can be configured in Admin → Branding after setup.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-pri btn-sm" onClick={onComplete}>
          <Icons.Check size={13} />
          Mark complete
        </button>
      </div>
    </div>
  );
}

// ─── Main Setup page ──────────────────────────────────────────────────────────
const STEPS = [
  { key: 'database',       label: 'Connect Database',     icon: Icons.Database,  component: DatabaseStep },
  { key: 'authentication', label: 'Configure Auth',        icon: Icons.Shield,    component: AuthStep },
  { key: 'branding',       label: 'Branding & Groups',     icon: Icons.Palette,   component: BrandingStep },
];

export function Setup() {
  const { appConfig, refreshAppConfig } = useAuth();
  const navigate = useNavigate();
  const [openStep, setOpenStep]     = useState('database');
  const [stepStatus, setStepStatus] = useState({ database: false, authentication: false, branding: false });
  const [finishing, setFinishing]   = useState(false);

  useEffect(() => {
    api.get('/config/onboarding').then(data => {
      const steps = data.steps || {};
      setStepStatus({
        database:       Boolean(steps.database?.complete),
        authentication: Boolean(steps.authentication?.complete),
        branding:       Boolean(steps.branding?.complete),
      });
    }).catch(() => {});
  }, []);

  const markComplete = async (stepKey) => {
    await api.post(`/config/onboarding/${stepKey}`, { complete: true });
    const newStatus = { ...stepStatus, [stepKey]: true };
    setStepStatus(newStatus);
    const next = STEPS.find(s => s.key !== stepKey && !newStatus[s.key]);
    if (next) setOpenStep(next.key);
  };

  const allComplete = STEPS.every(s => stepStatus[s.key]);

  const finish = async () => {
    setFinishing(true);
    await refreshAppConfig();
    navigate('/login');
  };

  return (
    <div className="setup-page">
      <div className="setup-wrap">
        <div className="setup-logo">
          <Icons.Server size={22} style={{ color: '#fff' }} />
        </div>
        <div className="setup-title">Platform Setup</div>
        <div className="setup-sub">Complete the steps below to get your platform ready. You can return to any step at any time.</div>

        <div className="setup-steps">
          {STEPS.map((step, idx) => {
            const isOpen     = openStep === step.key;
            const isComplete = stepStatus[step.key];
            const StepComp   = step.component;
            return (
              <div key={step.key} className={`setup-step${isComplete ? ' is-complete' : ''}${isOpen ? ' is-open' : ''}`}>
                <div className="setup-step-header" onClick={() => setOpenStep(isOpen ? null : step.key)}>
                  <div className="setup-step-num">
                    {isComplete ? <Icons.Check size={13} /> : idx + 1}
                  </div>
                  <div className="admin-tile-icon" style={{ width: 28, height: 28 }}>
                    <step.icon size={14} />
                  </div>
                  <span className="setup-step-title">{step.label}</span>
                  <span className={`badge ${isComplete ? 'badge-green' : 'badge-muted'}`}>
                    {isComplete ? 'Complete' : 'Incomplete'}
                  </span>
                  <Icons.ChevronDown size={14} style={{ color: 'var(--muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />
                </div>
                {isOpen && (
                  <div className="setup-step-body">
                    <StepComp onComplete={(data) => markComplete(step.key, data)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          className="btn btn-pri w-full"
          style={{ justifyContent: 'center' }}
          disabled={!allComplete || finishing}
          onClick={finish}
        >
          {finishing ? 'Finishing…' : 'Finish setup'}
        </button>

        {appConfig?.onboardingComplete && (
          <p style={{ textAlign: 'center', marginTop: 12, fontSize: '0.7rem', color: 'var(--muted)' }}>
            Setup is already complete.{' '}
            <button className="btn-link" style={{ color: 'var(--accent2)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' }} onClick={() => navigate('/admin')}>
              Go to Admin
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
