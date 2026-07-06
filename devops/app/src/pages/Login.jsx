import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { resolveAssetUrl } from '../lib/env.js';
import { Icons } from '../components/Icons.jsx';

const PROVIDER_ICONS = {
  authentik: Icons.Shield,
  microsoft: Icons.Key,
  google:    Icons.Globe,
};

const PROVIDER_LABELS = {
  authentik: 'Sign in with Authentik',
  microsoft: 'Sign in with Microsoft',
  google:    'Sign in with Google',
};

export function Login() {
  const { login, user, appConfig } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirectTo = searchParams.get('redirectTo') || '/app';

  const providers = appConfig?.authProviders || [];
  const appName = appConfig?.appName || 'DevOps Platform';
  const logoUrl = resolveAssetUrl(appConfig?.logoUrl);

  // Auto-redirect if already logged in
  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true });
  }, [user, navigate, redirectTo]);

  // Auto-login if exactly one provider
  useEffect(() => {
    if (providers.length === 1 && !user) {
      login(providers[0].provider, redirectTo);
    }
  }, [providers, user, login, redirectTo]);

  if (!appConfig) {
    return <div className="login-page"><div style={{ color: 'var(--muted)' }}>Loading…</div></div>;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          {logoUrl
            ? <img src={logoUrl} alt={appName} style={{ width: 28, height: 28, objectFit: 'contain' }} />
            : <Icons.Server size={24} style={{ color: '#fff' }} />
          }
        </div>
        <div className="login-title">{appName}</div>
        <p className="login-sub">
          Sign in with your organization account to request and manage site provisioning.
        </p>

        {providers.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="alert alert-err" style={{ textAlign: 'left' }}>
              <Icons.AlertTriangle size={14} style={{ flexShrink: 0 }} />
              No authentication providers configured.
            </div>
            <a href="#/setup" className="btn btn-pri w-full" style={{ justifyContent: 'center', textDecoration: 'none' }}>
              <Icons.Settings size={14} />
              Complete platform setup
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {providers.map(p => {
              const Icon = PROVIDER_ICONS[p.provider] || Icons.Lock;
              const label = PROVIDER_LABELS[p.provider] || `Sign in with ${p.name}`;
              return (
                <button
                  key={p.provider}
                  className="btn btn-pri w-full"
                  onClick={() => login(p.provider, redirectTo)}
                  style={{ justifyContent: 'center' }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <p style={{ marginTop: 16, fontSize: '0.65rem', color: 'var(--muted)' }}>
          You must be a member of an authorized group to access this platform.
        </p>
      </div>
    </div>
  );
}
