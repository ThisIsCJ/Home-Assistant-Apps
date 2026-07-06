ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm

# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/index.html app/vite.config.js ./
COPY app/src ./src
RUN npm run build

# ── Stage 2: MongoDB binary donor ─────────────────────────────────────────────
# MongoDB publishes Debian apt packages for x86_64 only, but the official
# Docker image ships amd64 AND arm64 builds — so we take mongod from there.
# (Both mongo:7.0/jammy and Debian bookworm use OpenSSL 3 and a compatible
# glibc, so the binary runs unmodified.)
FROM mongo:7.0 AS mongodb

# ── Stage 3: runtime — nginx + Node 20 + MongoDB 7 on the HA Debian base ─────
FROM $BUILD_FROM

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg nginx libcurl4 libssl3 \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY --from=mongodb /usr/bin/mongod /usr/bin/mongod

WORKDIR /opt/app

# Backend services — npm ci against committed lock files for reproducible builds
COPY app/shared ./shared
COPY app/api ./api
COPY app/modules ./modules
RUN cd shared && npm ci --omit=dev \
 && cd ../api && npm ci --omit=dev \
 && cd ../modules/monitor && npm ci --omit=dev \
 && cd ../provisioning && npm ci --omit=dev \
 && npm cache clean --force

# Frontend bundle
COPY --from=frontend /build/dist ./www

COPY rootfs /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
