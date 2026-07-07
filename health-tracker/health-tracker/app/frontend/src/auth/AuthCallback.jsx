import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function AuthCallback() {
  const { userManager, completeHaLogin, authMethod } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;  // auth codes are single-use — guard StrictMode double-run
    ran.current = true;

    if (authMethod === 'home_assistant') {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const state = params.get('state');
      if (!code) {
        navigate('/login', { replace: true });
        return;
      }
      completeHaLogin(code, state)
        .then((returnPath) => navigate(returnPath, { replace: true }))
        .catch((e) => setError(e?.message || 'Sign-in failed'));
      return;
    }

    if (!userManager) {
      navigate('/login', { replace: true });
      return;
    }
    userManager
      .signinRedirectCallback()
      .then((user) => {
        const returnPath = user?.state || '/';
        navigate(returnPath, { replace: true });
      })
      .catch(() => navigate('/login', { replace: true }));
  }, [userManager, completeHaLogin, authMethod, location.search, navigate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: 'var(--muted2)', fontSize: '0.8rem' }}>
      {error ? (
        <>
          <span style={{ color: '#fca5a5' }}>{error}</span>
          <button className="btn" onClick={() => navigate('/login', { replace: true })}>Back to sign-in</button>
        </>
      ) : (
        'Completing sign-in…'
      )}
    </div>
  );
}
