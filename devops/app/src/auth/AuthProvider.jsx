import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { resolveAssetUrl } from '../lib/env.js';
import { fetchAppConfig, invalidateAppConfig } from '../lib/appConfig.js';
import {
  buildUserManager,
  clearUserManagers,
  setActiveProvider,
  getActiveProviderKey,
  debugAuthError,
} from './oidcConfig.js';

const AuthContext = createContext(null);

// Placeholder bearer value used in Home Assistant ingress mode. The API
// ignores it (the Supervisor authenticates requests), but a non-empty token
// keeps every `if (!accessToken)` guard in the pages working unchanged.
export const HA_INGRESS_TOKEN = 'ha-ingress';

function extractProfile(user) {
  if (!user) return null;
  const p = user.profile;
  const name = p.name || p.preferred_username || p.email || 'User';
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return { sub: p.sub, name, email: p.email || '', initials, groups: p.groups || [] };
}

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(undefined); // undefined = loading
  const [profile, setProfile]     = useState(null);
  const [appConfig, setAppConfig] = useState(null);
  const managersRef               = useRef({});
  const syncedTokenRef            = useRef('');

  const getManager = useCallback((providerKey) => {
    if (!appConfig) return null;
    const providerCfg = appConfig.authProviders?.find(p => p.provider === providerKey);
    if (!providerCfg) return null;
    if (!managersRef.current[providerKey]) {
      managersRef.current[providerKey] = buildUserManager(providerKey, providerCfg);
    }
    return managersRef.current[providerKey];
  }, [appConfig]);

  const getCurrentManager = useCallback(() => {
    const key = getActiveProviderKey();
    return key ? getManager(key) : null;
  }, [getManager]);

  // Expose current manager for api.js token refresh
  useEffect(() => {
    api.setUserManagerGetter(getCurrentManager);
  }, [getCurrentManager]);

  const syncUser = useCallback(async (oidcUser) => {
    const token = oidcUser?.access_token;
    if (!token || syncedTokenRef.current === token) return;
    try {
      await api.get('/app/me', token);
      syncedTokenRef.current = token;
    } catch {
      // surface failures elsewhere
    }
  }, []);

  const applyUser = useCallback(async (u) => {
    setUser(u);
    setProfile(extractProfile(u));
    await syncUser(u);
  }, [syncUser]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const config = await fetchAppConfig();
      if (cancelled) return;
      setAppConfig(config);

      // Home Assistant ingress mode: HA has already authenticated the user;
      // ask the API who they are instead of running an OIDC flow.
      if (config.haIngress) {
        try {
          const me = await api.get('/config/whoami', HA_INGRESS_TOKEN);
          if (cancelled) return;
          await applyUser({
            access_token: HA_INGRESS_TOKEN,
            profile: { sub: me.id, name: me.name, email: me.email, groups: me.groups || [] },
          });
        } catch (err) {
          console.error('[auth] HA ingress whoami failed:', err?.message);
          if (!cancelled) setUser(null);
        }
        return;
      }

      // Rebuild managers with fresh config
      clearUserManagers();
      managersRef.current = {};

      const providerKey = getActiveProviderKey();
      if (!providerKey || !config.authProviders?.length) {
        setUser(null);
        return;
      }

      const providerCfg = config.authProviders.find(p => p.provider === providerKey);
      if (!providerCfg) { setUser(null); return; }

      const mgr = buildUserManager(providerKey, providerCfg);
      managersRef.current[providerKey] = mgr;
      if (!mgr) { setUser(null); return; }

      const storedUser = await mgr.getUser();
      if (cancelled) return;
      await applyUser(storedUser);

      const handlers = {
        userLoaded:       async (u) => { await applyUser(u); },
        userUnloaded:     () => { setUser(null); setProfile(null); syncedTokenRef.current = ''; },
        silentRenewError: (err) => { console.warn('[auth] silent renew error:', err?.message); },
      };
      Object.entries(handlers).forEach(([ev, fn]) =>
        mgr.events[`add${ev[0].toUpperCase() + ev.slice(1)}`](fn)
      );
    }

    init().catch(err => {
      if (!cancelled) { console.error('[auth] init failed:', err); setUser(null); }
    });

    return () => { cancelled = true; };
  }, [applyUser]);

  // Apply favicon and page title from config
  useEffect(() => {
    if (!appConfig) return;
    if (appConfig.appName) document.title = appConfig.appName;
    if (appConfig.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = resolveAssetUrl(appConfig.faviconUrl);
    }
  }, [appConfig?.faviconUrl, appConfig?.appName]);

  const refreshAppConfig = useCallback(async () => {
    invalidateAppConfig();
    const config = await fetchAppConfig();
    setAppConfig(config);
    return config;
  }, []);

  const login = useCallback((providerKey, redirectTo) => {
    if (appConfig?.haIngress) return; // HA handles sign-in
    const mgr = getManager(providerKey);
    if (!mgr) { console.error('[auth] No UserManager for provider:', providerKey); return; }
    setActiveProvider(providerKey);
    mgr.signinRedirect({ state: redirectTo || '/' }).catch(err => debugAuthError('signinRedirect failed', err));
  }, [getManager, appConfig?.haIngress]);

  const logout = useCallback(() => {
    if (appConfig?.haIngress) { window.location.reload(); return; } // session belongs to HA
    const mgr = getCurrentManager();
    setActiveProvider(null);
    mgr?.signoutRedirect().catch(() => {});
  }, [getCurrentManager, appConfig?.haIngress]);

  const accessToken = user?.access_token ?? null;

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      login,
      logout,
      accessToken,
      loading: user === undefined,
      appConfig,
      refreshAppConfig,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function RequireAuth({ children, adminOnly = false }) {
  const { user, profile, login, loading, appConfig } = useAuth();
  const location = useLocation();

  if (loading || !appConfig) {
    return <div className="login-page"><div style={{ color: 'var(--muted)' }}>Loading…</div></div>;
  }

  if (!user) {
    if (appConfig.haIngress) {
      // HA authenticated the request but the API could not be reached.
      return (
        <div className="login-page">
          <div style={{ color: 'var(--muted)' }}>
            Unable to reach the DevOps Platform API. Check the add-on log and reload.
          </div>
        </div>
      );
    }
    const providers = appConfig.authProviders || [];
    if (providers.length === 1) {
      login(providers[0].provider, location.pathname + location.search);
      return null;
    }
    // Multiple providers: redirect to login page to pick one
    return <Navigate to={`/login?redirectTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  const adminGroup = appConfig.adminGroup;
  const adminUsers = appConfig.adminUsers || [];
  const groups     = profile?.groups || [];
  const isAdmin    = adminUsers.includes(profile?.email) || (adminGroup && groups.includes(adminGroup));

  if (adminOnly && !isAdmin) {
    return <Unauthorized />;
  }

  return children;
}

function Unauthorized() {
  const { logout, profile } = useAuth();
  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-logo" style={{ background: 'linear-gradient(135deg,var(--red),#b91c1c)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div className="login-title">Admin Access Required</div>
        <p className="login-sub">
          {profile?.email
            ? <><strong>{profile.email}</strong> does not have admin permissions.</>
            : 'Your account does not have admin permissions.'
          }
        </p>
        <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginBottom: 16 }}>
          Ask an admin to add your email in Admin → Branding → Admin Users.
        </p>
        <button className="btn btn-sec w-full" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
