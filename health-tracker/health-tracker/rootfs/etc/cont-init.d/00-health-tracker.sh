#!/usr/bin/with-contenv bashio
# ==============================================================================
# Translate add-on options (/data/options.json) into the environment variables
# the Health Tracker services already read, generate the SPA's runtime
# env-config.js, and render the nginx site config.
#
# Options are read straight from options.json with jq (not bashio::config) so
# empty optional values never trigger Supervisor API lookups.
# ==============================================================================
set -e

OPTIONS=/data/options.json

opt() {
    jq -r --arg k "$1" --arg d "${2:-}" \
        'if has($k) and .[$k] != null then .[$k] | tostring else $d end' \
        "${OPTIONS}"
}

# ── Persistent directories (HA keeps /data across restarts/updates) ──────────
mkdir -p /data/uploads /data/exports /data/config /data/redis

# ── Export env vars to all s6 services via the container environment ─────────
env_dir=/var/run/s6/container_environment
mkdir -p "${env_dir}"

set_env() { printf '%s' "$2" > "${env_dir}/$1"; }

mongodb_url="$(opt mongodb_url)"
auth_method="$(opt auth_method home_assistant)"
ha_url="$(opt ha_url)"
secret_key="$(opt secret_key)"

set_env MONGODB_URL             "${mongodb_url}"
set_env DB_NAME                 "$(opt database_name healthtracker)"
set_env AUTH_METHOD             "${auth_method}"
set_env HA_URL                  "${ha_url}"
set_env HA_INTERNAL_URL         "$(opt ha_internal_url)"
set_env OIDC_AUTHORITY          "$(opt oidc_authority)"
set_env OIDC_CLIENT_ID          "$(opt oidc_client_id)"
set_env OIDC_AUDIENCE           "$(opt oidc_audience)"
set_env SECRET_KEY              "$(opt secret_key)"
set_env ENVIRONMENT             "$(opt environment production)"
set_env APP_BASE_URL            "$(opt app_base_url)"
set_env USDA_API_KEY            "$(opt usda_api_key)"
set_env CORS_ORIGINS            "$(opt cors_origins)"
set_env REDIS_URL               "redis://127.0.0.1:6379"
set_env UPLOAD_DIR              "/data/uploads"
set_env CONFIG_DIR              "/data/config"
# Sparky bridge
set_env ROOT_PATH               "/sparky"
set_env IGNORED_METRICS         "$(opt sparky_ignored_metrics)"
# MCP
set_env HEALTH_TRACKER_API_URL  "http://127.0.0.1:8000"

if [ -z "${mongodb_url}" ]; then
    bashio::log.fatal "mongodb_url is not set — the add-on cannot start without a MongoDB server."
    exit 1
fi
if [ "${auth_method}" = "home_assistant" ]; then
    if [ -z "${ha_url}" ]; then
        bashio::log.fatal "auth_method is home_assistant but ha_url is not set — set it to the URL users reach Home Assistant at (e.g. https://ha.example.com or http://192.168.1.10:8123)."
        exit 1
    fi
    if [ -z "${secret_key}" ]; then
        bashio::log.fatal "secret_key is required with Home Assistant auth — it signs login session tokens. Generate one with: python3 -c \"import secrets; print(secrets.token_hex(32))\""
        exit 1
    fi
elif [ "${auth_method}" = "oidc" ]; then
    if [ -z "$(opt oidc_authority)" ] || [ -z "$(opt oidc_client_id)" ]; then
        bashio::log.fatal "auth_method is oidc but oidc_authority / oidc_client_id are not set."
        exit 1
    fi
fi
if [ -z "${secret_key}" ]; then
    bashio::log.warning "secret_key is empty — set one! It encrypts stored AI keys and Google OAuth tokens."
fi

# ── SPA runtime config (same contract as frontend/docker/entrypoint.sh) ──────
cat > /opt/health-tracker/www/env-config.js <<EOF
window.__env__ = {
  APP_NAME: "$(opt app_name 'Health Tracker')",
  AUTH_METHOD: "${auth_method}",
  HA_URL: "${ha_url}",
  OIDC_AUTHORITY: "$(opt oidc_authority)",
  OIDC_CLIENT_ID: "$(opt oidc_client_id)",
  OIDC_SCOPE: "$(opt oidc_scope 'openid profile email')",
  API_URL: "",
  ENVIRONMENT: "$(opt environment production)"
};
EOF
bashio::log.info "env-config.js written."

# ── Ingress breakout page (HA sidebar) ────────────────────────────────────────
# The app's login flows (HA OAuth / OIDC redirects) can't run inside the
# ingress iframe, so the sidebar entry opens the app at its real URL instead.
app_base_url="$(opt app_base_url)"
mkdir -p /opt/health-tracker/ingress
if [ -n "${app_base_url}" ]; then
    cat > /opt/health-tracker/ingress/index.html <<EOF
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Health Tracker</title></head>
<body style="font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;margin:0">
<p>Opening <a href="${app_base_url}" target="_top">Health Tracker</a>&hellip;</p>
<script>window.top.location.href = "${app_base_url}";</script>
</body>
</html>
EOF
else
    cat > /opt/health-tracker/ingress/index.html <<'EOF'
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Health Tracker</title></head>
<body style="font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;margin:0">
<p>Set the <b>app_base_url</b> option in the add-on configuration so this sidebar link knows where to send you.</p>
</body>
</html>
EOF
fi

# ── nginx site config ─────────────────────────────────────────────────────────
oidc_proxy_host="$(opt oidc_proxy_host)"

sed "s/{{OIDC_PROXY_HOST}}/${oidc_proxy_host}/g" \
    /etc/health-tracker/nginx-site.conf.tmpl > /etc/nginx/http.d/health-tracker.conf

# Drop the Authentik proxy block when no proxy host is configured
if [ -z "${oidc_proxy_host}" ]; then
    sed -i '/# BEGIN oidc-proxy/,/# END oidc-proxy/d' /etc/nginx/http.d/health-tracker.conf
fi

bashio::log.info "Health Tracker configured — starting services."
