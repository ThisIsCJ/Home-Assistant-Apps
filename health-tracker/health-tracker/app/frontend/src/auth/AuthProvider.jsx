import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { Navigate, useLocation } from 'react-router-dom';
import { getEnv } from '../lib/env';

const AuthContext = createContext(null);
const DEV_SESSION_KEY = 'ht_dev_user';
const DEV_TOKEN = 'dev-token-local';

function buildUserManager() {
  const authority = getEnv('OIDC_AUTHORITY');
  const clientId = getEnv('OIDC_CLIENT_ID');
  if (!authority || !clientId) return null;

  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    scope: getEnv('OIDC_SCOPE') || 'openid profile email',
    response_type: 'code',
    automaticSilentRenew: true,
    validateSubOnSilentRenew: false,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

function readDevUser() {
  try { return JSON.parse(sessionStorage.getItem(DEV_SESSION_KEY) || 'null'); } catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [devUser, setDevUser] = useState(readDevUser);
  const [loading, setLoading] = useState(true);
  const mgr = useRef(buildUserManager());

  useEffect(() => {
    const m = mgr.current;
    // Skip OIDC setup when a dev user is already active
    if (!m || devUser) { setLoading(false); return; }

    m.getUser().then((u) => {
      setUser(u);
      setLoading(false);
    });

    const onLoaded = (u) => setUser(u);
    const onUnloaded = () => setUser(null);
    m.events.addUserLoaded(onLoaded);
    m.events.addUserUnloaded(onUnloaded);
    m.events.addAccessTokenExpired(onUnloaded);

    return () => {
      m.events.removeUserLoaded(onLoaded);
      m.events.removeUserUnloaded(onUnloaded);
      m.events.removeAccessTokenExpired(onUnloaded);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const devLogin = (name = 'Dev User', email = 'dev@localhost') => {
    const u = { name, email, sub: 'dev-user-local', groups: ['admin'] };
    sessionStorage.setItem(DEV_SESSION_KEY, JSON.stringify(u));
    setDevUser(u);
  };

  const devLogout = () => {
    sessionStorage.removeItem(DEV_SESSION_KEY);
    setDevUser(null);
    setLoading(false);
  };

  const login = () => mgr.current?.signinRedirect();
  const logout = devUser ? devLogout : () => mgr.current?.signoutRedirect();

  const profile = devUser ? {
    name: devUser.name,
    email: devUser.email,
    avatarUrl: '',
    initials: devUser.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2),
    groups: devUser.groups,
    sub: devUser.sub,
  } : user ? {
    name: user.profile.name || user.profile.preferred_username || user.profile.email || 'User',
    email: user.profile.email || '',
    avatarUrl: user.profile.picture || '',
    initials: (user.profile.name || user.profile.email || 'U')
      .split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2),
    groups: user.profile.groups || [],
    sub: user.profile.sub,
  } : null;

  const value = {
    user,
    profile,
    loading,
    login,
    logout,
    devLogin,
    accessToken: devUser ? DEV_TOKEN : (user?.access_token || null),
    isAuthenticated: devUser ? true : (!!user && !user.expired),
    isDevMode: !!devUser,
    userManager: mgr.current,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: 'var(--muted2)', fontSize: '0.8rem' }}>
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
