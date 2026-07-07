import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { Navigate, useLocation } from 'react-router-dom';
import { getEnv } from '../lib/env';
import api from '../lib/api';

const AuthContext = createContext(null);
const DEV_SESSION_KEY = 'ht_dev_user';
const DEV_TOKEN = 'dev-token-local';
const HA_SESSION_KEY = 'ht_session';
const HA_STATE_KEY = 'ht_ha_state';

// Which login method this deployment uses: 'home_assistant' | 'oidc'.
// Explicit AUTH_METHOD wins; otherwise infer from which provider is configured.
export function getAuthMethod() {
  const explicit = getEnv('AUTH_METHOD');
  if (explicit) return explicit;
  if (getEnv('HA_URL')) return 'home_assistant';
  if (getEnv('OIDC_AUTHORITY') && getEnv('OIDC_CLIENT_ID')) return 'oidc';
  return 'home_assistant';
}

function buildUserManager() {
  if (getAuthMethod() !== 'oidc') return null;
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

function readHaSession() {
  try {
    const s = JSON.parse(localStorage.getItem(HA_SESSION_KEY) || 'null');
    if (!s?.token) return null;
    const payload = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(HA_SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [devUser, setDevUser] = useState(readDevUser);
  const [haSession, setHaSession] = useState(readHaSession);
  const [loading, setLoading] = useState(true);
  const mgr = useRef(buildUserManager());

  useEffect(() => {
    const m = mgr.current;
    // OIDC setup only applies in oidc mode without an active dev session
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

  // ── Home Assistant login (HA's native OAuth flow) ──────────────────────────
  const haLogin = (returnPath) => {
    if (typeof returnPath !== 'string') returnPath = '/';  // tolerate onClick event arg
    const haUrl = getEnv('HA_URL').replace(/\/$/, '');
    if (!haUrl) return;
    const state = crypto.getRandomValues(new Uint32Array(4)).join('');
    sessionStorage.setItem(HA_STATE_KEY, JSON.stringify({ state, returnPath }));
    const clientId = `${window.location.origin}/`;
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = `${haUrl}/auth/authorize`
      + `?client_id=${encodeURIComponent(clientId)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&state=${encodeURIComponent(state)}`;
  };

  // Called by AuthCallback with the ?code & ?state HA redirected back with.
  // Returns the path to navigate to after login.
  const completeHaLogin = async (code, state) => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(HA_STATE_KEY) || 'null'); } catch { /* ignore */ }
    sessionStorage.removeItem(HA_STATE_KEY);
    if (!saved || saved.state !== state) throw new Error('Login state mismatch — try again');
    const session = await api.post('/auth/ha/login', {
      code,
      client_id: `${window.location.origin}/`,
    });
    localStorage.setItem(HA_SESSION_KEY, JSON.stringify(session));
    setHaSession(session);
    return saved.returnPath || '/';
  };

  const haLogout = () => {
    localStorage.removeItem(HA_SESSION_KEY);
    setHaSession(null);
  };

  const method = getAuthMethod();
  const login = method === 'home_assistant' ? haLogin : () => mgr.current?.signinRedirect();
  const logout = devUser ? devLogout
    : method === 'home_assistant' ? haLogout
    : () => mgr.current?.signoutRedirect();

  const profile = devUser ? {
    name: devUser.name,
    email: devUser.email,
    avatarUrl: '',
    initials: devUser.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2),
    groups: devUser.groups,
    sub: devUser.sub,
  } : haSession ? haSession.profile : user ? {
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
    loading: method === 'home_assistant' ? false : loading,
    login,
    logout,
    devLogin,
    completeHaLogin,
    authMethod: method,
    accessToken: devUser ? DEV_TOKEN : haSession ? haSession.token : (user?.access_token || null),
    isAuthenticated: devUser ? true : haSession ? true : (!!user && !user.expired),
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
