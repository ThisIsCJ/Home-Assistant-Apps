// Home Assistant serves the add-on behind an ingress prefix
// (/api/hassio_ingress/<token>). The server injects that prefix into the HTML
// as window.__INGRESS_PATH__ so we can build absolute URLs the browser will
// send back through the proxy. Falls back to same-origin for direct access.
export function ingressBase() {
  if (typeof window === 'undefined') return '';
  return window.__INGRESS_PATH__ || '';
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${ingressBase()}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `API error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// Signatures are kept compatible with the original module (the trailing token
// argument is accepted but unused — ingress handles authentication).
export const api = {
  get: (path) => apiFetch(path, { method: 'GET' }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),

  // Download an endpoint's response as a Blob (e.g. a file export). Throws on
  // non-2xx, reading the JSON error body when there is one.
  download: async (path) => {
    const res = await fetch(`${ingressBase()}/api${path}`, { method: 'GET' });
    if (!res.ok) throw await responseError(res);
    return res.blob();
  },

  // POST multipart form data (e.g. a file upload). The browser sets the
  // Content-Type (with boundary) itself, so none is provided here.
  upload: async (path, formData) => {
    const res = await fetch(`${ingressBase()}/api${path}`, { method: 'POST', body: formData });
    if (!res.ok) throw await responseError(res);
    return res.json();
  },
};

async function responseError(res) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || `API error ${res.status}`);
  err.status = res.status;
  return err;
}
