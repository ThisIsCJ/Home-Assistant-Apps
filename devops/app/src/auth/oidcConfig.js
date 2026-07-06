import { UserManager } from 'oidc-client-ts';
import { getEnv } from '../lib/env.js';

const managers = {};

const ACTIVE_PROVIDER_KEY = 'auth_provider';

function getAppUrl() {
  const configured = getEnv('APP_URL');
  if (configured) return configured.replace(/\/$/, '');
  return window.location.origin;
}

export function buildUserManager(providerKey, providerConfig) {
  if (managers[providerKey]) return managers[providerKey];
  if (!providerConfig?.authority || !providerConfig?.clientId) return null;

  const appUrl = getAppUrl();
  managers[providerKey] = new UserManager({
    authority: providerConfig.authority,
    client_id: providerConfig.clientId,
    redirect_uri: `${appUrl}/auth/callback`,
    post_logout_redirect_uri: appUrl,
    response_type: 'code',
    scope: providerConfig.scope || 'openid profile email',
    automaticSilentRenew: true,
    silent_redirect_uri: `${appUrl}/auth/silent`,
  });
  return managers[providerKey];
}

export function clearUserManagers() {
  Object.keys(managers).forEach(k => delete managers[k]);
}

export function setActiveProvider(providerKey) {
  if (providerKey) {
    sessionStorage.setItem(ACTIVE_PROVIDER_KEY, providerKey);
    localStorage.setItem(ACTIVE_PROVIDER_KEY, providerKey);
  } else {
    sessionStorage.removeItem(ACTIVE_PROVIDER_KEY);
    localStorage.removeItem(ACTIVE_PROVIDER_KEY);
  }
}

export function getActiveProviderKey() {
  return sessionStorage.getItem(ACTIVE_PROVIDER_KEY) || localStorage.getItem(ACTIVE_PROVIDER_KEY) || null;
}

export function debugAuthError(message, error) {
  console.error(`[auth] ${message}`, { name: error?.name, message: error?.message, error: error?.error, stack: error?.stack });
}
