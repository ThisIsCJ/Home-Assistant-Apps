#!/bin/sh
set -e

echo "[INFO] Starting Config Viewer..."

# HA mounts add-on options at /data/options.json
if [ -f /data/options.json ]; then
    cp /data/options.json /data/config_values.json
    echo "[INFO] Loaded config from /data/options.json"
    cat /data/options.json
else
    echo '{"input_1": "", "input_2": "", "input_3": ""}' > /data/config_values.json
    echo "[WARN] No options.json found, using defaults"
fi

# Start the Python web server
exec python3 /app/server.py
