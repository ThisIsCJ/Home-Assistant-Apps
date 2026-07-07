#!/usr/bin/with-contenv bashio
# ==============================================================================
# Site Editor add-on entrypoint.
# Runs the Node API and nginx in one container. Exits if either dies so the
# Supervisor can restart the add-on.
#
# Options are read straight from /data/options.json (written by the
# Supervisor) so the container also runs standalone for testing.
# ==============================================================================
set -o pipefail

OPTIONS=/data/options.json

ADMIN_USERS="$(jq -r '[(.admins // [])[].username] | join(",")' "${OPTIONS}" 2>/dev/null || echo '')"
DATA_PATH="$(jq -r '.app.data_path // "/data"' "${OPTIONS}" 2>/dev/null || echo '/data')"
REPO_PATH="$(jq -r '.app.repo_path // "/data/repos"' "${OPTIONS}" 2>/dev/null || echo '/data/repos')"
DRAFT_PATH="$(jq -r '.app.draft_path // "/data/drafts"' "${OPTIONS}" 2>/dev/null || echo '/data/drafts')"
LOG_LEVEL="$(jq -r '.log_level // "info"' "${OPTIONS}" 2>/dev/null || echo 'info')"
bashio::log.level "${LOG_LEVEL}" || true

# Every request reaches us through HA ingress, already authenticated.
export AUTH_MODE="ha_ingress"
export ADMIN_USERS
export DATA_PATH REPO_PATH DRAFT_PATH LOG_LEVEL

# The API trusts the X-Remote-User-* headers, so it must only be reachable
# through nginx — never from other containers on the HA network.
export BIND_HOST="127.0.0.1"
export PORT=4000

mkdir -p "${REPO_PATH}" "${DRAFT_PATH}" "${DATA_PATH}/keys" "${DATA_PATH}/build"
chmod 700 "${DATA_PATH}/keys"

# ── Graceful shutdown ─────────────────────────────────────────────────────────
shutdown() {
    bashio::log.info "Stopping services…"
    # shellcheck disable=SC2046
    kill -TERM $(jobs -p) 2>/dev/null
    wait
    exit 0
}
trap shutdown TERM INT

bashio::log.info "Starting API (:4000)"
(cd /opt/app/api && exec node server.js) &

bashio::log.info "Starting nginx on :8099 (ingress)"
nginx &

# First crashed process takes the add-on down; Supervisor restarts it.
wait -n
bashio::log.warning "A service exited — stopping add-on"
kill $(jobs -p) 2>/dev/null
exit 1
