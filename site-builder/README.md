# Home Assistant Add-on: Site Editor

A WYSIWYG editor for GitHub-backed static websites, running entirely inside
Home Assistant.

Point it at a GitHub repository and edit your static site visually — click any
text on the page to change it, click any image to replace it. Work is saved as
per-user drafts, previewed locally (including sites that need a build step,
e.g. Hugo or npm-based generators), and pushed back to GitHub with a commit
message when ready.

## Features

- **Visual editing** — the real page renders in an editor frame; text is
  edited in place and the site's HTML structure is preserved
- **Drafts** — per-user, per-site drafts that never touch the repository
  until pushed
- **Preview** — local preview of the drafted site; sites with a build command
  (Hugo bundled, plus anything npm-based) are built before previewing
- **GitHub sync & push** — pull the latest, push commits with a custom
  message, with conflict detection against upstream edits
- **History** — every push is recorded per site (commit, author, files,
  status)
- **Access control** — admins (from the add-on config) manage sites, SSH keys
  and per-site user assignment; standard HA users see only their sites
- **Secure SSH keys** — generate or import deploy keys; private keys are
  write-only and never leave the add-on volume
- **Ingress only** — no exposed ports; Home Assistant authenticates every
  request

## Quick start

1. Install the add-on and start it — it appears in the sidebar as
   **Site Editor**.
2. Add your HA username under `admins` in the add-on configuration (an empty
   list makes every HA user an admin).
3. Open the panel → **Admin** → **SSH Keys** → *Generate Key*, and add the
   public key to your GitHub repository as a deploy key with write access.
4. **Admin** → **Sites** → *Add Site*: name, `git@github.com:user/site.git`,
   branch, the SSH key, and (if the site needs building) a build command and
   output directory.
5. Assign users to the site, open it from the sidebar, and start editing.

See [DOCS.md](DOCS.md) for full documentation.
