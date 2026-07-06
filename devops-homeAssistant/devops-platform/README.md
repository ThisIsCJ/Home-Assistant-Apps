# DevOps Platform Add-on

Self-hosted DevOps provisioning, monitoring and site-request platform, packaged as a single Home Assistant add-on.

- **Web UI in the HA sidebar** via ingress — no ports to open, no reverse proxy to configure.
- **Authentication is handled by Home Assistant.** By default every HA user who can open the panel is a platform admin; set the `admin_users` option to restrict admin rights to specific HA usernames.
- **MongoDB is bundled** and stores its data in the add-on's persistent `/data` volume (cold backups keep it consistent). Optionally point the add-on at an external MongoDB instead.
- **Hardened**: backend services and the database are reachable only through nginx from the HA ingress gateway; an AppArmor profile confines the container; a watchdog restarts the add-on if it stops responding.
- Includes the core API, the site **monitor** module (scheduled checks) and the **provisioning** module (n8n / Nginx Proxy Manager / Cloudflare integrations, configured in the Admin UI).

See [DOCS.md](DOCS.md) for configuration details.
