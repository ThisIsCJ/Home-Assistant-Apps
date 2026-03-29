#!/bin/sh
set -e

echo "[INFO] Starting openHASP Designer..."

# Read panel dimensions from options
if [ -f /data/options.json ]; then
    echo "[INFO] Config loaded:"
    cat /data/options.json
fi

exec python3 /app/server.py
