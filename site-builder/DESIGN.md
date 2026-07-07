# Design System Reference

A complete guide to the visual language, layout structure, and component patterns used in this app. Use this to replicate the look and feel in a new project.

---

## Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

- **Body text**: `DM Sans` — weights 300, 400, 500, 600, 700
- **Numbers / code / data**: `JetBrains Mono` — used for all numeric readouts, tables, and monospace labels
- **Base font size**: `0.78rem` (very compact — this UI is information-dense)

---

## Color Palette

All colors are CSS custom properties on `:root`. The values below are the **Default skin** — the app ships with 13 selectable skins plus a user-defined Custom skin (see [Skins](#skins-theming)) that override this same variable set at runtime. Every skin is dark; components must only ever reference the variables, never raw hex values.

```css
:root {
  /* Backgrounds — layered from darkest to lightest */
  --bg:      #090e1a;   /* page background — deepest navy */
  --surface: #0f172a;   /* sidebar, topbar, modals */
  --card:    #131f35;   /* cards and panels */
  --card2:   #1a2744;   /* slightly elevated card variant */

  /* Borders */
  --border:  #1e3050;   /* subtle dividers inside cards */
  --border2: #243660;   /* stronger borders on cards/inputs */

  /* Text */
  --text:    #e2e8f0;   /* primary text */
  --muted:   #64748b;   /* secondary / placeholder text */
  --muted2:  #94a3b8;   /* mid-weight labels, icon colors */

  /* Accent */
  --accent:  #3b82f6;   /* blue — primary interactive color */
  --accent2: #60a5fa;   /* lighter blue — active states, highlights */

  /* Semantic colors */
  --green:   #10b981;
  --green2:  #34d399;
  --orange:  #f59e0b;
  --red:     #ef4444;
  --purple:  #a855f7;
}
```

### Color usage rules

| Purpose | Color |
|---------|-------|
| Primary CTA buttons | `--accent` → `#2563eb` gradient |
| Active nav item | `--accent2` text, `--accent` left border glow |
| Positive / healthy | `--green` / `--green2` |
| Warning / calories | `--orange` |
| Danger / delete | `--red` |
| Extra stat / streaks | `--purple` |
| Numeric data | `--accent2` (default), color-coded per meaning |

---

## Skins (Theming)

The app is themed by **skins** — named palettes that override the `:root` CSS variables at runtime (`frontend/src/lib/skins.js`). No stylesheet swap: `applySkin(id)` sets each variable via `root.style.setProperty`, so every component restyles instantly.

| Skin | Accent family | Notes |
|------|---------------|-------|
| Default | Blue `#3b82f6` | The palette documented above |
| Ares | Red | Dark maroon backgrounds |
| Mono | Gray | Achromatic |
| Slate | Indigo | |
| Poseidon | Sky/cyan | |
| Sisyphus | Purple | |
| Charizard | Orange | Warm brown backgrounds |
| Sienna | Amber/gold | |
| Catppuccin | Mauve/pink | Catppuccin Mocha base |
| Hepburn | Pink | |
| Nous | Teal | |
| Neon | Green/cyan on near-black | High-saturation accents |
| Geist Contrast | White on black | Maximum contrast |
| Custom | User-defined | Per-variable color pickers |

**Rules for skin compatibility:**
- Never hardcode background/text/accent hex values in components — always `var(--…)`. Semantic colors (`--green`, `--red`, `--orange`, `--purple`) are shared by all skins.
- Each skin defines exactly the 11 variables: `--bg`, `--surface`, `--card`, `--card2`, `--border`, `--border2`, `--text`, `--muted`, `--muted2`, `--accent`, `--accent2`.
- Each skin also declares `dots: [c1, c2, c3]` — three representative colors rendered in its picker tile.

**Persistence:** the selected skin id is written to `localStorage` (`ht_skin`) for instant application on load (`loadSavedSkin()`), and to the user's server-side preferences (`skin`, plus `customSkinVars` for the Custom skin) so it follows the account across devices.

### Skin picker tile (Settings → App → Skin)

A responsive grid of selectable tiles; the active tile gets a 2px accent border:

```
grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px;
```

```html
<button class="skin-tile">        <!-- inline-styled in Settings.jsx -->
  <div><!-- three 12px color dots, gap 5 --></div>
  <span>Skin Name</span>
</button>
```

- Tile: `background: var(--card)`, `border: 2px solid var(--border)`, `border-radius: 10px`, `padding: 10px 8px`, column-centered.
- Active: `border-color: var(--accent)`, name in `--accent2` at weight 700. Hover (inactive): border to `--border2`.
- The **Custom** tile's dots reflect the user's chosen `--accent` / `--card` / `--text`.

### Custom skin editor

Shown only while the Custom tile is active: a two-column grid of native `<input type="color">` swatches (34×30px, 5px radius), one per CSS variable, each with a label and the current hex in monospace. A "Copy from:" row of `btn-ghost btn-xs` buttons seeds the editor from a predefined skin. Edits apply live and save via the debounced preferences save.

---

## Global Reset

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

body {
  font-family: 'DM Sans', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  overflow: hidden;   /* scroll happens in .main-body, not the page */
  display: flex;
  flex-direction: column;
  font-size: 0.78rem;
}
```

---

## App Shell Layout

The app uses a **fixed-height shell** — no page-level scroll. The sidebar and topbar are fixed; only the content area scrolls.

```
┌─────────────────────────────────────────────────────┐
│  sidebar (240px)  │  topbar (46px height)           │
│                   ├─────────────────────────────────┤
│                   │                                 │
│  nav items        │   .main-body (scrollable)       │
│                   │   padding: 18px 20px            │
│                   │                                 │
└───────────────────┴─────────────────────────────────┘
```

```css
.app-shell {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background: var(--bg);
}

.sidebar {
  width: 240px;
  min-width: 240px;
  background: var(--surface);
  border-right: 1px solid var(--border2);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.content-shell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  height: 46px;
  background: var(--surface);
  border-bottom: 1px solid var(--border2);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  flex-shrink: 0;
}

.main-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
}
```

---

## Sidebar

### Brand logo area

```css
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 9px 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.sidebar-brand-text {
  font-size: 0.82rem;
  font-weight: 700;
  background: linear-gradient(135deg, #e2e8f0 30%, var(--accent2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.02em;
}
```

### Section labels

```css
.nav-section-label {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  padding: 10px 9px 4px;
}
```

### Nav items

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
  padding: 7px 9px;
  border-radius: 7px;
  color: var(--muted2);
  font-size: 0.76rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

/* Hover */
.nav-item:hover {
  background: rgba(59,130,246,0.06);
  color: var(--text);
}

/* Active — left accent bar + tinted bg */
.nav-item.active {
  background: rgba(59,130,246,0.12);
  color: var(--accent2);
  box-shadow: inset 2px 0 0 var(--accent);
}
```

---

## Topbar

The topbar contains:
- A hamburger (mobile only)
- A collapse toggle for the sidebar (desktop)
- Page title (gradient text, same treatment as brand)
- Spacer
- Action icons + user avatar

```css
.topbar-title {
  font-size: 0.85rem;
  font-weight: 700;
  background: linear-gradient(135deg, #e2e8f0 30%, var(--accent2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.02em;
}

/* Icon buttons in topbar */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border2);
  background: var(--card);
  color: var(--muted2);
  border-radius: 7px;
  height: 30px;
  min-width: 30px;
  cursor: pointer;
}
.icon-btn:hover {
  border-color: var(--accent2);
  color: var(--accent2);
}
```

---

## Page Header Pattern

Every page starts with a header row:

```html
<div class="page-header">
  <h1 class="page-title">Page Name</h1>
  <div class="page-actions">
    <button class="btn btn-pri">+ Add Item</button>
  </div>
</div>
```

```css
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #e2e8f0 30%, var(--accent2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

## KPI / Stat Cards

A 4-column grid of compact metric tiles:

```html
<div class="kpi-grid">
  <div class="kpi">
    <div class="lbl">Steps</div>
    <div class="val green">8,432</div>
    <div class="sub">goal: 10,000</div>
  </div>
  <!-- repeat... -->
</div>
```

```css
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.kpi {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 11px 13px;
}

.kpi .lbl {
  font-size: 0.6rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
}

.kpi .val {
  font-size: 1.35rem;
  font-weight: 700;
  margin-top: 3px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--accent2);  /* default blue */
}
.kpi .val.green  { color: var(--green2); }
.kpi .val.orange { color: var(--orange); }
.kpi .val.purple { color: var(--purple); }

.kpi .sub {
  font-size: 0.6rem;
  color: var(--muted);
  margin-top: 3px;
}
```

---

## Cards

Cards are the main content containers. They have a header with a colored dot indicator and a body.

```html
<div class="card">
  <div class="card-header">
    <span class="card-title green">Section Title</span>
    <button class="btn btn-sm btn-sec">Action</button>
  </div>
  <div class="card-body">
    <!-- content -->
  </div>
</div>
```

```css
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

/* Card title — uppercase, small, with glowing dot prefix */
.card-title {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted2);
  display: flex;
  align-items: center;
  gap: 6px;
}
.card-title::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);   /* glow effect */
}
/* Color variants for the dot */
.card-title.green::before  { background: var(--green);  box-shadow: 0 0 6px var(--green); }
.card-title.purple::before { background: var(--purple); box-shadow: 0 0 6px var(--purple); }
.card-title.orange::before { background: var(--orange); box-shadow: 0 0 6px var(--orange); }

.card-body { padding: 14px; }
```

---

## Buttons

Four variants, two size modifiers:

```css
/* Base */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  border: none;
  transition: all 0.18s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Primary — blue gradient with glow */
.btn-pri {
  background: linear-gradient(135deg, var(--accent), #2563eb);
  color: #fff;
  box-shadow: 0 0 10px rgba(59,130,246,0.25);
}
.btn-pri:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 16px rgba(59,130,246,0.35);
}

/* Secondary — bordered ghost */
.btn-sec {
  background: var(--card);
  border: 1px solid var(--border2);
  color: var(--muted2);
}
.btn-sec:hover:not(:disabled) { border-color: var(--accent2); color: var(--accent2); }

/* Ghost — no background */
.btn-ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted2);
}
.btn-ghost:hover:not(:disabled) { background: rgba(59,130,246,0.06); color: var(--text); }

/* Danger */
.btn-danger {
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  color: var(--red);
}
.btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.2); }

/* Size modifiers */
.btn-sm { padding: 4px 9px;  font-size: 0.7rem;  border-radius: 5px; }
.btn-xs { padding: 2px 7px;  font-size: 0.65rem; border-radius: 4px; }
```

---

## Inputs

```css
.input {
  background: var(--card);
  border: 1px solid var(--border2);
  border-radius: 5px;
  padding: 6px 9px;
  color: var(--text);
  font-family: inherit;
  font-size: 0.78rem;
  outline: none;
  transition: border-color 0.2s;
  width: 100%;
}
.input:focus { border-color: var(--accent); }
.input::placeholder { color: var(--muted); }

/* Input with label above */
.input-group { display: flex; flex-direction: column; gap: 4px; }
.input-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--muted2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

HTML:
```html
<div class="input-group">
  <label class="input-label">Field Name</label>
  <input class="input" type="text" placeholder="Enter value..." />
</div>
```

---

## Tabs

```css
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border2);
  margin-bottom: 16px;
}

.tab {
  padding: 9px 15px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 500;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s;
  cursor: pointer;
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent2); border-bottom-color: var(--accent); }
```

### Pill tab group (Settings)

The Settings page uses a second tab style — a contained pill group instead of the underline tabs. Use this variant when tabs switch between a small number of top-level views inside one page:

```css
.pill-tabs {
  display: flex;
  gap: 2px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
  width: fit-content;
  margin-bottom: 20px;
}
.pill-tab {
  padding: 5px 18px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 400;
  background: transparent;
  color: var(--muted);
  transition: all 0.15s;
}
.pill-tab.active {
  font-weight: 600;
  background: var(--card2);
  color: var(--text);
}
```

Settings tabs: **App** · **Integrations** · **Data**.

---

## Toggle Switch

Used for boolean settings (Settings → App → Alerts, Sync Sources). A labeled row with the switch pinned right; rows are separated by `--border` dividers.

```
┌───────────────────────────────────────────────┐
│ Browser Alerts                          (●──) │
│ Show desktop notifications for reminders      │
├───────────────────────────────────────────────┤
│ Email Notifications                     (──●) │
│ Receive weekly digests by email               │
└───────────────────────────────────────────────┘
```

- **Row**: `<label>`, flex, `justify-content: space-between`, `padding: 10px 0`, `border-bottom: 1px solid var(--border)`, whole row clickable.
- **Label**: `0.78rem`, weight 500, `--text`. **Sub-label**: `0.68rem`, `--muted`, `margin-top: 2px`.
- **Track**: 40×22px, `border-radius: 11px`. Off: `background: var(--bg2)`, `border: 1px solid var(--border)`. On: background and border `--accent`.
- **Knob**: 16px circle, `top: 2px`, `left: 2px` → `left: 19px` when on, `transition: left 0.18s`. Off knob is `--muted`, on knob is `#fff`.

**Permission-aware toggles**: the Browser Alerts toggle only reads ON when the app preference **and** the real browser permission agree (`Notification.permission === 'granted'`). If the browser has denied permission, the toggle stays OFF and the sub-label explains how to re-enable it ("Blocked by browser — open site settings…"). Never show a toggle ON for a capability the browser will not deliver.

---

## Status Banners & Indicators

### Inline status banner

Used for operation results and degraded states (Settings header refresh result, Google Drive "Reconnect required"). A rounded box with an `rgba` tint of the semantic color, matching border, and colored text:

```css
.banner        { font-size: 0.72rem; padding: 8px 12px; border-radius: 7px; line-height: 1.5; }
.banner-error   { background: rgba(239,68,68,0.08);  border: 1px solid rgba(239,68,68,0.25);  color: var(--red); }
.banner-success { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); color: var(--green2); }
```

A banner may carry a heading (weight 600, semantic color), body text in `--text`, and an action button (`btn-pri btn-sm`) — e.g. the Drive sync banner: *"Google Drive sync is paused — authorization expired"* + explanation + **Reconnect Google Drive** button.

### Status dot row

Connection/health rows (Drive credentials, DB status) lead with a 7px dot:

```css
.status-dot { width: 7px; height: 7px; border-radius: 50%; }
/* green = connected · yellow = configured but not connected · red = action required */
```

Followed by a bold `0.73rem` state label ("Connected" / "Reconnect required") and a `0.65rem` monospace sub-line (masked client id, last-sync timestamp).

---

## Tables

```css
.table-wrap {
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--border2);
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
}

thead th {
  background: var(--surface);
  padding: 8px 12px;
  text-align: left;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border2);
}

tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 0.78rem;
  color: var(--text);
}

/* Numeric cells — right-aligned, monospace */
thead th.num { text-align: right; }
tbody td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.71rem;
}

tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: rgba(59,130,246,0.04); }
```

---

## Badges / Pills

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge-blue   { background: rgba(59,130,246,0.15);  color: var(--accent2); }
.badge-green  { background: rgba(16,185,129,0.15);  color: var(--green2); }
.badge-orange { background: rgba(245,158,11,0.15);  color: var(--orange); }
.badge-red    { background: rgba(239,68,68,0.15);   color: #fca5a5; }
.badge-purple { background: rgba(168,85,247,0.15);  color: var(--purple); }
.badge-muted  { background: rgba(100,116,139,0.15); color: var(--muted2); }
```

---

## Progress Bars

```css
.progress-bar {
  height: 6px;
  background: var(--border2);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.progress-fill.blue   { background: linear-gradient(90deg, var(--accent), var(--accent2)); }
.progress-fill.green  { background: linear-gradient(90deg, var(--green), var(--green2)); }
.progress-fill.orange { background: var(--orange); }
.progress-fill.red    { background: var(--red); }
```

HTML:
```html
<div class="progress-bar">
  <div class="progress-fill blue" style="width: 65%"></div>
</div>
```

---

## Modal

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: 12px;
  padding: 20px;
  max-width: 520px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.modal-title { font-size: 0.9rem; font-weight: 700; color: var(--text); }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
```

---

## Toast Notifications

Stack of toasts pinned to bottom-right:

```css
.toast-stack {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 600;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(360px, calc(100vw - 36px));
}

.toast {
  border: 1px solid var(--border2);
  background: var(--surface);
  color: var(--text);
  border-radius: 8px;
  padding: 9px 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.28);
  font-size: 0.74rem;
  line-height: 1.35;
}

.toast-success { border-color: rgba(16,185,129,0.35); color: var(--green2); }
.toast-error   { border-color: rgba(239,68,68,0.4);   color: #fca5a5; }
.toast-warning { border-color: rgba(245,158,11,0.4);  color: var(--orange); }
```

---

## Settings Page Composition

The Settings page (`/settings`) is the reference for form-heavy pages. Structure:

- **Header row**: `page-header` with the gradient `page-title`, a transient `badge-green` "✓ Saved" indicator (auto-save feedback, appears ~2s after a change persists), and a `btn-sec btn-sm` "Refresh Data" action.
- **Pill tab group** (see [Tabs](#pill-tab-group-settings)): App · Integrations · Data.
- **Content column**: `max-width: 640px`, cards stacked vertically with `gap: 14px`. Settings never use the full page width.
- **Auto-save**: preference fields save on change through a debounced (600ms) PUT; there are no per-card Save buttons on the App tab. Sections that manage credentials (Integrations tab) use explicit Save/Connect buttons instead.

### App tab cards, top to bottom

**User Details** — read-only identity card. Label–value rows (`0.72rem` muted label at fixed 40px width, `0.78rem` value); the user ID renders in a `<code>` block (`0.7rem`, `--bg2` background, bordered, `word-break: break-all`). Roles render as pills: admin = red tint (`rgba(239,68,68,0.12)` bg, `--red` text), other roles = blue tint (`rgba(96,165,250,0.12)`, `--accent2`), `0.68rem`, weight 600, capitalized.

**General** — `input-group` fields stacked with `gap: 16px`:
- *Timezone*: a `select.input` of IANA timezone names (underscores displayed as spaces).
- *Units*: a button-row segmented control — one `btn btn-sm` per option (`metric` / `imperial` / `mixed`); the active option uses `btn-pri`, the rest `btn-sec`. This button-row pattern is the standard for 2–4 mutually exclusive choices.

**Nutrition Goals** — card title uses the `green` dot variant. A `1fr 1fr` grid (`gap: 12px`) of numeric `input mono` fields: Calories (kcal/day), Protein, Carbs, Fat (g/day). Numeric inputs always take the `mono` class so digits align.

**Skin** — the skin picker grid + custom editor (see [Skins](#skins-theming)).

**Alerts** — a stack of [Toggle Switch](#toggle-switch) rows: *Browser Alerts* (permission-aware — see the toggle rules) and *Email Notifications*.

### Integrations tab cards

AI Providers, API Tokens, Cookbook, **Sync Sources**, Google Drive Sync. Two newer patterns worth reusing:

**Sync Sources** — resolves multi-source write conflicts. Two sub-groups inside one card:
- *"Sparky may sync"*: a responsive toggle grid — `repeat(auto-fill, minmax(220px, 1fr))`, `gap: 6px` — one Toggle per metric group (Steps, Heart rate, Sleep, …). A disabled toggle shows the sub-label "Ignored — another source owns this". Use this grid form when a card holds many parallel boolean options.
- *Drive file variant*: an inline `select.input` (auto width) beside a bold `0.73rem` label, followed by a `0.68rem` muted tip paragraph explaining the trade-off.

**Google Drive Sync** — demonstrates the stateful-connection card: status dot row → credentials form (`--bg2` inset panel, bordered, radius 8) → error banner (reconnect) when the grant dies → folder browser (a `max-height: 240px` scrollable bordered list of checkbox rows, checkboxes tinted via `accent-color: var(--accent)`, matched rows tinted `rgba(20,184,166,0.06)` with a small "Health Sync" badge) → schedule select + "Sync Now" (`btn-pri btn-xs`) and history (`btn-ghost btn-xs`) actions in the card header.

---

## Empty States

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--muted);
  text-align: center;
  gap: 8px;
}
.empty-state-icon { color: var(--border2); margin-bottom: 4px; }
.empty-state-text { font-size: 0.78rem; }
.empty-state-sub  { font-size: 0.7rem; color: var(--muted); }
```

---

## Grid Layouts

```css
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
```

---

## Login Page

The login page is centered on the full screen with a subtle radial gradient background:

```css
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  background-image:
    radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 70% 20%, rgba(168,85,247,0.04) 0%, transparent 50%);
}

.login-card {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: 16px;
  padding: 36px;
  width: 100%;
  max-width: 380px;
  text-align: center;
}

.login-logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--accent), #2563eb);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
  box-shadow: 0 0 24px rgba(59,130,246,0.4);
}
```

---

## Scrollbar Styling

```css
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
::-webkit-scrollbar-track { background: transparent; }
```

---

## Utility Classes

A minimal set of layout helpers — not a full framework:

```css
.flex         { display: flex; }
.flex-col     { display: flex; flex-direction: column; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-1  { gap: 4px; }
.gap-2  { gap: 8px; }
.gap-3  { gap: 12px; }
.mt-1   { margin-top: 4px; }
.mt-2   { margin-top: 8px; }
.mt-3   { margin-top: 12px; }
.mt-4   { margin-top: 16px; }
.mb-2   { margin-bottom: 8px; }
.mb-3   { margin-bottom: 12px; }
.mb-4   { margin-bottom: 16px; }
.text-muted  { color: var(--muted2); }
.text-sm     { font-size: 0.7rem; }
.text-xs     { font-size: 0.63rem; }
.font-bold   { font-weight: 700; }
.w-full      { width: 100%; }
.relative    { position: relative; }
.mono        { font-family: 'JetBrains Mono', monospace; }
```

---

## Responsive Breakpoints

| Breakpoint | Behavior |
|------------|----------|
| `< 600px` (mobile) | Sidebar slides in as an overlay (hamburger menu). KPI grid becomes 2-col. Multi-col grids collapse to 1-col. |
| `600px – 1023px` (tablet) | Sidebar icon-only (60px wide, no labels). KPI grid 2-col. |
| `≥ 1024px` (desktop) | Full 240px sidebar. KPI grid 4-col. |

```css
@media (max-width: 599px) {
  .sidebar {
    position: fixed;
    z-index: 90;
    top: 0; bottom: 0; left: 0;
    width: min(82vw, 300px) !important;
    transform: translateX(-100%);
  }
  /* open state toggled by JS: data-mobile-nav="open" on .app-shell */
  .app-shell[data-mobile-nav="open"] .sidebar { transform: translateX(0); }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
  .main-body { padding: 12px 12px 80px; }
}

@media (min-width: 600px) and (max-width: 1023px) {
  .sidebar { width: 60px; min-width: 60px; padding: 10px 8px; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .grid-3   { grid-template-columns: repeat(2, 1fr); }
}
```

---

## Typography Conventions

| Element | Size | Weight | Color | Notes |
|---------|------|--------|-------|-------|
| Page title | `1.05rem` | 700 | gradient text | `letter-spacing: -0.02em` |
| Card title | `0.65rem` | 700 | `--muted2` | Uppercase, `letter-spacing: 0.1em` |
| Section label | `0.58rem` | 700 | `--muted` | Uppercase, `letter-spacing: 0.1em` |
| KPI value | `1.35rem` | 700 | color-coded | JetBrains Mono |
| Body text | `0.78rem` | 400 | `--text` | Default size |
| Table data | `0.78rem` | 400 | `--text` | Numeric cells: mono, `0.71rem` |
| Badge / pill | `0.6rem` | 700 | color-coded | Uppercase |
| Muted label | `0.65rem` | 600 | `--muted2` | Input labels, metadata |

### Gradient text (used on all major headings)

```css
background: linear-gradient(135deg, #e2e8f0 30%, var(--accent2));
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
letter-spacing: -0.02em;
```

---

## Design Principles Summary

1. **Dark, layered depth** — three background tones (`--bg` → `--surface` → `--card`) create hierarchy without borders alone.
2. **Accent everywhere interactive** — hover states, active nav, focus rings, and primary buttons all use the accent family (`--accent` / `--accent2`). Blue in the Default skin, but the accent is skinnable — never assume blue.
3. **Glowing dots as section markers** — `card-title::before` creates a small pulse dot with `box-shadow` glow in the relevant accent color.
4. **Gradient text on all headings** — gives the UI a premium feel without images.
5. **Compact type scale** — base at `0.78rem`, never go above `1.1rem` except for KPI numbers. Information density is a feature.
6. **JetBrains Mono for data** — all numeric output, tables, and code use the monospace font to align digits.
7. **Subtle interactions** — hover states use `rgba` tints over existing backgrounds rather than solid color swaps. Primary button lifts `1px` on hover.
8. **No scroll at the page level** — only `.main-body` scrolls. The sidebar and topbar are always visible.
9. **Variables-only theming** — skins repaint the whole app by overriding 11 CSS variables at runtime. Any hardcoded background/text/accent hex in a component is a bug; semantic colors (`--green`, `--red`, `--orange`, `--purple`) are the only palette constants.
10. **Silent auto-save with visible state** — preference fields persist on change (debounced); feedback comes from a transient "Saved" badge, status dots, and banners rather than blocking dialogs. UI state must reflect reality (e.g. a toggle never shows ON if the browser permission is denied).
