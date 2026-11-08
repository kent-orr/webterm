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

CSS only. No JavaScript, no build step, no dependencies.

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
anything you share, pin a commit instead: `@cd7a95b/src/webterm.css`.

`raw.githubusercontent.com` does **not** work. It serves CSS as `text/plain`
with `X-Content-Type-Options: nosniff`, so the browser refuses to apply it.

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
npm run serve          # then open the printed URL
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

Pages worth opening: `test/components.html` (every component, with live font
and theme pickers and a cell/row readout), `test/default-theme.html` (the
framework with no theme link), `test/metrics.html` (the calibration harness).

`PLAN.md` is the design document: the rules, the layer architecture, the
measured font metrics, and the reasoning behind each rejected alternative.

`test/readme.spec.js` lints this file against `src/`: every class an example or
the reference names has to exist, and the theme list, font table and `.col-N`
widths have to match what ships. Rename a class and the README fails with it.

### Test status

| suite                                 | result                                       |
|---------------------------------------|----------------------------------------------|
| `themes.spec.js`                      | 206 pass — theme contract and contrast       |
| `readme.spec.js`                      | 7 pass — every class and set this file documents |
| `grid.spec.js` + `default.spec.js`    | 51 pass — integer cells, continuous borders, the default paints and a `<link>` beats it |
| `metrics.spec.js`                     | 240 pass, **100 fail** — known, see below    |

The 100 failures are a wrong assertion, not a layout bug. `metrics.spec.js`
asserts `80ch == 80 × advanceEm × font-size` from the font tables, but Chromium
lays monospace text out with whole-px advances, so `1ch = round(advanceEm ×
size)` — a 10px cell at 16px JetBrains Mono, not 9.6px. The grid property that
matters still holds (N cells is N equal whole-px columns, regular and bold, no
drift with N); the em-advance prediction the test checks is not what the
browser uses. See PLAN §8.

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
- **CSS only.** Dropdowns, modals and other interactive behavior are out of
  scope — bring your own JavaScript.

## License

MIT.

Bundled fonts keep their own licenses: JetBrains Mono and Iosevka under
OFL-1.1, DejaVu Sans Mono under the Bitstream Vera license. Each license file
sits in that font's directory under `fonts/`.
