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
  const hasOidc = !!(getEnv('OIDC_AUTHORITY') && getEnv('OIDC_CLIENT_ID'));
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

        {hasOidc ? (
          <button className="btn btn-pri w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={login}>
            Sign in with Authentik
          </button>
        ) : isDev ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-pri w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={handleDevLogin}>
              Sign in as Dev User
            </button>
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '10px 12px', fontSize: '0.72rem', color: '#fcd34d', textAlign: 'left' }}>
              <strong>Development mode</strong> — no OIDC configured. Set <code>VITE_OIDC_AUTHORITY</code> and <code>VITE_OIDC_CLIENT_ID</code> for production.
            </div>
          </div>
        ) : (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, padding: '12px 14px', fontSize: '0.74rem', color: '#fca5a5', textAlign: 'left' }}>
            <strong>Configuration required</strong><br />
            Set <code>VITE_OIDC_AUTHORITY</code> and <code>VITE_OIDC_CLIENT_ID</code> in your <code>.env</code> file to enable login.
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
