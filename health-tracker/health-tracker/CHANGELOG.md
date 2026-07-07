# Changelog

## 1.0.0

- Initial add-on release.
- Packages the complete Health Tracker stack (web UI, API, Sparky bridge,
  MCP server, Redis) in a single s6-supervised container.
- External MongoDB via `mongodb_url` option.
- Persistent uploads/exports/config in `/data`.
