# Changelog

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
