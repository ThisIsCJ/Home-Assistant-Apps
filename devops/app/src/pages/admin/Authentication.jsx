import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

const PROVIDERS = [
  {
    key: 'authentik',
    name: 'Authentik',
    color: 'blue',
    description: 'Self-hosted identity provider',
    fields: [
      { key: 'authority', label: 'Authority URL', placeholder: 'https://auth.example.com/application/o/devops/', hint: 'The OIDC issuer URL for your Authentik application.' },
      { key: 'client_id', label: 'Client ID', placeholder: 'your-client-id' },
      { key: 'client_secret', label: 'Client Secret (optional)', secret: true, placeholder: 'Leave empty for public/PKCE clients', hint: 'Not required for Authentik public clients using PKCE.' },
      { key: 'admin_group', label: 'Admin group name', placeholder: 'devops-admins', hint: 'Group claim value that grants admin access.' },
      { key: 'user_group', label: 'User group name', placeholder: 'devops-users', hint: 'Group claim value for standard access. Leave empty to allow all authenticated users.' },
    ],
    instructions: (appUrl) => [
      `In Authentik Admin → Applications → Create Application.`,
      `Set "Launch URL" to: ${appUrl}`,
      `Under "Provider" create an OAuth2/OpenID provider.`,
      `Set "Redirect URIs" to: ${appUrl}/auth/callback`,
      `Set "Signing Key" to your Authentik signing key.`,
      `Enable "Include claims in id_token".`,
      `Add a "groups" scope to include group membership.`,
      `Copy the "Client ID" and "Client Secret" into the fields above.`,
    ],
  },
  {
    key: 'microsoft',
    name: 'Microsoft (Entra ID)',
    color: 'purple',
    description: 'Azure AD / Microsoft Entra ID',
    fields: [
      { key: 'tenant_id', label: 'Tenant ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'Found in Azure portal → Microsoft Entra ID → Overview → "Tenant ID".' },
      { key: 'client_id', label: 'Application (Client) ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key: 'client_secret', label: 'Client Secret', secret: true, placeholder: '••••••••' },
      { key: 'admin_group', label: 'Admin group Object ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'Azure AD group Object ID (not the display name) for admin access.' },
      { key: 'user_group', label: 'User group Object ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'Azure AD group Object ID for standard access. Leave empty to allow all authenticated users.' },
    ],
    instructions: (appUrl) => [
      `In Azure Portal → Microsoft Entra ID → App registrations → New registration.`,
      `Set "Redirect URI" (Web) to: ${appUrl}/auth/callback`,
      `Under "Certificates & secrets" → New client secret. Copy the value (shown once).`,
      `Under "API permissions" → Add "openid", "profile", "email", and "GroupMember.Read.All".`,
      `Under "Token configuration" → Add optional claim "groups" to the ID token.`,
      `Copy the "Directory (Tenant) ID" from the app overview into the Tenant ID field above.`,
      `Copy the "Application (Client) ID" from the app overview into Client ID above.`,
      `For admin/user groups, use the Object ID (GUID) from Entra ID → Groups → your group → Properties.`,
    ],
  },
  {
    key: 'google',
    name: 'Google',
    color: 'orange',
    description: 'Google Workspace / Google OAuth',
    fields: [
      { key: 'authority', label: 'Authority URL', placeholder: 'https://accounts.google.com', hint: 'Use "https://accounts.google.com" for all Google accounts.' },
      { key: 'client_id', label: 'Client ID', placeholder: 'xxxxxx.apps.googleusercontent.com' },
      { key: 'client_secret', label: 'Client Secret', secret: true, placeholder: '••••••••' },
      { key: 'admin_group', label: 'Admin group (hd or email)', placeholder: 'admin@example.com or example.com', hint: 'Hosted domain (hd) or email for admin check. Note: standard Google OIDC does not return group claims.' },
      { key: 'user_group', label: 'Allowed domain', placeholder: 'example.com', hint: 'Restrict login to users from this hosted domain. Leave empty to allow any Google account.' },
    ],
    instructions: (appUrl) => [
      `In Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID.`,
      `Set "Application type" to "Web application".`,
      `Add "Authorized redirect URI": ${appUrl}/auth/callback`,
      `Copy the Client ID and Client Secret into the fields above.`,
      `For group-based access control, consider Google Workspace with a custom group claims setup, or use the hosted domain (hd) restriction.`,
      `Enable the "Google People API" if you need profile information.`,
    ],
  },
];

function ProviderCard({ config, onSave, onDelete, accessToken }) {
  const appUrl = window.location.origin;
  const [form, setForm] = useState({ active: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    if (config) {
      const base = { active: false, ...config, client_secret: config.client_secret ? '***' : '' };
      if (config.key === 'microsoft' && config.authority) {
        const m = config.authority.match(/login\.microsoftonline\.com\/([^/]+)\/v2\.0/);
        if (m) base.tenant_id = m[1];
      }
      setForm(base);
    }
  }, [config]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const data = { ...form };
      if (config.key === 'microsoft' && data.tenant_id) {
        data.authority = `https://login.microsoftonline.com/${data.tenant_id.trim()}/v2.0`;
      }
      await onSave(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`/admin/integrations/${config.key}/test`, form, accessToken);
      setTestResult({ ok: res.ok, msg: res.message });
    } catch (err) {
      setTestResult({ ok: false, msg: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`provider-card${form.active ? ' is-active' : ''}`}>
      <div className="provider-card-header">
        <div className={`admin-tile-icon ${config.color}`} style={{ width: 32, height: 32 }}>
          <Icons.Shield size={16} />
        </div>
        <span className="provider-card-title">{config.name}</span>
        {form.active && <span className="badge badge-green">Active</span>}
      </div>
      <div className="provider-card-body">
        <label className="provider-toggle">
          <span className="toggle-switch">
            <input type="checkbox" checked={Boolean(form.active)} onChange={e => set('active', e.target.checked)} />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </span>
          {form.active ? 'Enabled' : 'Disabled'}
        </label>

        <div className="form-section">
          {config.fields.map(field => (
            <div className="input-group" key={field.key}>
              <label className="input-label">{field.label}</label>
              <input
                className="input"
                type={field.secret ? 'password' : 'text'}
                placeholder={field.placeholder || ''}
                value={form[field.key] || ''}
                onChange={e => set(field.key, e.target.value)}
                autoComplete="off"
              />
              {field.hint && <span className="input-hint">{field.hint}</span>}
            </div>
          ))}

          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-ok' : 'alert-err'}`}>
              <StatusIcon status={testResult.ok ? 'success' : 'failed'} size={13} />
              {testResult.msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-sec btn-sm" onClick={testConn} disabled={testing}>
              {testing ? <Icons.Loader size={13} className="spin" /> : <Icons.Wifi size={13} />}
              Test
            </button>
            <button className="btn btn-pri btn-sm" onClick={save} disabled={saving}>
              {saved ? <><Icons.Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <button className="instructions-toggle" onClick={() => setShowInstructions(v => !v)}>
          <Icons.Info size={12} />
          {showInstructions ? 'Hide' : 'Setup instructions'}
          <Icons.ChevronDown size={12} style={{ transform: showInstructions ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>

        {showInstructions && (
          <div className="instructions-box">
            <ol>
              {config.instructions(appUrl).map((step, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: step.replace(/`([^`]+)`/g, '<code>$1</code>') }} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

export function Authentication() {
  const { accessToken, refreshAppConfig } = useAuth();
  const [configs, setConfigs]   = useState({});
  const [loading, setLoading]   = useState(true);

  const load = async () => {
    const data = await api.get('/config/auth-providers', accessToken);
    const map = {};
    (data.providers || []).forEach(p => { map[p._id] = p; });
    setConfigs(map);
  };

  useEffect(() => {
    if (!accessToken) return;
    load().finally(() => setLoading(false));
  }, [accessToken]);

  const save = (providerKey) => async (form) => {
    const res = await api.post(`/config/auth-providers/${providerKey}`, form, accessToken);
    setConfigs(c => ({ ...c, [providerKey]: res.provider }));
    await refreshAppConfig();
  };

  if (loading) return <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Authentication</h1>
          <span className="page-subtitle">Configure SSO providers. Multiple providers can be active simultaneously.</span>
        </div>
      </div>

      <div className="provider-grid">
        {PROVIDERS.map(p => (
          <ProviderCard
            key={p.key}
            config={{ ...p, ...(configs[p.key] || {}) }}
            onSave={save(p.key)}
            accessToken={accessToken}
          />
        ))}
      </div>
    </div>
  );
}
