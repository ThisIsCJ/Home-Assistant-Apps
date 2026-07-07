import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import { getEnv } from '../lib/env';

export default function Login() {
  const { isAuthenticated, loading, login, devLogin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, loading, navigate]);

  const appName = getEnv('APP_NAME') || 'Health Tracker';
  const { authMethod } = useAuth();
  const hasHa = authMethod === 'home_assistant' && !!getEnv('HA_URL');
  const hasOidc = authMethod === 'oidc' && !!(getEnv('OIDC_AUTHORITY') && getEnv('OIDC_CLIENT_ID'));
  const isDev = getEnv('ENVIRONMENT') === 'development';

  const handleDevLogin = () => {
    devLogin();
    navigate('/', { replace: true });
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Icons.Heart size={26} color="#fff" />
        </div>
        <h1 className="login-title">{appName}</h1>
        <p className="login-sub">Your private health data, your way.</p>

        {hasHa ? (
          <button className="btn btn-pri w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={login}>
            Sign in with Home Assistant
          </button>
        ) : hasOidc ? (
          <button className="btn btn-pri w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={login}>
            Sign in with SSO
          </button>
        ) : isDev ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-pri w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={handleDevLogin}>
              Sign in as Dev User
            </button>
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '10px 12px', fontSize: '0.72rem', color: '#fcd34d', textAlign: 'left' }}>
              <strong>Development mode</strong> — no auth provider configured. Set <code>ha_url</code> (Home Assistant) or the OIDC options for production.
            </div>
          </div>
        ) : (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, padding: '12px 14px', fontSize: '0.74rem', color: '#fca5a5', textAlign: 'left' }}>
            <strong>Configuration required</strong><br />
            Set <code>ha_url</code> to sign in with Home Assistant, or set <code>auth_method: oidc</code> with <code>oidc_authority</code> and <code>oidc_client_id</code> for SSO login.
          </div>
        )}

        <p className="login-disclaimer">
          This app stores personal health information privately on your own server.
          It is not a medical device and does not provide medical advice.
        </p>
      </div>
    </div>
  );
}
