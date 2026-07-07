#!/bin/sh
# Home Assistant mounts the add-on options at /data/options.json, which the
# server reads directly (see server/config.js). Nothing else to wire up.
set -e

echo "[cookbook] starting add-on..."
if [ -f /data/options.json ]; then
  echo "[cookbook] options.json found"
else
  echo "[cookbook] no /data/options.json (running outside Home Assistant?)"
fi

exec node server/server.js
