# webterm

A CSS framework where every element occupies an integer number of character
cells. Borders are box-drawing glyphs, not 1px rules; spacing is in cells, not
rem; and hierarchy comes from bold, dim, inverse and color — never from a
font-size change.

Think "Bootstrap, but the layout engine is a character grid."

```
┌─ Hosts ────────────────────────────────┐
│ HOST    │ ROLE     │ LOAD │ STATE      │
│ ────────┼──────────┼──────┼─────────── │
│ alpha   │ primary  │ 0.41 │ ok         │
│ bravo   │ replica  │ 1.07 │ ok         │
│ charlie │ replica  │ 3.92 │ degraded   │
└────────────────────────────────────────┘
```

This is not a terminal emulator and not a dark skin. Existing terminal
stylesheets set a monospace font and a dark palette, but their borders are CSS
`border: 1px` and their spacing is in rem, so nothing lands on a character
boundary and the illusion breaks as soon as you look closely. Here the grid
itself is character-faithful: resize the window and the page snaps to a whole
column count.

The core is CSS only, with no dependencies and no build step. An optional
behavior layer adds toasts, loading states, placeholders and modals — and the
CSS never depends on it, so every one of those has a static form that renders
with no script loaded.

## Quick start

### From a CDN

jsDelivr serves the repo directly. Two stylesheets and one class on `<html>`:

```html
<!doctype html>
<html lang="en" class="font-jetbrains-mono">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/kent-orr/webterm@main/fonts/webterm-fonts.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/kent-orr/webterm@main/src/webterm.css">
</head>
<body>
  <div class="screen">
    <h1>webterm</h1>
    <p class="mt-1">Every element here is a whole number of cells.</p>
  </div>
</body>
</html>
```

That is a complete page. `webterm.css` imports the nine grid files and the
default theme, Pawpaw, so it paints without a theme `<link>`.

`@main` is a moving target — jsDelivr caches it for 12 hours at the edge and 7
days in the browser, so pushes reach other people late and unevenly. For
anything you share, pin a release tag instead:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/kent-orr/webterm@v0.1.0/fonts/webterm-fonts.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/kent-orr/webterm@v0.1.0/src/webterm.css">
```

`raw.githubusercontent.com` does **not** work. It serves CSS as `text/plain`
with `X-Content-Type-Options: nosniff`, so the browser refuses to apply it.

For toasts, loading states, placeholders and modals, add the behavior layer —
one ES module, no build step, nothing else to install:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/kent-orr/webterm@main/src/behavior/webterm.js"></script>
```

It is optional: the stylesheet above is a whole framework without it. See
[Behavior](#behavior).

### Self-hosted

```sh
git clone https://github.com/kent-orr/webterm.git
```

Copy `src/` and `fonts/` into your project and link them with relative paths.
The `@import`s inside `webterm.css` and the `url()`s inside
`webterm-fonts.css` are all relative, so the two directories work anywhere as
long as their internal layout is preserved.

Fonts must be served over http — Chromium will not load a `@font-face` file
over `file://`. There is a server in the repo for that:

```sh
npm run serve          # then open the printed URL: the test page index
```

### Picking a theme

```html
<link rel="stylesheet" href=".../fonts/webterm-fonts.css">
<link rel="stylesheet" href=".../src/webterm.css">
<link rel="stylesheet" href=".../src/themes/tomorrow-night.css">
```

Nine themes ship: `pawpaw` (the default), `tomorrow-night`, `solarized-dark`,
`solarized-light`, `gruvbox-dark`, `dracula`, `nord`, `green-phosphor`,
`amber-phosphor`.

A theme `<link>` replaces the default whole, and it works whether the link
comes before or after `webterm.css`: the default is imported into a cascade
layer, and an unlayered rule beats a layered one at any order.

### Picking a font

Put exactly one font class on `<html>`:

| class                   | font             | row at 16px |
|-------------------------|------------------|-------------|
| `font-jetbrains-mono`   | JetBrains Mono   | 20px        |
| `font-iosevka`          | Iosevka          | 19px        |
| `font-dejavu-sans-mono` | DejaVu Sans Mono | 18px        |

All three are bundled as full-coverage woff2. Do not substitute a Google Fonts
or Fontsource build of JetBrains Mono: those omit U+2500–259F, so every border
silently falls back to another font with different metrics and the seams show.

Each font carries a calibrated line-height ratio, measured in Chromium at
sizes 10–32px, that keeps `│` and `█` connecting vertically. A font without its
own calibration will seam, which is why the family stacks name no second font.

## The rules

Every component satisfies these. If you extend webterm, keep them.

1. One cell is `1ch` wide by `1lh` tall. Horizontal lengths are `Nch`,
   vertical lengths `Nlh`. No `px`, `rem`, `em` or `%` inside `.screen`.
2. One font, one size, one line-height for the whole document. Never changed
   per element.
3. Hierarchy comes only from bold, dim, inverse, underline, color, whitespace
   and uppercase. No size changes.
4. Borders are glyphs. Never CSS `border` with a px width.
5. Unicode box-drawing is the default; an ASCII style is available as an option.
6. No raster images in core.
7. Wide glyphs (CJK, emoji) are out of scope — they occupy two cells and
   nothing here accounts for that.
8. Breakpoints are column counts (`@container (min-width: 80ch)`), not pixels.

## Usage

### Layout

```html
<div class="screen">              <!-- snaps to a whole column count -->
  <div class="row">
    <div class="col-24">…</div>   <!-- exactly 24 cells -->
    <div class="col">…</div>      <!-- fills the rest -->
  </div>
</div>
```

- `.screen` — rounds its width down to a whole number of cells and centers it.
  It is also the container for column breakpoints, so a `.row` inside it
  stacks below 64 columns.
- `.screen-80`, `.screen-100`, `.screen-120` — fixed widths, for a classic
  terminal page.
- `.row` — flex row with a 1-cell gutter, so N columns lose N−1 cells to gaps.
- `.col` — fills the remaining cells.
- `.col-N` — exactly N cells, for N in 4, 8, 12, 16, 20, 24, 32, 40.
- `.stack > *` — one row of space between children.
- `.mt-1` `.mt-2` `.mb-1` `.mb-2` `.pad` `.center` `.right` — spacing and
  alignment in whole cells.

### Boxes

A box needs one empty `<span class="box-edge">`. CSS gives an element two
pseudo-elements and a glyph border needs four strips, so that span supplies the
other two:

```html
<div class="box">
  <span class="box-edge"></span>
  <span class="box-title">Title</span>   <!-- optional -->
  <p>Content stays a direct child.</p>
</div>
```

Leave out `.box-edge` and the box draws only its top and left edges — a visible
reminder rather than a silent misalignment.

| class          | border         |
|----------------|----------------|
| `.box`         | `─ │ ┌ ┐ └ ┘`  |
| `.box-double`  | `═ ║ ╔ ╗ ╚ ╝`  |
| `.box-round`   | `─ │ ╭ ╮ ╰ ╯`  |
| `.box-heavy`   | `━ ┃ ┏ ┓ ┗ ┛`  |
| `.box-ascii`   | `- \| + + + +` |

Modifiers: `.box-fill` (filled interior), `.box-tight` (no gutter, for content
that is already cell-aligned, like a table), `.box-title-right`,
`.box-divide` (a horizontal rule across the interior).

Each edge is one over-long glyph run clipped to the box, because CSS cannot
repeat a string a computed number of times. The runs cover 256 columns and 128
rows; a box bigger than that loses the tail of its border. Raise the copy count
in `src/grid/glyphs.css` if you need more.

### Type

No class needed for the basics — the reset and `type.css` restyle plain HTML.
`h1` is inverse video and uppercase, `h2`/`h3` get a `═`/`─` rule on the next
row, `h4`–`h6` are bold, `hr` is a full-width `─`, `blockquote` gets a `│`
margin, and list markers sit in their own cells so wrapped lines hang under the
text.

Attribute helpers — this is the whole type scale:

`.bold` `.dim` `.uc` `.underline` `.strike` `.inverse` `.pre` `.nowrap`

Colors: `.c0`–`.c15` for the ANSI slots, or `.fg-error` `.fg-ok` `.fg-warn`
`.fg-info` `.fg-accent` for the semantic ones.

### Tables

Give column widths in `ch` with a `<colgroup>`. The table is `table-layout:
fixed`, so without them auto layout distributes leftover space in fractions of
a pixel and puts every column after the first off the grid.

```html
<table class="table-zebra">
  <colgroup>
    <col style="width: 12ch"><col style="width: 10ch">
  </colgroup>
  <thead><tr><th>Host</th><th class="num">Load</th></tr></thead>
  <tbody><tr><td>alpha</td><td class="num">0.41</td></tr></tbody>
</table>
```

Separators are `│` glyphs drawn in the padding cell they own, and the header
rule is `─` with `┼` at each crossing. `.num` right-aligns. `.table-zebra`
stripes alternate rows. A table pairs well with `.box.box-tight`.

### Forms

Every control is text, so its width is however many cells its glyphs take.
Focus is inverse video, never an outline ring.

```html
<button class="btn">OK</button>                         <!-- [ OK ] -->
<input class="field field-24" placeholder="name">
<input type="checkbox" checked>                         <!-- [x] -->
<input type="radio">                                    <!-- ( ) -->
<div class="select select-16"><select>…</select></div>  <!-- [ value ▾ ] -->

<div class="form-row">
  <span class="form-label">Host</span>
  <input class="field">
</div>
```

`.btn-ok` / `.btn-error` tint a button. Field widths: `.field-8` `.field-12`
`.field-16` `.field-24` `.field-32` `.field-full`.

### Components

```html
<span class="badge badge-ok">ready</span>

<span class="progress" style="--cells: 24; --fill: 13"><span class="bar"></span></span>

<div class="box alert alert-warn">
  <span class="box-edge"></span>
  <span class="box-title">warn</span>
  <p>Replica charlie is behind.</p>
</div>

<nav class="nav"><a href="#" class="active">grid</a><a href="#">boxes</a></nav>

<div class="statusbar statusbar-fixed">
  <span>webterm</span><span class="spacer"></span><span>80×24</span>
</div>
```

- `.badge` — inverse-video single word; `-ok` `-warn` `-error` `-info` `-muted`.
- `.progress` — `--cells` wide, first `--fill` cells filled. You give cell
  counts, not percentages, so the fill always lands on a boundary.
  `.progress-warn` `-error` `-info` recolor it.
- `.alert` — a `.box` tinted per level: `-error` `-warn` `-ok` `-info`.
- `.nav` — horizontal menu, `.active` item inverse.
- `.menu` — vertical list, selected row inverse across the full width.
- `.statusbar` — full-width inverse strip; `.spacer` pushes items apart;
  `.statusbar-fixed` pins it to the bottom.
- `.kv` — `key: value` rows with keys in a fixed column.

Toasts, modals, spinners and placeholders are in [Behavior](#behavior): their
appearance is CSS like everything here, and the optional module drives them.

## Behavior

Everything above is CSS. The behavior layer is one optional ES module that adds
the things a page usually needs a framework for — toasts, loading states,
placeholders, modals, collapse, tabs, dropdowns, tooltips and drawers —
without a build step or a dependency:

```html
<script type="module" src=".../src/behavior/webterm.js"></script>
```

It sets `window.Webterm`, so the data attributes below work whether or not you
write any JavaScript yourself.

**The CSS never depends on the JS.** Every component here has a complete static
form that renders with no script loaded; the module only drives transitions
between states. A page whose module fails to load degrades to static boxes
rather than invisible ones, and `test/behavior.spec.js` loads the whole kitchen
sink with JavaScript disabled to keep that true. Collapse, dropdowns and
tooltips do better than that: with no script at all they still *work*, because
a disclosure is a `<details>` and a tooltip is a `::after`.

Two conventions run through all of it. Everything that is not a class is
namespaced — attributes are `data-wt-*`, events are `wt:component:verb` with
the before-events cancelable. And **motion is cell-stepped**: a terminal does
not tween, so every animation advances a whole cell or a whole row on
`--wt-tick` (60ms), and `prefers-reduced-motion` means the final state
immediately rather than a faster animation.

### Loading

```html
<span class="spin spin-quad"></span>

<span class="progress" style="--cells: 24; --fill: 13"><span class="bar"></span></span>
<span class="progress-label">54%</span>

<span class="progress progress-indeterminate" style="--cells: 24"><span class="bar"></span></span>
```

Spinners and the indeterminate bar animate in CSS and need no script at all,
which is the point: one driven by JavaScript stops exactly when the main thread
is busy. A spinner is a one-cell window over a run of frames, stepped a cell at
a time. Five sets ship: `.spin-line`, `.spin-quad`, `.spin-half`, `.spin-bar`
and `.spin-shade`.

There is deliberately no braille spinner. It is what every terminal tool uses,
and it is 12px wide in a 10px cell in JetBrains Mono and DejaVu Sans Mono —
correct only in Iosevka. The arc, circle and triangle sets each fail in a
different subset of the three. A frame set may use ASCII and U+2500–259F, which
is the range the bundled fonts cover in full, and the spec measures every glyph
against `1ch` in each font.

`.progress-label` is a fixed `4ch`, so `9%` growing to `100%` does not shove the
bar it labels sideways.

A loading state hides its content rather than removing it, so nothing resizes
while it waits:

```html
<button class="btn loading">
  <span class="loading-label">save</span>
  <span class="spin spin-quad"></span>
</button>
```

`Webterm.setLoading(el, true)` does that to any element, wrapping the children
it should hide and leaving a box's `.box-edge` and `.box-title` alone. The
spinner is centered on a whole cell rather than on 50%.

`Webterm.getOrCreate('progress', el).set(3, 8)` converts a value to whole cells.
`data-wt-progress="0.54"` is watched, so a server-rendered attribute swap is the
whole API for htmx or Shiny. The rounding is floor, with two exceptions that
stop a bar lying: never empty while there is progress, never full until there is
none left.

### Placeholders

The one that is new rather than ported. A placeholder is locked to the cell
count of the real text, and the value arrives by settling into it — every cell
shows a random character until its turn, then takes its real one and keeps it:

```html
<span class="ph" data-wt-ph>alpha-7</span>
```

Because the width is the real string's width from the first frame, resolution
causes no layout shift at all. That is what a character grid can promise and a
rem-based skeleton cannot.

| attribute          | values                                       |
|--------------------|----------------------------------------------|
| `data-wt-ph`       | empty to run on load, `hold` to wait          |
| `data-wt-order`    | `ltr` `rtl` `random` `center` `ends`          |
| `data-wt-charset`  | `alnum` `hex` `binary` `symbols` `blocks` `mixed` |
| `data-wt-duration` | milliseconds for the whole settle             |
| `data-wt-cycle`    | random characters a cell shows before settling |

Whitespace never scrambles: the shape of a value — how many words, how long —
is most of what a reader is waiting for. Charsets are held to the same
single-cell rule as the spinner frames, which is why there is no katakana one.

`.ph-area` is the same settle in two dimensions, over content that is already on
the grid:

```html
<div class="ph-area" style="--cells: 44; --rows: 5">
  <pre>alpha     primary  0.41  ok</pre>
  <span class="ph-mask" aria-hidden="true"></span>
</div>
```

With no script that mask is a flat `░` skeleton. With one, it fills with noise
that settles into the table — and since whitespace is pre-settled, the columns
are there from the first frame and the values arrive into them.

Three states make it useful rather than decorative: `Webterm.ph(el).hold()`
while a fetch is in flight, `.resolve(text)` on a value that may differ from the
authored one, and `.fail()`. The declared cell count outlives the animation, so
resolving onto longer text clips rather than moving the page. The real text sits
in a clipped `.ph-real` that assistive technology reads from the first frame,
and the noise is `aria-hidden`.

### Toasts

```js
Webterm.toast('replica charlie is behind', { level: 'warn', timeout: 6000 })
```

A toast is a `.box` in a stack pinned to a corner, so it inherits the border,
the title and the semantic tints. The stack is created on first use, or written
by hand:

```html
<div class="toast-stack toast-stack-br" role="status" aria-live="polite">
  <div class="box toast toast-warn">
    <span class="box-edge"></span>
    <span class="box-title">warn</span>
    <p class="toast-body">Replica charlie is behind.</p>
  </div>
</div>
```

Corners are `.toast-stack-tl`, `-tr`, `-bl` and `-br`; a bottom stack clears a
pinned `.statusbar-fixed`. Levels are `.toast-ok`, `-warn`, `-error` and
`-info`, and an error toast takes `role="alert"` so it interrupts rather than
waiting its turn in the polite queue.

The message types in, and the box does not move while it does — the tail that
has not arrived is laid out but hidden, so the wrapping never changes. **The
bottom border is the countdown**: a cell at a time, from the right, the `─` run
turns to `░` until the whole edge is shaded and the toast goes with it.

Hovering holds the timer. `Webterm.config.toastMax` (4) bounds how many are
visible and the rest queue. An identical consecutive message is counted as `×N`
on the existing toast rather than stacked. `Webterm.clearToasts()` empties
everything.

The timeout is time, not motion, so reduced motion does not collapse it — only
the typing stops.

### Modals

A native `<dialog>` that is also a box, so the focus trap, `Escape`, the inert
background and the top-layer stacking are the browser's work:

```html
<button class="btn" data-wt-toggle="modal" data-wt-target="#confirm">open</button>

<dialog class="box modal modal-60" id="confirm">
  <span class="box-edge"></span>
  <span class="box-title">confirm</span>
  <p class="modal-body">Drop replica charlie?</p>
  <div class="modal-actions">
    <button class="btn btn-error" data-wt-dismiss="modal" value="yes">Yes</button>
    <button class="btn" data-wt-dismiss="modal" value="no" autofocus>Cancel</button>
  </div>
</dialog>
```

Widths are `.modal-40`, `.modal-60` and `.modal-80` in cells, clamped to the
screen's column count. The dialog is centered on a whole cell and hangs from
`--wt-dialog-top`, because centering something whose height CSS does not know
cannot be snapped to a row. `data-wt-static` refuses a backdrop click.

The dim behind it is not a translucent black — the grid layer names no color, so
it is a run of block-shade glyphs painted in `--bg`, dithering the page the way
a TUI does.

And because a terminal interface asks small questions constantly:

```js
if (await Webterm.confirm('Drop replica charlie?')) drop()
const host = await Webterm.prompt({ label: 'host', fieldCells: 24 })
```

Opening a modal locks page scroll without changing the column count, which is
the one thing a character grid has to get right here: `reset.css` reserves the
scrollbar gutter permanently, so the scrollbar appearing and disappearing never
re-rounds `.screen` and reflows the page behind the dialog.

### Collapse

```html
<details class="collapse">
  <summary>disk</summary>
  <div class="collapse-body">
    <dl class="kv"><dt>/</dt><dd>14G of 40G</dd></dl>
  </div>
</details>
```

A `<details>`, so it opens and closes with no script. What the module adds is
the animation, and it is the vertical half of the placeholder's promise: the
body's height steps a **whole row at a time** on the tick, so the page below it
is never mid-row. The row count comes from measuring the content, the tick
count from `data-wt-duration`, so a twenty-row region opens in the same time as
a two-row one.

The marker is `+`/`-` rather than `▸`/`▾`: those are in Geometric Shapes, which
is outside the range that measures a single cell in all three bundled fonts.
`--wt-collapse-closed` and `--wt-collapse-open` take a different pair if your
font has one. A shared `name` attribute makes the browser close the sibling —
an accordion, free — and the module watches `toggle` so a sibling closed that
way leaves no clamp behind.

### Tabs

```html
<div class="tabs">
  <div class="nav tabs-list">
    <a href="#cpu" class="active">cpu</a>
    <a href="#mem">mem</a>
  </div>
  <div class="tabs-panels">
    <section class="tab-panel" id="cpu">…</section>
    <section class="tab-panel" id="mem">…</section>
  </div>
</div>
```

With no script that is a document with two sections and two links to them:
every panel readable, nothing hidden. The module makes it a `tablist` with
roving focus, arrow keys, `Home`/`End` and one panel at a time, and reuses
`.nav` for the strip.

The reason tabs are here at all is the height lock. Panels are different
heights, so switching them moves everything below — the layout shift the
framework exists to avoid, one axis over. `.tabs-panels` is measured across
every panel and pinned to the tallest in whole rows, and re-measured when the
window changes, since text rewraps. `data-wt-fit="content"` opts out. There is
no transition: a terminal repaints a pane.

### Dropdown

```html
<details class="dropdown">
  <summary class="btn">actions</summary>
  <div class="box dropdown-menu" style="--cells: 24">
    <span class="box-edge"></span>
    <div class="menu">
      <a href="#restart">restart</a>
      <a href="#drain">drain</a>
    </div>
  </div>
</details>
```

The same disclosure, floating. Every position the menu can take is anchored to
an *edge* of the trigger — `top: 100%`, `bottom: 100%`, `left: 0`, `right: 0` —
so it sits directly against a trigger of any height, and flipping near a
viewport edge means anchoring to the opposite edge rather than nudging by a
measured distance. Nothing can land mid-cell, because nothing computes a
position: `.dropdown-up` and `.dropdown-end` are the two flips, the module
decides *whether* to flip, and it only does so if the other side is better.

It adds what a native `<details>` has no opinion about: `Escape`, a click
outside, one open at a time, roving focus through the items with arrows and
`Home`/`End`, and focus handed back to the trigger on close.

### Tooltip

```html
<span class="tip" data-wt-tip="412 segments behind" tabindex="0">charlie</span>
```

An inverse strip against the trigger's edge, up to `--cells` wide and wrapped
to whole rows. No arrow: a CSS triangle is a sub-cell shape and the glyph that
would stand in for one is not single-cell in every bundled font, so the bubble
sits flush, which is what a TUI hint does.

With no script the whole component is `.tip::after`, taking its text from the
attribute on hover and focus. With the module it is a real element instead —
a pseudo-element cannot be the target of `aria-describedby` and cannot be
flipped away from a viewport edge — and `[data-wt-ready] .tip::after` stands
the static one down so only one ever shows. The module adds the open delay
(`data-wt-delay`, in ms), the flip, and `Escape`.

Put `.tip` on something focusable, or give it `tabindex="0"`: a hover-only
tooltip is not reachable from the keyboard.

### Offcanvas

```html
<button class="btn" data-wt-toggle="offcanvas" data-wt-target="#nav">menu</button>

<dialog class="box offcanvas offcanvas-left" id="nav" style="--cells: 28">
  <span class="box-edge"></span>
  <span class="box-title">nav</span>
  <div class="menu">…</div>
  <p><button class="btn" data-wt-dismiss="offcanvas">close</button></p>
</dialog>
```

A drawer is the modal's `<dialog>` anchored to an edge, so it inherits
`Escape`, the focus trap, the inert page, the top layer and the scroll lock.
`.offcanvas-left` and `-right` are `--cells` wide and as many whole rows tall
as the viewport holds; `-top` and `-bottom` are `--rows` tall and as many whole
columns wide.

It slides, a whole number of cells per tick, and `Escape` slides it out rather
than cutting it away. The dim behind it is a sibling rather than a child of the
dialog, because a transform makes a dialog the containing block for its fixed
descendants — a child dim would slide with the panel it is meant to sit behind.

## Theming

A theme sets color custom properties and nothing else — 16 ANSI slots plus
foreground, background, cursor and selection pairs:

```css
:root {
  --bg: ;     --fg: ;
  --cursor: ; --cursor-fg: ;
  --sel: ;    --sel-fg: ;
  --c0: ;  --c1: ;  --c2: ;  --c3: ;  --c4: ;  --c5: ;  --c6: ;  --c7: ;
  --c8: ;  --c9: ;  --c10: ; --c11: ; --c12: ; --c13: ; --c14: ; --c15: ;
}
```

That is the complete set — 22 values, all as hex. Copy
`src/themes/tomorrow-night.css` as a starting point.

The grid layer names no literal color; it only references those slots, through
semantic aliases set in `tokens.css`:

```css
--border: var(--c8);  --muted: var(--c8);
--error: var(--c1);   --ok: var(--c2);
--warn: var(--c3);    --info: var(--c4);
--accent: var(--c5);  --link: var(--c4);
```

Overriding an alias is legal for every theme except the default — a `<link>`ed
theme declares only its own variables, so an alias the default set and the next
theme does not would survive the swap and tint the new scheme. Several shipped
themes do override `--muted`/`--border`, because in Tomorrow Night and
Solarized Dark `--c8` *is* the background and dim text would otherwise be
invisible.

`test/themes.spec.js` lints every theme in two halves, with no browser: the
*contract* (exactly that variable set, as hex, under `:root` only, no
non-custom properties) and *legibility* (WCAG ratios for the pairs the grid
layer actually paints — 4.5:1 for body text and inverse video, 4:1 for the
cursor and selection pairs, 2.5:1 for semantic foregrounds, 2.4:1 for dim text
and box edges, which are meant to recede). A new theme should pass it.

### Changing the font size

`--wt-font-size` is the only px value in the framework. Line-height derives
from it:

```css
:root { --wt-font-size: 20px; }
```

Each font's `--wt-lh-ratio` is the largest value that stays seam-free across
10–32px, so any size in that range works, but 16px is where all three fonts hit
their per-size optimum.

## Skin

Layer 3, optional and additive: a CRT glass over the page. One more `<link>`
and one class on `<html>`.

```html
<link rel="stylesheet" href=".../src/skin/crt.css">
```

```html
<html class="font-jetbrains-mono crt crt-vignette">
```

`.crt` is scanlines and a phosphor glow; `.crt-vignette` adds the corner
falloff. Put them on `<html>` or `<body>` — the two overlays are that
element's `::before` and `::after`, and a `.box` already uses both of its own
to draw its border.

The layer is defined by one rule: **the skin declares nothing that can move an
element.** On a real element it sets `text-shadow`, an animation and custom
properties, and nothing else; everything it paints is on a fixed
pseudo-element; and every selector names a skin class, so linking `crt.css`
without applying one leaves the page pixel-identical. `test/skin.spec.js`
checks all three and measures every box on the kitchen-sink page with the skin
on and off.

There is no `px` in it either. The scanline period is `1lh` and the ink band a
fraction of `1lh`, so there is one scanline per *character row* rather than
every 2 or 4 pixels, and the glow radius is in `ch`. The effect scales with the
font instead of drifting away from it.

| token                      | default      | what it does                      |
|----------------------------|--------------|-----------------------------------|
| `--wt-crt-ink`             | `var(--bg)`  | the color both overlays paint in  |
| `--wt-crt-scan-rows`       | `1`          | rows per scanline                 |
| `--wt-crt-scan-thickness`  | `0.5`        | how much of the row the ink covers |
| `--wt-crt-scan-ink`        | `0.2`        | scanline strength, 0 turns it off |
| `--wt-crt-glow`            | `0.18`       | glow radius in cells, 0 turns it off |
| `--wt-crt-vignette-ink`    | `0.4`        | vignette strength                 |
| `--wt-blink-ticks`         | `8`          | ticks lit, then the same clear    |

The ink is `--bg` because the theme contract has no darker token to reach for.
`--c0` looks like one — a scanline is the absence of phosphor, so it should ink
in the theme's black — but the ANSI slots are a palette and not a brightness
order, and `solarized-light` sets `--c0` to `#eee8d5` because that is what slot
0 of the light Solarized palette is. A `--c0` overlay would *lighten* that
theme. `--bg` darkens a dark theme, does nothing to a light one, and never
inverts. Set `--wt-crt-ink: var(--fg)` if you want one anyway.

The glow is `currentColor`, so a `.c2` span glows green and a `.c1` span glows
red. It also covers the faint horizontal seam described under Limitations —
covers, not fixes: the seam is still there with the skin off.

### The cursor

```html
<span class="inverse cursor-blink"> </span>
```

`.cursor-blink` adds the animation and nothing else. The lit cell is
`.inverse` from the grid layer, so a page with the skin left out keeps a steady
block cursor instead of losing it.

It blinks on the framework's one clock: eight ticks lit, eight clear, 480ms
each at the default `--wt-tick`. The step function is `steps(2, jump-none)`, so
it is on and off rather than a fade — a terminal cursor does not fade. Under
`prefers-reduced-motion` or `data-wt-motion="off"` it parks lit.

## Development

```sh
npm install
npm run serve          # http server + the kitchen-sink page
npm test               # node:test; the browser specs need Playwright chromium
npm run font-limits    # font tables      -> fonts/metrics.json
npm run calibrate      # line-height sweep -> test/calibration.json
```

Re-run both calibration steps after changing a font file or the Chromium
version, then copy each ratio into `tokens.css` — the spec fails if they
disagree.

`npm run serve` prints the URL of `test/index.html`, which links the rest and
says what each one is for:

- `test/components.html` — every CSS component, with live font and theme
  pickers and a cell/row readout
- `test/behavior.html` — the behavior layer, with a motion switch
- `test/skin.html` — layer 3, with the glass, the vignette, the cursor and the
  tokens on live controls
- `test/default-theme.html` — the framework with no theme link, so the shipped
  default has to paint it
- `test/metrics.html` — the font calibration harness

Each is built with the framework it tests.

`PLAN.md` is the design document: the rules, the layer architecture, the
measured font metrics, and the reasoning behind each rejected alternative.

`test/readme.spec.js` lints this file against `src/`: every class an example or
the reference names has to exist, and the theme list, font table and `.col-N`
widths have to match what ships. Rename a class and the README fails with it.

### Test status

| suite                                 | result                                       |
|---------------------------------------|----------------------------------------------|
| `themes.spec.js`                      | 206 pass — theme contract and contrast       |
| `readme.spec.js`                      | 8 pass — every class, set and license claim this file makes |
| `grid.spec.js` + `default.spec.js`    | 51 pass — integer cells, continuous borders, the default paints and a `<link>` beats it |
| `behavior.spec.js`                    | 180 pass — the behavior layer, cell-exact mid-animation, and the whole page with scripts disabled |
| `skin.spec.js`                        | 27 pass — the skin moves nothing, and is inert until it is applied |
| `metrics.spec.js`                     | 240 pass, **100 fail** — known, see below    |

The 100 failures are a wrong assertion, not a layout bug. `metrics.spec.js`
asserts `80ch == 80 × advanceEm × font-size` from the font tables, but Chromium
lays monospace text out with whole-px advances, so `1ch = round(advanceEm ×
size)` — a 10px cell at 16px JetBrains Mono, not 9.6px. The grid property that
matters still holds (N cells is N equal whole-px columns, regular and bold, no
drift with N); the em-advance prediction the test checks is not what the
browser uses. See PLAN §8.

`npm test` runs every spec in one process — 812 tests, 712 pass, the same 100
fail, repeatably.

The intermittent cancellations this file used to warn about were
`Page.captureScreenshot` answering "Unable to capture screenshot" on the first
shot after a page settles. Because that shot is taken in a `before` hook, the
failure cancelled every assertion in the suite rather than failing one. Every
pixel suite now goes through `shoot()` in `test/lib/grid.js`, which retries
twice — the screenshot is an input to the check, not the check.

## Limitations

- **Calibration is Chromium-only.** Firefox and Safari round font metrics
  differently and have not been measured.
- **Faint horizontal seams at some font sizes.** A glyph is painted at its
  natural em advance inside a cell rounded up to a whole px, and the difference
  stays unpainted. Sizes where `advanceEm × size` is an integer (15, 20, 25px
  for JetBrains Mono; even sizes for Iosevka) are clean for the line glyphs;
  `█` keeps a ~0.09px loss even then. Avoid long runs of `█`.
- **Flex distribution can land on fractional `ch`** when several `.col` share
  leftover space. Use `.col-N` where exactness matters.
- **No wide-glyph support.** CJK and emoji occupy two cells; nothing accounts
  for it.
- **The behavior layer is Chromium-tested only**, like the calibration. It
  uses `<dialog>`, `:has()` and `round()`, all of which are supported in
  current Firefox and Safari but are not covered by a spec run here.
- **A tooltip needs a focusable trigger.** `.tip` on a plain `<span>` is
  hover-only until it gets a `tabindex`; the module does not add one, because
  silently rewriting a page's tab order is worse than the gap.
- **A tab strip is horizontal only.** Arrow keys are left and right; a vertical
  tablist is not written.
- **The skin's scanlines are glass, not a texture.** The overlay is fixed to
  the viewport, so the lines sit on the row grid at rest and after a scroll of
  a whole number of rows, and mid-row at any other scroll offset. An overlay
  that scrolled with the content would be aligned always but would not cover
  `.statusbar-fixed`, a toast stack or a drawer.
- **The skin does not cover an open `<dialog>`.** A modal or a drawer opened
  with `showModal()` is in the top layer, which paints above every `z-index`
  there is. The dim behind it is under the glass; the dialog itself is not.
- **A `.crt` on a `.box` erases its border.** The skin uses that element's
  `::before` and `::after`, and so does a box. Put it on `<html>` or `<body>`.
- **A collapse body is a formatting context** (`display: flow-root`), so a
  margin on its first or last child sits inside the body rather than collapsing
  through it. That is deliberate — the clamp used during the animation
  establishes a formatting context anyway, and a body that only does so while
  it is opening measures one height and animates to another — but it means a
  `.collapse-body` spaces slightly differently from a plain `<div>`.

## License

MIT — see `LICENSE`.

Bundled fonts keep their own licenses, and `LICENSE` does not cover them:
JetBrains Mono and Iosevka under OFL-1.1, DejaVu Sans Mono under the Bitstream
Vera license. Each license file sits in that font's directory under `fonts/`.
