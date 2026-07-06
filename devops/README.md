# DevOps Platform — Home Assistant Add-on Repository

Home Assistant add-on packaging of the [DevOps Platform](https://github.com/csaba/devops-platform) — a self-hosted provisioning, monitoring and site-request portal.

## Installation

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**.
2. Open the **⋮** menu (top right) → **Repositories**, and add the URL of this repository.
3. Find **DevOps Platform** in the store list and click **Install**.
4. Start the add-on, then click **Open Web UI** (or use the **DevOps** entry in the sidebar).

## Add-ons

| Add-on | Description |
|--------|-------------|
| [DevOps Platform](devops-platform/) | Provisioning, monitoring and site-request platform (nginx + Node.js services + MongoDB in a single container, served through HA ingress) |

## Local development

The original multi-container (docker-compose + Authentik OIDC) variant of this app lives in `devops-platform` repo; this repository is the Home Assistant conversion. The differences are documented in [devops-platform/DOCS.md](devops-platform/DOCS.md).
