# Cookbook add-on

Shared recipe organizer with web import, ingredient scaling, ratings and
comments — served through Home Assistant ingress, backed by MongoDB.

See [DOCS.md](DOCS.md) for configuration and usage.

## Development

The add-on bundles a React (Vite) frontend and a Node/Express API in one
container.

```bash
npm install          # install frontend + server deps
npm run build        # build the UI into ./dist
npm run start        # run the server on :4100 (serves ./dist + /api)

# or, with live reload:
npm run dev          # Vite dev server on :5173 (proxies /api to :4100)
npm run dev:server   # API with --watch on :4100
```

Point the server at a MongoDB instance with either an `/data/options.json`
file (`{"mongo_uri": "...", "mongo_db": "cookbook"}`) or the `MONGODB_URI` /
`MONGODB_DB` environment variables.

### Build the add-on image directly

```bash
docker build -t cookbook-addon .
docker run --rm -p 4100:4100 \
  -v "$PWD/local-options.json:/data/options.json:ro" \
  cookbook-addon
```
