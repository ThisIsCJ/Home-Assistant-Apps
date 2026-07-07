export function getEnv(key) {
  return window.__env__?.[key] ?? import.meta.env[`VITE_${key}`] ?? '';
}
