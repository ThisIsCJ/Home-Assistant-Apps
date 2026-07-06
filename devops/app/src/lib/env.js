// Only APP_URL is injected at runtime — everything else comes from the public config API.
export function getEnv(key) {
  return globalThis.window?.__env__?.[key] ?? import.meta.env[`VITE_${key}`] ?? '';
}

// Base URL for API calls, relative to wherever the SPA is mounted.
// At a root deployment this is '/api'; under Home Assistant ingress it is
// '/api/hassio_ingress/<token>/api', which the Supervisor proxies to the
// add-on's '/api'. The document path never changes (HashRouter), so this is
// stable for the lifetime of the page.
export function getApiBase() {
  const path = globalThis.window?.location?.pathname ?? '/';
  const dir = path.endsWith('/') ? path : path.slice(0, path.lastIndexOf('/') + 1);
  return `${dir}api`;
}

// Resolve an asset URL (logo, favicon, uploaded image) for display.
// External URLs (http/https/data/blob) are returned untouched. Anything else is
// treated as an upload path and resolved against the SPA mount directory, so it
// works both at a root deployment ('/api/uploads/x') and under Home Assistant
// ingress ('/api/hassio_ingress/<token>/api/uploads/x'). This tolerates both the
// mount-relative ('api/uploads/x') and legacy absolute ('/api/uploads/x') forms
// that may already be stored in the database.
export function resolveAssetUrl(url) {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const path = globalThis.window?.location?.pathname ?? '/';
  const dir = path.endsWith('/') ? path : path.slice(0, path.lastIndexOf('/') + 1);
  return `${dir}${url.replace(/^\/+/, '')}`;
}
