import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAppConfig } from '../lib/appConfig.js';
import { buildUserManager, getActiveProviderKey, debugAuthError } from './oidcConfig.js';

export function AuthCallback() {
  const navigate  = useNavigate();
  const processed = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    async function handleCallback() {
      const config = await fetchAppConfig();
      const providerKey = getActiveProviderKey();
      if (!providerKey || !config.authProviders?.length) {
        setError('No auth provider found. Check your setup.');
        setTimeout(() => navigate('/login'), 3000);
        return;
      }

      const providerCfg = config.authProviders.find(p => p.provider === providerKey);
      if (!providerCfg) {
        setError(`Provider "${providerKey}" not found in config.`);
        setTimeout(() => navigate('/login'), 3000);
        return;
      }

      const mgr = buildUserManager(providerKey, providerCfg);
      if (!mgr) {
        setError('Failed to build auth client. Check authority URL and client ID.');
        setTimeout(() => navigate('/login'), 3000);
        return;
      }

      try {
        const user = await mgr.signinRedirectCallback();
        const state = user?.state;
        const redirectTo = typeof state === 'string' && state.startsWith('/') ? state : '/app';
        navigate(redirectTo, { replace: true });
      } catch (err) {
        debugAuthError('Sign-in callback failed', err);
        const msg = err?.message || err?.error_description || String(err);
        setError(msg);
        setTimeout(() => navigate('/login'), 5000);
      }
    }

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 8 }}>Sign-in failed</div>
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', wordBreak: 'break-word', marginBottom: 12 }}>{error}</div>
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.72rem' }}>Redirecting to login…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Completing sign-in…</div>
    </div>
  );
}
