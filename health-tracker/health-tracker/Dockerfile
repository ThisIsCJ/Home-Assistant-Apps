ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21

# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY app/frontend/package*.json ./
RUN npm install
COPY app/frontend/ ./
RUN npm run build

# ── Stage 2: Home Assistant add-on image (Alpine + s6-overlay) ────────────────
FROM $BUILD_FROM

RUN apk add --no-cache \
    python3 \
    py3-pip \
    nginx \
    redis \
    curl

# API + Sparky bridge share a venv (bridge uses >= ranges compatible with the
# API's pins). The MCP server gets its own venv — its dependency tree pins
# pydantic differently than the API.
COPY app/api/requirements.txt /tmp/req-api.txt
COPY app/sparky-bridge/requirements.txt /tmp/req-bridge.txt
COPY app/mcp/requirements.txt /tmp/req-mcp.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/req-api.txt -r /tmp/req-bridge.txt \
 && python3 -m venv /opt/venv-mcp \
 && /opt/venv-mcp/bin/pip install --no-cache-dir -r /tmp/req-mcp.txt \
 && rm /tmp/req-*.txt

# Application code — unchanged copies of the original services
COPY app/api /opt/health-tracker/api
COPY app/sparky-bridge /opt/health-tracker/sparky-bridge
COPY app/mcp /opt/health-tracker/mcp
COPY --from=frontend-builder /build/dist /opt/health-tracker/www

# Remove the Alpine nginx default site; ours is generated at startup
RUN rm -f /etc/nginx/http.d/default.conf

# s6 services, init scripts, nginx template
COPY rootfs /
RUN chmod +x /etc/cont-init.d/*.sh /etc/services.d/*/run

EXPOSE 80 4001 8002
