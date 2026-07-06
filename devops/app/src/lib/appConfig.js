import { getApiBase } from './env.js';

let cache = null;
let fetchPromise = null;

export async function fetchAppConfig() {
  if (cache) return cache;
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch(`${getApiBase()}/config/public`)
    .then(r => { if (!r.ok) throw new Error('Config fetch failed'); return r.json(); })
    .then(data => { cache = data; return data; })
    .catch(() => {
      const fallback = {
        appName: 'DevOps Platform',
        logoUrl: null,
        faviconUrl: null,
        accentColor: null,
        adminGroup: '',
        userGroup: '',
        adminUsers: [],
        authProviders: [],
        onboardingComplete: false,
        dbConnected: false,
      };
      cache = fallback;
      return fallback;
    })
    .finally(() => { fetchPromise = null; });
  return fetchPromise;
}

export function getAppConfig() {
  return cache;
}

export function invalidateAppConfig() {
  cache = null;
}
