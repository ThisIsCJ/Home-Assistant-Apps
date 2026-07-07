import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function AuthCallback() {
  const { userManager } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
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
  }, [userManager, navigate]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: 'var(--muted2)', fontSize: '0.8rem' }}>
      Completing sign-in…
    </div>
  );
}
