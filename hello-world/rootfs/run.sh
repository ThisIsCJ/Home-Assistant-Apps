#!/bin/sh
set -e

echo "[INFO] Starting Hello World..."

GREETING="Hello, Home Assistant!"
if [ -f /data/options.json ]; then
    GREETING=$(python3 -c "import json; print(json.load(open('/data/options.json')).get('greeting', 'Hello, Home Assistant!'))")
fi

echo "[INFO] Greeting: ${GREETING}"

exec python3 /app/server.py
