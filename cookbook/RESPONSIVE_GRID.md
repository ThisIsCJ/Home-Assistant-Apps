# Responsive Column Grid (Foldable-Aware)

A small, portable CSS pattern for a card grid whose column count steps up with
screen width — tuned so a **Samsung Galaxy Fold** shows 1 column closed, 3 open,
and 4 on larger screens. Drop it into any app; only the class name and the numbers
change.

## The CSS

```css
/* Mobile-first column steps.
   Default = narrowest case; each min-width query raises the column count. */
.card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;              /* phones / Fold cover screen: 1 column */
}

@media screen and (min-width: 600px) {
  .card-grid {
    grid-template-columns: repeat(3, 1fr); /* Fold open (inner screen): 3 columns */
  }
}

@media screen and (min-width: 768px) {
  .card-grid {
    grid-template-columns: repeat(4, 1fr); /* tablets / desktop: 4 columns */
  }
}
```

```html
<div class="card-grid">
  <a class="card">…</a>
  <a class="card">…</a>
  <!-- … -->
</div>
```

That's the whole thing. It's **mobile-first**: the base rule is the smallest layout,
and each `min-width` breakpoint overrides it upward. A wider screen matches *all*
breakpoints ≤ its width; the last matching one wins, so order them ascending.

## How the breakpoints map to a Fold

| Device state | Reported CSS width | Rule that wins | Columns |
|---|---|---|---|
| Fold **closed** (cover screen) | `< 600px` | base | **1** |
| Fold **open** (inner screen) | `600–767px` | `min-width: 600px` | **3** |
| Tablet / desktop | `≥ 768px` | `min-width: 768px` | **4** |

### Why 600px, not 400px

The Fold's **cover** screen reports a CSS width in the ~400–500px range (not the tiny
number you'd guess from its physical size), and its **unfolded inner** screen reports
wider (~650px+). A breakpoint has to sit *between* those two widths to tell "closed"
from "open."

`600px` is that dividing line — it's also Material Design's standard phone → foldable/
tablet boundary. A lower value like `400px` fails because the closed cover screen is
already wider than 400px, so it wrongly gets the "open" layout.

> **The key lesson:** don't reason from the phone's *physical* size. Read the actual
> `window.innerWidth` the device reports (see below) and put your breakpoint between
> the closed and open values.

## Finding a device's real widths

The breakpoints only work if you know the CSS widths the target device reports. To
measure:

- **On the device:** open the site, then in remote DevTools (Chrome
  `chrome://inspect`, or Samsung Internet debugging) evaluate `window.innerWidth` —
  once with the device closed, once open.
- **In a desktop browser:** Chrome/Edge DevTools → device toolbar → the
  *Samsung Galaxy Z Fold* preset, and toggle its fold/span control.

Then set the middle breakpoint to any value strictly between the closed width and the
open width. If the open screen also reports `≥ 768px`, raise the 4-column breakpoint
above it (e.g. `min-width: 900px`) so "open" stays at 3 columns.

## Precedence gotcha (desktop-first codebases)

If the stylesheet you're dropping this into is **desktop-first** — i.e. it already has
`@media (max-width: …)` rules affecting the same element — a `max-width` rule and one
of these `min-width` rules can both match at the same width (e.g. both a
`max-width: 860px` and a `min-width: 600px` match at 700px). They usually have equal
specificity, so **whichever appears last in the source wins.**

Fix: put this block **after** those `max-width` rules — appending it near the end of
the stylesheet is the simplest guarantee. If you can't verify order, bump specificity
(e.g. `.panel .card-grid { … }`) instead.

You can confirm which rule wins in the built bundle:

```bash
# List every column rule for the element, in source order:
grep -oE '[^};]*card-grid\{grid-template-columns:[^}]*\}' dist/assets/*.css
```

The last line printed is the one that applies when multiple match.

## Adapting it

- **Different column counts:** change `repeat(N, 1fr)`.
- **More steps:** add more `min-width` blocks (keep them ascending).
- **Auto-fitting instead of fixed counts:** replace a step with
  `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));` to let the browser
  choose the count — but you lose exact control per device.
- **Consistent gaps:** set `gap` once on the base rule; it inherits across breakpoints.

## Where this lives in this repo

Implemented for the cookbook "Recently added" grid (`.cookbook-results`) at the end of
[`src/styles.css`](src/styles.css).
