# ---- Stage 1: build the React frontend -----------------------------------
FROM node:20-alpine AS builder
WORKDIR /build

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime image ----------------------------------------------
# node:20-alpine ships a multi-arch manifest, so this builds for all the
# architectures declared in config.yaml.
FROM node:20-alpine
WORKDIR /app

# Only the server's production dependencies (express, mongodb, multer).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY run.sh ./run.sh
COPY --from=builder /build/dist ./dist

RUN chmod a+x /app/run.sh

ENV NODE_ENV=production \
    PORT=4100

EXPOSE 4100

CMD [ "/app/run.sh" ]
