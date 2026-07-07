# Cookbook — Home Assistant Add-on Repository

A self-contained Home Assistant add-on version of the Cookbook module: a shared
recipe organizer with web import, ingredient scaling, star ratings and comments.

## Installation

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**.
2. Open the **⋮** menu (top right) → **Repositories**.
3. Add this repository's URL and click **Add**.
4. Find **Cookbook** in the store, click it, then **Install**.

Alternatively, for a local install, copy the [`cookbook/`](cookbook/) directory
into your Home Assistant `/addons` folder and it will appear under
**Local add-ons**.

## Configuration

The add-on needs a MongoDB server (Atlas, self-hosted, DocumentDB, or a
`mongodb` add-on). Set the connection string in the add-on **Configuration**
tab. See [`cookbook/DOCS.md`](cookbook/DOCS.md) for full details.

## Repository layout

```
.
├── repository.yaml        # add-on repository metadata
└── cookbook/              # the add-on itself
    ├── config.yaml        # add-on manifest (ingress, options, schema)
    ├── Dockerfile         # builds the React UI + Node/Express server
    ├── run.sh             # container entrypoint
    ├── server/            # Express API (MongoDB, ingress auth, uploads)
    └── src/               # React single-page UI
```
