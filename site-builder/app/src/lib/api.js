import { getApiBase } from './env.js';

// Home Assistant ingress authenticates every request before it reaches the
// add-on, so there are no tokens to attach — errors surface as thrown
// Errors carrying .status and any structured fields from the API body.
async function req(method, path, body) {
  const headers = {};
  if (body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(getApiBase() + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(err.message || res.statusText);
    error.status = res.status;
    Object.assign(error, err);
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  get:   (path)       => req('GET', path),
  post:  (path, body) => req('POST', path, body ?? {}),
  put:   (path, body) => req('PUT', path, body),
  patch: (path, body) => req('PATCH', path, body),
  del:   (path)       => req('DELETE', path),
  // Raw binary upload (image assets).
  upload: async (path, blob) => {
    const res = await fetch(getApiBase() + path, { method: 'POST', body: blob });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || res.statusText);
    }
    return res.json();
  },
};

// Absolute URL (within the ingress mount) for iframe src attributes.
export const apiUrl = (path) => getApiBase() + path;
