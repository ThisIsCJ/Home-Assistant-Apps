# Security Remediation Plan

Findings from the security review of the DevOps Platform add-on, ordered by
priority. Each item lists the file(s), the root cause, and the concrete fix.

Deployment context: the shipped add-on always runs with `AUTH_MODE=ha_ingress`
and nginx restricts inbound traffic to the HA ingress gateway. Identity comes
entirely from `X-Remote-User-*` headers. Severities are calibrated against that
reality, but several issues also affect the standalone OIDC mode the code
supports.

---

## P0 — Fix immediately (unauthenticated takeover / privilege escalation)

### 1. `requireSetupOrAdmin` bypasses auth on config-write endpoints
- **Files:** `app/api/routes/config.js` (`requireSetupOrAdmin`, lines 93-105; guards `/site` L229, `/auth-providers/*` L148/L161/L194, `/onboarding/:step` L124)
- **Root cause:** When zero auth providers are active (always true in HA ingress
  mode) the middleware calls `next()` with no `requireAuth`/`requireAdmin`. Any
  panel user can `POST /api/config/site` with `adminUsers:["me@homeassistant.local"]`
  and, because `requireAdmin` trusts `site.adminUsers`, immediately become admin.
- **Fix:**
  - Split the two concerns. Genuine first-run setup (nothing configured yet)
    may be open, but once `onboarding.complete` is true these endpoints must
    require admin unconditionally.
  - `/site` should **always** be `requireAuth + requireAdmin` — it is never a
    setup-only endpoint.
  - In HA ingress mode, treat setup as complete (config already forces
    `onboardingComplete: true`), so the `activeCount === 0` branch must not
    grant anonymous write access. Gate the setup bypass on
    `!HA_INGRESS && !onboarding?.complete`.
  - Add a first-run bootstrap token (env-provided) for the truly-empty case
    instead of leaving it open.

### 2. Unverified-JWT authentication fallback
- **File:** `app/shared/auth.js` lines 190-192 (`authenticateToken`)
- **Root cause:** With no provider match, the JWT is base64-decoded **without
  signature verification** and its `sub`/`groups` are trusted → forge
  `{"sub":"x","groups":["devops-admins"]}` to become admin.
- **Fix:** Remove the fallback. If a dev/no-auth mode is genuinely needed, gate
  it behind an explicit `AUTH_INSECURE_DECODE=1` flag that defaults off and logs
  a loud warning on every use.

### 3. `bootstrap-admin` can be re-triggered
- **File:** `app/api/routes/config.js` lines 203-226 (`/bootstrap-admin`)
- **Root cause:** The guard only blocks when `onboarding.complete && adminUsers.length > 0`.
  Any time `adminUsers` is empty — even long after setup — any authenticated
  user can `$addToSet` their own email into `site.adminUsers`.
- **Fix:** Restrict to a genuine, non-recurring first-run state (e.g. a
  dedicated `onboarding.admin_bootstrapped` flag set once and never cleared),
  and require the DB to be in the pre-complete state.

---

## P1 — High (stored XSS, header trust, token validation)

### 4. Arbitrary-extension stored XSS in uploads
- **File:** `app/api/routes/uploads.js` lines 16, 24-28, 42-47
- **Root cause:** Stored extension is taken from client `originalname` while the
  filter validates only client `mimetype` — both attacker-controlled. `mimetype:
  image/png` + `originalname: evil.html` is stored as `<uuid>.html` and served
  inline as `text/html` from the app origin. `image/svg+xml` is also allowed and
  can carry `<script>`.
- **Fix:**
  - Derive the stored extension from a **server-side allowlist** keyed to the
    detected content type (sniff magic bytes with e.g. `file-type`), not the
    client filename.
  - Drop `svg+xml`, or serve all uploads with `Content-Disposition: attachment`
    and a restrictive `Content-Security-Policy` (e.g. `default-src 'none'`).
  - Reject files whose sniffed type is not in the image allowlist.

### 5. nginx does not strip inbound `X-Remote-User-*` headers
- **Files:** `rootfs/etc/nginx/nginx.conf` (all `location` proxy blocks, L37-L83);
  identity trusted in `app/shared/auth.js` lines 21-36
- **Root cause:** Client-supplied `X-Remote-User-*` headers are forwarded to the
  Node backends unchanged; the app trusts them as the sole identity, and with
  `ADMIN_USERS` empty every user is admin.
- **Fix:** In every proxied `location`, explicitly clear them before proxying so
  only the ingress gateway's values survive:
  ```nginx
  proxy_set_header X-Remote-User-Name "";
  proxy_set_header X-Remote-User-Display-Name "";
  proxy_set_header X-Remote-User-Id "";
  ```
  (The Supervisor re-adds the trusted values.) Keep backends bound to
  `127.0.0.1` (already the case via `BIND_HOST`).

### 6. JWT audience (`aud`) not verified
- **File:** `app/shared/auth.js` line 133 (`jwtVerify`)
- **Root cause:** Only `issuer` is checked. On a shared IdP, a token minted for a
  different client is accepted here.
- **Fix:** Pass `audience: provider.client_id` to `jwtVerify` (the client id is
  already stored on the provider doc). Affects standalone OIDC mode.

---

## P2 — Medium (info disclosure, secret handling)

### 7. Public config discloses the admin roster
- **File:** `app/api/routes/config.js` line 41 (`GET /public`, unauthenticated)
- **Fix:** Remove `adminUsers` (and ideally `adminGroup`/`userGroup`) from the
  public payload; expose them only on an authenticated admin endpoint.

### 8. DB export leaks integration secrets; import overwrites unchecked
- **File:** `app/modules/provisioning/routes/admin.js` lines 845-882
- **Root cause:** `/db/export` dumps the `integrations` collection with plaintext
  Cloudflare tokens / NPM password / n8n key (every other endpoint masks them).
  `/db/import` does `deleteMany({}) + insertMany` with no validation.
- **Fix:** Encrypt secrets at rest, or omit/re-mask secret fields from the
  export. Warn clearly that the backup contains live credentials. Validate the
  import payload shape before wiping collections.

---

## P3 — Hardening

- **Unvalidated `subdomain`** — `app/modules/provisioning/routes/requests.js`
  L205-239: validate against `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` before
  building the FQDN / DNS record / proxy route.
- **Error handler leaks internals** — `app/api/server.js` L22-25 and
  `app/modules/provisioning/server.js` L23-26 return `err.message`. Log
  server-side, return a generic message to the client.
- **No request body size limit** — `app/api/server.js` L11: use
  `express.json({ limit: '100kb' })` (multer handles uploads separately).
- **`requireAdmin` null deref** — `app/shared/requireAdmin.js` L27-28: guard with
  `req.user?.email`.
- **Unbounded caches** — `app/shared/auth.js` L64 (`tokenCache`), plus
  `discoveryCache`/`persistedAt`: add LRU/max-size eviction to prevent
  token-flood memory growth.
- **Upload quota** — `app/api/routes/uploads.js` L34: add a per-user file
  count/size cap so `/data/uploads` can't be filled.
- **Add a CSP** — a restrictive Content-Security-Policy (via nginx or the API)
  materially reduces the impact of any residual XSS.

---

## Suggested sequencing

1. P0 items 1–3 (single PR — they share the auth/setup surface).
2. P1 item 4 (uploads) and item 5 (nginx headers) — independent, quick.
3. P1 item 6 + P2 items 7–8.
4. P3 hardening as a follow-up sweep.

Each fix should ship with a regression test: forge-token rejection, anonymous
`POST /site` returns 401/403, `.html`/`.svg` upload rejected, spoofed
`X-Remote-User-*` header ignored.
