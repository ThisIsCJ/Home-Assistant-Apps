#!/usr/bin/with-contenv bashio
# ==============================================================================
# DevOps Platform add-on entrypoint.
# Runs MongoDB (unless an external URI is configured), the three Node services
# and nginx in one container. Exits if any of them dies so the Supervisor can
# restart the add-on.
#
# Options are read straight from /data/options.json (written by the
# Supervisor) so the container also runs standalone for testing.
# ==============================================================================
set -o pipefail

OPTIONS=/data/options.json

APP_NAME="$(jq -r '.app_name // "DevOps Platform"' "${OPTIONS}" 2>/dev/null || echo 'DevOps Platform')"
ADMIN_GROUP="$(jq -r '.admin_group // "devops-admins"' "${OPTIONS}" 2>/dev/null || echo 'devops-admins')"
ADMIN_USERS="$(jq -r '(.admin_users // []) | join(",")' "${OPTIONS}" 2>/dev/null || echo '')"
EXTERNAL_MONGO="$(jq -r '.external_mongo_uri // ""' "${OPTIONS}" 2>/dev/null || echo '')"
LOG_LEVEL="$(jq -r '.log_level // "info"' "${OPTIONS}" 2>/dev/null || echo 'info')"
bashio::log.level "${LOG_LEVEL}" || true

# Every request reaches us through HA ingress, already authenticated.
export AUTH_MODE="ha_ingress"
export ADMIN_GROUP
export ADMIN_USERS
export VITE_APP_NAME="${APP_NAME}"
export VITE_USER_GROUP="devops-users"

# The backends trust the X-Remote-User-* headers, so they must only be
# reachable through nginx — never from other containers on the HA network.
export BIND_HOST="127.0.0.1"

# ── Graceful shutdown ─────────────────────────────────────────────────────────
# Forward SIGTERM so mongod shuts down cleanly instead of replaying its
# journal on the next start.
shutdown() {
    bashio::log.info "Stopping services…"
    # shellcheck disable=SC2046
    kill -TERM $(jobs -p) 2>/dev/null
    wait
    exit 0
}
trap shutdown TERM INT

# ── MongoDB ───────────────────────────────────────────────────────────────────
mongo_up() { (exec 3<>/dev/tcp/127.0.0.1/27017) 2>/dev/null && exec 3>&-; }

if [ -n "${EXTERNAL_MONGO}" ] && [ "${EXTERNAL_MONGO}" != "null" ]; then
    export MONGO_URI="${EXTERNAL_MONGO}"
    bashio::log.info "Using external MongoDB"
else
    export MONGO_URI="mongodb://127.0.0.1:27017/devops-platform"
    mkdir -p /data/mongodb
    bashio::log.info "Starting bundled MongoDB (data in /data/mongodb)"
    # - small WiredTiger cache: don't compete with Home Assistant for RAM
    # - log to a file (not stdout) so mongod's JSON logging doesn't drown
    #   the add-on log; no --logappend, so it resets on every (re)start
    rm -f /var/log/mongod.log
    mongod --dbpath /data/mongodb --bind_ip 127.0.0.1 --port 27017 --quiet \
           --wiredTigerCacheSizeGB 0.25 \
           --logpath /var/log/mongod.log &
    MONGOD_PID=$!

    for _ in $(seq 1 60); do
        mongo_up && break
        # Fail fast if mongod already died (e.g. SIGILL on unsupported CPUs)
        kill -0 "${MONGOD_PID}" 2>/dev/null || break
        sleep 1
    done
    if ! mongo_up; then
        bashio::log.fatal "MongoDB failed to start."
        tail -20 /var/log/mongod.log 2>/dev/null
        if ! kill -0 "${MONGOD_PID}" 2>/dev/null; then
            bashio::log.fatal "Note: the bundled MongoDB needs an ARMv8.2-class CPU on aarch64" \
                "(Raspberry Pi 5 or newer — a Pi 4 is not supported)." \
                "Set the external_mongo_uri option to use an external database instead."
        fi
        exit 1
    fi
    bashio::log.info "MongoDB is up"
fi

# Persistent upload storage (path is hardcoded in the API)
mkdir -p /data/uploads

# Runtime env for the SPA — nothing needed in HA ingress mode, but the file
# must exist because index.html loads it.
echo 'window.__env__ = {};' > /opt/app/www/env-config.js

# ── Application services ─────────────────────────────────────────────────────
bashio::log.info "Starting API (:4000), monitor (:4100), provisioning (:4200)"
(cd /opt/app/api                  && exec node server.js) &
(cd /opt/app/modules/monitor      && PORT=4100 exec node server.js) &
(cd /opt/app/modules/provisioning && PORT=4200 exec node server.js) &

bashio::log.info "Starting nginx on :8099 (ingress)"
nginx &

# First crashed process takes the add-on down; Supervisor restarts it.
wait -n
bashio::log.warning "A service exited — stopping add-on"
kill $(jobs -p) 2>/dev/null
exit 1
