import { getApiBase } from './env.js';

let _getUserManager = null;
let refreshPromise = null;

async function renewAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const mgr = _getUserManager?.();
      if (!mgr) return null;
      const user = await mgr.signinSilent();
      return user?.access_token || null;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function handleUnauthorized() {
  const mgr = _getUserManager?.();
  if (mgr) {
    try { await mgr.removeUser(); } catch {}
    try { await mgr.signinRedirect(); return; } catch {}
  }
  window.location.hash = '#/login';
}

async function req(method, path, body, token, canRetry = true) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  const res = await fetch(getApiBase() + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && token && canRetry) {
    try {
      const refreshedToken = await renewAccessToken();
      if (refreshedToken && refreshedToken !== token) {
        return req(method, path, body, refreshedToken, false);
      }
    } catch {
      await handleUnauthorized();
      throw new Error('Your session expired. Please sign in again.');
    }
    await handleUnauthorized();
    throw new Error('Your session expired. Please sign in again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(err.message || res.statusText);
    error.status = res.status;
    error.code = err.code;
    throw error;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  get:   (path, token)       => req('GET',    path, null, token),
  post:  (path, body, token) => req('POST',   path, body, token),
  put:   (path, body, token) => req('PUT',    path, body, token),
  patch: (path, body, token) => req('PATCH',  path, body, token),
  del:   (path, token)       => req('DELETE', path, null, token),
  setUserManagerGetter: (getter) => { _getUserManager = getter; },
};
