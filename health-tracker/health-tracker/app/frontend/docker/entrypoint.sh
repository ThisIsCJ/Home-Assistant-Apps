#!/bin/sh
# Inject runtime environment variables into the SPA at container startup.
# This runs before nginx starts (placed in /docker-entrypoint.d/).

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__env__ = {
  APP_NAME: "${VITE_APP_NAME:-Health Tracker}",
  OIDC_AUTHORITY: "${VITE_OIDC_AUTHORITY:-}",
  OIDC_CLIENT_ID: "${VITE_OIDC_CLIENT_ID:-}",
OIDC_SCOPE: "${VITE_OIDC_SCOPE:-openid profile email}",
  API_URL: "${VITE_API_URL:-}",
  ENVIRONMENT: "${VITE_ENVIRONMENT:-production}"
};
EOF

echo "env-config.js written."
