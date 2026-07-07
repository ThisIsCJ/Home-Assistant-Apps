# Home Assistant Add-on: GitHub Static Site WYSIWYG Editor

## Goal

Create a Home Assistant add-on that provides a WYSIWYG static webpage editor. The add-on allows users to edit static websites stored in GitHub repositories, preview changes, save drafts, and push updates back to GitHub.

## Core Features

### Home Assistant Add-on

The app must run as a Home Assistant add-on.

It should include:

* Web UI exposed through the Home Assistant sidebar
* Add-on configuration tab support
* Persistent storage for cloned repositories, drafts, user access settings, and site metadata
* Secure handling of SSH keys
* Authentication based on Home Assistant users and add-on-defined admin accounts

## Configuration

Admin accounts are defined in the Home Assistant add-on configuration tab.

Example configuration:

```yaml
admins:
  - username: admin_user_1
  - username: admin_user_2

app:
  data_path: /data
  repo_path: /data/repos
  draft_path: /data/drafts
```

Only configured admins can:

* Add sites
* Remove sites
* Configure GitHub repo links
* Configure SSH keys
* Assign user access to sites
* View all sites

## User Roles

### Admin

Admins can:

* Create sites
* Edit site settings
* View all sites
* Assign users to sites
* Pull from GitHub
* Push to GitHub
* View site history
* Edit site content
* Preview sites

### Standard User

Standard users can:

* See only sites they have access to
* Edit assigned sites
* Save drafts
* Preview sites
* Sync from GitHub, if permitted
* Push to GitHub, if permitted

## Site Management

Admins can create a new site by providing:

* Site name
* GitHub repository URL
* Branch name
* Optional SSH key
* Build command, if needed
* Static output directory, if needed
* User access list

Example site object:

```json
{
  "id": "my-static-site",
  "name": "My Static Site",
  "repo_url": "git@github.com:user/site.git",
  "branch": "main",
  "ssh_key_id": "site-key-1",
  "local_path": "/data/repos/my-static-site",
  "users": ["alice", "bob"],
  "created_at": "2026-07-06T00:00:00Z",
  "updated_at": "2026-07-06T00:00:00Z"
}
```

## Layout

### Global Layout

The app should have a left sidebar menu.

The sidebar should show:

* App name
* List of sites the current user has access to
* Admin section, visible only to admins
* Settings, visible only to admins

### Site Page

Each site page should include:

* Site title
* Current branch
* Repository URL
* Last synced time
* Last pushed time
* Editor panel
* Preview panel
* Action toolbar

The action toolbar should include:

* Sync from GitHub
* Save Draft
* Preview Site
* Push to GitHub
* View History

## WYSIWYG Editor

The editor should allow users to visually edit static webpage content.

Required editor features:

* Edit text directly on the page
* Update headings, paragraphs, buttons, links, and images
* Basic formatting controls
* Save changes without immediately pushing to GitHub
* Detect modified files
* Support editing HTML files at minimum
* Preferably support Markdown and common static site content formats

The editor should preserve existing site structure as much as possible.

## Preview

The app must provide a preview option.

Preview should:

* Show the current edited version of the site
* Run locally inside the add-on
* Not require pushing changes to GitHub
* Support saved drafts
* Support unsaved current editor state when possible

If the site requires a build step, the app should run the configured build command before previewing.

## GitHub Sync

The Sync button should:

* Pull the latest code from GitHub
* Use the configured repo URL and SSH key
* Detect conflicts
* Warn the user if they have unsaved local changes
* Show success or error messages

## Save Draft

The Save Draft option should:

* Save the user’s current work locally
* Not push to GitHub
* Allow the user to return later and continue editing
* Store drafts per user and per site

Draft metadata should include:

```json
{
  "site_id": "my-static-site",
  "user": "alice",
  "files_changed": ["index.html", "about.html"],
  "saved_at": "2026-07-06T00:00:00Z"
}
```

## Push to GitHub

The Push to GitHub option should:

* Commit the user’s changes
* Push to the configured GitHub repository
* Use the configured SSH key
* Require a commit message
* Record the pushed change in site history

Commit message form:

```text
Update site content from Home Assistant editor
```

The app should allow the user to customize the commit message before pushing.

## History

Each site should have a history page showing every pushed change.

History should include:

* Commit hash
* Commit message
* Author/user
* Date/time
* Files changed
* Push status

Example:

```json
{
  "commit_hash": "abc1234",
  "message": "Updated homepage text",
  "author": "alice",
  "timestamp": "2026-07-06T00:00:00Z",
  "files_changed": ["index.html"],
  "status": "pushed"
}
```

## Access Control

Users should only see sites they are allowed to access.

Admins should be able to assign users to sites.

Access settings should be stored persistently.

Example:

```json
{
  "site_id": "my-static-site",
  "allowed_users": ["alice", "bob"]
}
```

## Security Requirements

* SSH keys must be stored securely
* SSH keys should not be visible after being saved
* Only admins can add or replace SSH keys
* Users cannot access repositories they are not assigned to
* Git commands must be sandboxed to the site directory
* Validate repo URLs before cloning
* Prevent path traversal attacks
* Do not expose raw filesystem paths in the UI

## Suggested Tech Stack

Backend:

* Python FastAPI or Node.js Express
* Git CLI or libgit2 wrapper
* SQLite for metadata
* File-based storage for cloned repositories and drafts

Frontend:

* React or Vue
* WYSIWYG editor such as GrapesJS, Tiptap, Editor.js, or similar
* Split-pane editor and preview layout

Home Assistant Add-on:

* Docker-based add-on
* ingress support
* persistent `/data` volume
* add-on config schema
* support for Home Assistant authentication headers where available

## API Requirements

### Get Sites

```http
GET /api/sites
```

Returns sites available to the current user.

### Create Site

```http
POST /api/sites
```

Admin only.

### Update Site

```http
PATCH /api/sites/:siteId
```

Admin only.

### Sync Site

```http
POST /api/sites/:siteId/sync
```

Pulls latest code from GitHub.

### Save Draft

```http
POST /api/sites/:siteId/draft
```

Saves current user draft.

### Get Draft

```http
GET /api/sites/:siteId/draft
```

Loads current user draft.

### Push Changes

```http
POST /api/sites/:siteId/push
```

Commits and pushes changes to GitHub.

Payload:

```json
{
  "commit_message": "Updated homepage content"
}
```

### Get History

```http
GET /api/sites/:siteId/history
```

Returns pushed changes.

### Preview Site

```http
POST /api/sites/:siteId/preview
```

Builds and serves a preview of the current site.

## UI Pages

### Dashboard

Shows all sites the current user can access.

### Site Editor

Main editing interface for a site.

Includes:

* File/page selector
* WYSIWYG editor
* Preview button
* Save Draft button
* Sync button
* Push to GitHub button

### Site History

Shows pushed changes.

### Admin Sites

Admin-only page for managing sites.

### Admin Access

Admin-only page for assigning users to sites.

### Admin SSH Keys

Admin-only page for adding or replacing SSH keys.

## Expected User Flow

1. Admin opens the add-on.
2. Admin creates a site by entering a GitHub repo URL.
3. Admin optionally adds an SSH key.
4. App clones the repo.
5. Admin gives users access to the site.
6. User opens the add-on.
7. User sees the site in the left menu.
8. User opens the site editor.
9. User edits the static webpage using the WYSIWYG editor.
10. User previews the site.
11. User saves a draft or pushes to GitHub.
12. Site history records the pushed change.

## Deliverables

The finished project should include:

* Home Assistant add-on structure
* Dockerfile
* `config.yaml`
* Backend API
* Frontend web app
* GitHub repo clone/pull/push support
* SSH key management
* WYSIWYG static site editor
* Preview server
* Draft saving
* Push history
* Admin site management
* User access control

## Success Criteria

The app is complete when:

* It installs as a Home Assistant add-on
* Admins can configure users in the add-on config tab
* Admins can add GitHub-backed sites
* Admins can assign users to sites
* Users only see assigned sites
* Users can edit site content visually
* Users can preview changes
* Users can save drafts
* Users can pull latest code from GitHub
* Users can push changes to GitHub
* Each pushed change appears in site history
