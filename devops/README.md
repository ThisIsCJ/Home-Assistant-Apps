# DevOps Platform

Self-hosted, self-service **site provisioning, monitoring, and request management** — packaged as a single Home Assistant add-on that lives in your HA sidebar. No ports to open, no reverse proxy to wire up, and Home Assistant handles sign-in.

> A user requests a site (subdomain → host + port). The add-on validates the host over SSH, opens the firewall, creates the Nginx Proxy Manager route and the Cloudflare / n8n DNS record, then keeps watch on it — all from one web UI.

## Highlights

- **Self-service site requests** — users pick a host and domain they've been granted and submit a request; provisioning runs automatically.
- **End-to-end provisioning** — SSH host checks, `firewalld` port opening, Nginx Proxy Manager routing, and Cloudflare / n8n DNS, run as an ordered pipeline with a full teardown path.
- **Uptime & health monitoring** — scheduled HTTPS, TCP, and host-metric checks with alert thresholds and webhooks.
- **Discovery & adoption** — scan your existing NGINX and Cloudflare records and adopt already-running sites into the platform.
- **Team-based access control** — grant hosts and domains to individual users or teams; everyone sees only what they can use.
- **Runs entirely behind HA ingress** — authenticated by Home Assistant, confined by AppArmor, with a bundled database that needs no external service.

## What each part does

### Portal (available to every HA user)

Dashboard, **New Site Request**, **Request History**, **Site Status**, and **Team Access**. Regular users work here; they only see the hosts and domains granted to them or their team.

### Provisioning pipeline

Each request runs as ordered, auditable steps — Access Validation → Host Port Check → Firewall Rule → Site Reachability → NGINX Route → Cloudflare / n8n DNS — with a matching teardown (DNS removal → route removal → firewall close) when a site is retired. Every run and step is recorded.

### Monitoring

Per-site scheduled checks: HTTPS latency and **TLS certificate expiry**, TCP port reachability, and host **CPU / memory / disk** over SSH. Configurable intervals and alert thresholds, outbound webhooks on alert/recovery, and 24-hour history sparklines.

### Admin

Hosts (SSH onboarding with an auto-generated managed key), Domains, **Integrations** (Cloudflare / Nginx Proxy Manager / n8n), Users & Teams with per-resource access grants, **Discovery**, Automation Runs, Audit log, Branding, and Database.

## Install

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Add this repository (**⋮ → Repositories**), then install **DevOps Platform**.
3. Start the add-on and open **DevOps** from the sidebar.

The Supervisor builds the image on first install (a few minutes on a Raspberry Pi). Data is stored in the add-on's persistent `/data` volume.

## Access & admins

- The panel is visible to **all** Home Assistant users.
- Set the **`admin_users`** option to the HA usernames that should have platform-admin rights. Everyone else gets regular portal access.
- Leaving `admin_users` **empty** makes every HA user an admin — the sensible default for a single-user install, but set it once you share the panel.

```yaml
admin_users:
  - alice
  - bob
```

## Configuration

| Option | Purpose |
|--------|---------|
| `app_name` | Display name until a site name is set in **Admin → Branding**. |
| `admin_group` | Group name granted platform-admin rights (in addition to `admin_users`). |
| `admin_users` | HA usernames with platform-admin rights (see above). |
| `log_level` | Add-on log verbosity: `debug` / `info` / `warning` / `error`. |

The **database connection** is managed in the app, not here: **Admin → Database → Connection** lets you point at an external MongoDB / Atlas / Cosmos / DocumentDB (or revert to the bundled one) and migrate data via Export / Import. Provider **integrations** (Cloudflare, Nginx Proxy Manager, n8n) are configured under **Admin → Integrations**.

## Database

MongoDB is **bundled** and stores data in `/data/mongodb`; nothing external is required. To use an external database instead, configure it in **Admin → Database**.

## Requirements

- Architectures: **amd64** and **aarch64**.
- The bundled MongoDB 7 needs an **ARMv8.2-class CPU** on ARM (Raspberry Pi 5, ODROID N2+, and most recent boards). A **Raspberry Pi 4 is not supported** for the bundled database — point the add-on at an external MongoDB instead.

## Security model

- Home Assistant authenticates every request; the backend trusts the Supervisor's `X-Remote-User-*` headers because nothing else can reach it.
- No host ports are exposed. nginx accepts connections only from the ingress gateway, and the Node services and MongoDB bind to `127.0.0.1`.
- An AppArmor profile confines the container, and a watchdog restarts the add-on if it stops responding.

## Backup

The add-on uses cold backups (Home Assistant briefly stops it so the database files are captured consistently) and shuts down gracefully. Application-level **Export / Import** is also available under Admin → Database. Uninstalling removes `/data` — take a backup first.

---

See **[DOCS.md](DOCS.md)** for the full configuration reference, architecture diagram, and troubleshooting.
