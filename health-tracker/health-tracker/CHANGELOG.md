# Changelog

## 1.1.1

- Fixed startup failure `s6-overlay-suexec: fatal: can only run as pid 1` by
  setting `init: false` — the add-on's s6-overlay must run as PID 1, so the
  Supervisor must not inject Docker's own init.
- Configuration options are now grouped (Database, App, Auth, OIDC,
  Integrations) with friendly names and inline descriptions in the
  add-on's Configuration tab.
- New option `database_name` (default `healthtracker`) — base name for the
  MongoDB databases (`<name>_app` and `<name>_u_<user id>`). Existing
  installs are unaffected as long as it is left at the default.
- The sidebar collapse button on large screens now hides the menu completely
  (like on small screens) instead of shrinking it to an icon rail, and the
  choice is remembered across reloads.

## 1.1.0

- **Home Assistant is now the default login method.** Users sign in with
  their Home Assistant account via HA's native OAuth flow — no external
  identity provider required. HA admins (and the owner) get the admin role.
- New options: `auth_method` (`home_assistant` | `oidc`), `ha_url` (the HA
  URL users' browsers can reach), `ha_internal_url` (optional in-network
  override for the add-on's server-side calls to HA).
- Authentik/OIDC remains fully supported — set `auth_method: oidc` with the
  existing `oidc_*` options.
- `secret_key` is now required for Home Assistant auth (it signs the app's
  session tokens, valid 30 days).
- Mobile sync (`ht_` API tokens), the MCP server, and the dev-mode bypass
  are unchanged.

## 1.0.0

- Initial add-on release.
- Packages the complete Health Tracker stack (web UI, API, Sparky bridge,
  MCP server, Redis) in a single s6-supervised container.
- External MongoDB via `mongodb_url` option.
- Persistent uploads/exports/config in `/data`.
