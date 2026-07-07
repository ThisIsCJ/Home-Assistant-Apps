# Changelog

## 1.0.0

- Initial release
- WYSIWYG in-place editing of HTML pages (text, formatting, links, images)
  with structure-preserving serialization
- Code editor for Markdown/CSS/JS and other text files
- Per-user, per-site drafts — saved outside the repository until pushed
- Local preview with build support (Hugo and npm-based generators bundled)
- GitHub integration: background clone, fast-forward sync, commit & push with
  conflict detection and optional force-push
- Per-site push history (commit, author, files, status)
- Admin panel: site management, per-site user access with sync/push
  permissions, SSH key generation/import (write-only key storage)
- Home Assistant ingress with HA-user authentication; admins defined in the
  add-on configuration
