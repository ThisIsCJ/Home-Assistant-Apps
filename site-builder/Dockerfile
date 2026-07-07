ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm

# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/index.html app/vite.config.js ./
COPY app/src ./src
RUN npm run build

# ── Stage 2: runtime — nginx + Node 20 + git + build toolchains ──────────────
FROM $BUILD_FROM

# Node 20 from NodeSource; git + openssh for repository access; hugo so
# Hugo-based sites can be built for preview; nginx fronts the ingress port.
# Node itself covers npm-based static site generators (Eleventy, Astro, Vite).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg nginx git openssh-client hugo rsync \
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

WORKDIR /opt/app

# Backend — better-sqlite3 is a native module, so pull in the compiler
# toolchain just for npm ci and drop it again in the same layer.
# (python3 stays: the NodeSource nodejs package depends on it.)
COPY app/api/package.json app/api/package-lock.json ./api/
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 \
 && cd api && npm ci --omit=dev && npm cache clean --force \
 && apt-get purge -y build-essential \
 && apt-get autoremove -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*
COPY app/api ./api

# Frontend bundle
COPY --from=frontend /build/dist ./www

COPY rootfs /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
