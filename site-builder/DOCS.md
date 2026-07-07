# Site Editor

A Home Assistant add-on that provides a WYSIWYG editor for static websites
stored in GitHub repositories: edit visually, preview locally, save drafts,
and push changes back to GitHub.

## Installation

Add this repository to the Home Assistant add-on store and install
**Site Editor**. The add-on is served exclusively through Home Assistant
ingress — no ports are exposed and HA handles authentication for every
request.

## Configuration

```yaml
admins:
  - username: your_ha_username
app:
  data_path: /data
  repo_path: /data/repos
  draft_path: /data/drafts
log_level: info
```

### `admins`

Home Assistant usernames that get **app-admin** rights. Admins can:

- add, edit and remove sites
- configure GitHub repository links and SSH keys
- assign users to sites and set per-site sync/push permissions
- see every site

An **empty list means every HA user is an admin** — the sensible default on a
single-user installation. Everyone else is a **standard user**: they see only
the sites they are assigned to, can edit and save drafts, preview, and — where
permitted per site — sync from and push to GitHub.

### `app`

Storage paths inside the container. Leave at the defaults; everything must
stay under `/data` to be persistent and included in backups. The add-on stops
during backups (`backup: cold`) so the SQLite database and repositories are
captured consistently.

## Setting up a site

1. **Create an SSH key** (Admin → SSH Keys): *Generate Key* creates an
   ed25519 keypair; *Import Key* accepts a pasted unencrypted private key.
   Either way, the private key is stored with `0600` permissions on the
   add-on volume and is **never displayed again** — only the name,
   fingerprint and public key remain visible.
2. **Add the public key to GitHub**: repository → Settings → Deploy keys →
   *Add deploy key* → paste → tick **Allow write access**.
3. **Add the site** (Admin → Sites): name, repository URL
   (`git@github.com:user/site.git` or `https://…`), branch, and the SSH key.
   The add-on clones the repository in the background.
4. **Build settings** (optional): sites that need a build step get a *build
   command* and a *static output directory*, e.g.

   | Generator | Build command | Output dir |
   |-----------|---------------|------------|
   | Plain HTML | *(leave empty)* | *(leave empty)* |
   | Hugo | `hugo` | `public` |
   | Eleventy | `npm ci && npx @11ty/eleventy` | `_site` |
   | Astro / Vite | `npm ci && npm run build` | `dist` |

   Hugo and Node/npm are bundled in the image. Ruby-based generators
   (Jekyll) are **not** — build such sites externally or with GitHub Actions.
5. **Assign users**: add HA usernames to the site's access list and choose
   whether they may sync and/or push.

## Editing workflow

- **Edit** — open a site from the sidebar, pick a page from the file list.
  HTML pages render visually: click text to edit it in place, click an image
  to replace it (URL or upload), use the toolbar for bold/italic/underline,
  headings and links. Other text files (Markdown, CSS, JS, …) open in a code
  editor.
- **Save Draft** — stores your work per user, per site, outside the
  repository. Come back any time; drafts survive restarts and are marked in
  the sidebar and file list.
- **Preview** — shows the drafted site exactly as it will render (drafts are
  saved automatically first). Sites with a build command are built inside the
  add-on; a failing build shows its log.
- **Sync** — pulls the latest from GitHub (fast-forward). Your draft is kept.
- **Push to GitHub** — commits your draft with a commit message (editable,
  default provided) and pushes. If any of your drafted files also changed
  upstream since you started, the push is stopped and the conflicting files
  are listed — you can sync and re-check, or force-push your version.
- **History** — every push (and failed push) is recorded per site with
  commit hash, message, author, files and status.

## Security notes

- All requests arrive through HA ingress, already authenticated; the add-on
  trusts the Supervisor's `X-Remote-User-*` headers, binds its API to
  `127.0.0.1`, and nginx only accepts connections from the ingress gateway.
- Repository URLs are validated (`git@…`/`ssh://`/`https://` only), git runs
  sandboxed to the site's directory via `execFile` (no shell), and all file
  access is confined to the site's repo/draft directories (path-traversal
  safe).
- Private SSH keys are write-only. Build commands are configured by admins
  only and run inside the add-on container.

## Troubleshooting

- **Clone failed** — check the error shown on the site card. Typical causes:
  wrong branch name, missing deploy key, or a `git@…` URL without any SSH
  key. Fix the settings and use the retry button (or Admin → Sites → ⟳).
- **Push failed: not permitted** — the deploy key lacks *write* access.
- **Preview 404 for a built site** — press *Preview* once to run the first
  build.
- **A page's styling is broken in the editor** — assets referenced with
  root-absolute paths inside CSS files (`url(/…)`) or `srcset` are not
  rewritten in v1; the saved HTML is unaffected.
