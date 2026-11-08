# webterm — Plan

A CSS framework that makes HTML pages obey terminal rules. Not a dark theme:
a layout system where every element occupies an integer number of character
cells, borders are box-drawing glyphs, and type hierarchy comes from
attributes (bold, inverse, color) rather than size.

Think "Bootstrap, but the layout engine is a character grid."

## 1. Problem statement

Terminal-to-HTML is well covered (xterm.js, asciinema, Rich/Textual export).
HTML-that-looks-like-a-terminal is only covered by *skins*: terminal.css,
hack.css, BOOTSTRA.386. Those set a monospace font and dark palette, but
their borders are 1px CSS and their spacing is in rem, so nothing aligns to a
character grid and the illusion breaks on inspection. tui.css is the closest
prior art but is tied to a Turbo Vision aesthetic and a fixed 80 columns.

The gap: a framework where the grid itself is character-faithful.

## 2. Core constraints (the rules of the terminal)

These are non-negotiable in the core layer. Every component must satisfy them.

1. One cell = `1ch` wide × `1lh` tall. All horizontal lengths are `Nch`,
   all vertical lengths are `Nlh`. No `px`, `rem`, `em`, or `%` inside the
   screen container.
2. One font, one size, one line-height for the entire document. Never
   changed per element.
3. Hierarchy comes only from: bold, dim, inverse video, underline, color,
   whitespace, and uppercase. No size changes.
4. Borders are glyphs (`─│┌┐└┘` etc.), never CSS `border` with px widths.
5. Unicode box-drawing is allowed. An ASCII-only (`+-|`) border style is
   provided as an option, not the default.
6. No raster images in core. (Half-block / braille renderers are a possible
   later add-on.)
7. Wide glyphs (CJK, emoji) are out of scope for v1. Document the limitation.
8. The outer container snaps to an integer column count.
   Breakpoints are expressed in columns (`@container (min-width: 80ch)`),
   not pixels.

## 3. Architecture: four layers

```
┌───────────────────────────────────────────────┐
│ 4. behavior  (optional) JS that drives state: │
│              toasts, loading, placeholders,   │
│              modals                           │
├───────────────────────────────────────────────┤
│ 3. skin      (optional) CRT effects:           │
│              scanlines, glow, cursor blink     │
├───────────────────────────────────────────────┤
│ 2. theme     color custom properties only      │
│              (16 ANSI + fg/bg/cursor/select)   │
├───────────────────────────────────────────────┤
│ 1. grid      reset, cell units, rows/cols,     │
│              boxes, type, tables, forms        │
└───────────────────────────────────────────────┘
```

- **grid** never mentions a literal color. It references `var(--c0)` …
  `var(--c15)`, `var(--fg)`, `var(--bg)`, etc.
- **theme** is one file per color scheme that sets only those variables.
- **skin** is additive and can be omitted without affecting layout.
- **behavior** is additive and can be omitted without affecting *appearance*:
  the CSS never depends on it (§11.1).

## 4. Layer 1: grid

### 4.1 Root tokens

Implemented in `src/grid/tokens.css`. Line-height is whole CSS px at every
size, derived from a per-font calibrated ratio (§4.7):

```css
:root {
  --wt-font-size: 16px;            /* the only px in the framework */
  --wt-lh-ratio: 1.291;            /* per font, see §4.7 */
  --wt-line-height: round(down, calc(var(--wt-font-size) * var(--wt-lh-ratio)), 1px);
  font-family: var(--wt-font-family);
  font-size: var(--wt-font-size);
  line-height: var(--wt-line-height);
  font-variant-ligatures: none;
  font-kerning: none;
  font-synthesis: none;
  letter-spacing: 0;
  tab-size: 4;
}
```

### 4.2 Screen container

```css
.screen {
  width: calc(round(down, 100%, 1ch));
  margin: 0 auto;
  container-type: inline-size;
}
```

`100%`, not `100vw`: `100vw` includes the classic scrollbar, so on a page tall
enough to scroll the rounded width is wider than the viewport and the last
column lands under the scrollbar. Chromium rounds the resolved percentage, so
the column count stays whole either way.

### 4.3 Rows and columns

Flexbox with `ch` basis. **Not** a 12-fraction grid: 12 does not divide
most terminal widths, and terminals think in "sidebar is 24 cols, main
takes the rest."

- `.row` — `display:flex; gap:1ch`
- `.col` — `flex:1 1 0; min-width:0` (fill remaining)
- `.col-N` — `flex:0 0 Nch` for N in a fixed set (4, 8, 12, 16, 20, 24, 32, 40)
- Vertical stacking uses `1lh` gaps.

Rounding rule when multiple `.col` share leftover space: flexbox handles it,
but widths may land on fractional ch. Accept for v1; investigate
`round()`-based fix later.

### 4.4 Boxes

`.box` wraps content in a glyph border. Border styles:

| class            | glyphs            |
|------------------|-------------------|
| `.box` (default) | `─ │ ┌ ┐ └ ┘`     |
| `.box-double`    | `═ ║ ╔ ╗ ╚ ╝`     |
| `.box-round`     | `─ │ ╭ ╮ ╰ ╯`     |
| `.box-heavy`     | `━ ┃ ┏ ┓ ┗ ┛`     |
| `.box-ascii`     | `- \| + + + +`    |

Optional `.box-title` renders a label in the top border: `┌─ Title ─────┐`.

Implemented with candidate 1 (`src/grid/box.css`), with one correction: CSS
cannot repeat a glyph a computed number of times, so each edge is one
over-long run clipped by `overflow: hidden`. Clipping always eats the far end
of a run, so the four edges are arranged cyclically and each owns the corner
at the end it is anchored to — top anchored left owns `┌`, right anchored top
owns `┐`, bottom anchored right owns `┘`, left anchored bottom owns `└`. The
four strips are disjoint, so no cell is painted twice.

A box therefore needs four pseudo-elements and an element has two, so `.box`
carries one empty `<span class="box-edge">`. Content stays a direct child.
Runs cover 256 columns and 128 rows (`src/grid/glyphs.css`).

Rejected: candidate 2 (an SVG 9-patch is not a glyph and loses hinting) and
candidate 3 (one DOM node per border cell).

### 4.5 Typography

Zero font-size changes. Proposed scale:

| element / class | rendering                                   |
|-----------------|---------------------------------------------|
| `h1`            | inverse video, uppercase, full-width padded  |
| `h2`            | bold, underline with `═` on next line        |
| `h3`            | bold, underline with `─` on next line        |
| `h4`–`h6`       | bold only                                    |
| `strong`        | bold                                         |
| `em`            | italic if font has it, else underline        |
| `.dim`          | `--c8` foreground                            |
| `.inverse`      | swap fg/bg                                   |
| `code`          | `--c3` foreground, no box                    |
| `pre`           | `.box` with `--c0` background                |
| `a`             | `--c4`, underline; `--c12` on hover          |
| `hr`            | full-width `─`                               |
| `ul li`         | `•` or `-` marker in its own cell            |
| `ol li`         | right-aligned number + `.`                   |

### 4.6 Components (v1)

- **Table** — HTML `<table>` constrained to ch. Column separators `│`,
  header separator `─┼─`. Optional outer `.box`.
- **Button** — `[ OK ]` style. Focus = inverse. Disabled = `.dim`.
- **Text input** — underscores or dim fill, caret shown as inverse cell.
- **Checkbox / radio** — `[x]` `[ ]` `(•)` `( )`.
- **Select** — `[ value ▾ ]`.
- **Progress** — `███████░░░░░░ 54%` with `--c2` fill.
- **Badge / tag** — inverse-video single word.
- **Card** — `.box` with `.box-title`.
- **Alert** — `.box` colored per level (c1 error, c3 warn, c2 ok, c4 info).
- **Nav / menu** — horizontal list, active item inverse.
- **Status bar** — full-width inverse strip pinned to bottom.

### 4.7 Font metrics (make-or-break) — done, milestone 1

Box-drawing glyphs connect vertically only when they overshoot the line box.
Measured in Chromium with `test/metrics.html` + `tools/calibrate.js`
(sizes 10–32px, DPR 1 / 1.5 / 2, sub-pixel offsets 0 / 0.5):

| font             | `--wt-lh-ratio` | 16px row | theory (font tables) |
|------------------|-----------------|----------|----------------------|
| JetBrains Mono   | 1.291           | 20px     | blocks 1.32, lines 1.52 |
| Iosevka          | 1.199           | 19px     | blocks 1.18 (hhea), lines 1.23 |
| DejaVu Sans Mono | 1.153           | 18px     | blocks & lines 1.18  |

Findings:

- **Limit is a whole px per size, not a ratio.** Chromium rounds ascent and
  descent to whole px, so the seam-free line-height at each size is an
  integer N(size) with ~0.02px slack. A fixed unitless ratio either wastes a
  pixel at some sizes or seams at others. Hence the `round(down, …, 1px)`
  formula: K is the largest ratio with floor(size·K) ≤ N(size) for every
  size 10–32px. At 16px all three fonts hit their per-size optimum; other
  sizes lose at most 1px.
- **Blocks bind, not lines.** `█` spans exactly ascent+descent, so it is the
  tighter constraint. We require `█` to stack cleanly, as in a real terminal.
- **Chromium ignores USE_TYPO_METRICS for Iosevka**: measured limits match
  the hhea prediction, not typo. Theory in `fonts/metrics.json`
  (`tools/font-limits.py`) is a guide; the empirical sweep is authoritative.
- **`1ch` is a whole px, and is not the font's em advance.** Chromium
  153.0.8010.12 here lays monospace text out with whole-px advances, so
  `1ch = round(advanceEm × font-size)` at every size — 16px JetBrains Mono
  gives a 10px cell, not 9.6px. The grid is still exact (`Nch` is N equal
  integer cells, regular and bold, no drift with N), but the cell is not the
  advance the font tables predict, which is what `test/metrics.spec.js`
  asserts today. See §8.
- **Google Fonts / Fontsource JetBrains Mono lacks U+2500–259F.** Borders
  silently fall back to another font. We bundle the official v2.304 build
  (`fonts/`).
- **Horizontal seams are a font/size property, not line-height.** Glyphs that
  end exactly on the advance (`█` in all three fonts; `─`/`┼` in Iosevka)
  leave a faint lighter column at the cell boundary. The cause is the
  quantization above, not fractional cells: the glyph is *painted* at its
  natural em advance inside a cell rounded up to a whole px, so the
  difference stays unpainted. Where `advanceEm × size` is already an integer
  the line glyphs come out clean (JetBrains Mono at 20px: 0.001 loss); where
  it is not, everything seams (same font at 16px: 0.06 for the line glyphs,
  0.288 for `█`). `█` keeps a ~0.09 loss even on an exact cell.
  Consequence for §4.6 progress bars: do not rely on runs of `█`; see §8.

Re-run after changing a font file or Chromium version:
`npm run font-limits && npm run calibrate`, then copy each K into
`tokens.css` (the spec fails if they disagree).

## 5. Layer 2: theme

### 5.1 Color model

Every terminal color scheme, regardless of file format, encodes the same
~22 values. These become the complete set of color custom properties:

```css
:root {
  --bg: ; --fg: ;
  --cursor: ; --cursor-fg: ;
  --sel: ; --sel-fg: ;
  --c0: ;  --c1: ;  --c2: ;  --c3: ;  --c4: ;  --c5: ;  --c6: ;  --c7: ;
  --c8: ;  --c9: ;  --c10: ; --c11: ; --c12: ; --c13: ; --c14: ; --c15: ;
}
```

Semantic aliases layered on top so components read clearly:

```css
--border: var(--c8);  --muted: var(--c8);
--error: var(--c1);   --ok: var(--c2);
--warn: var(--c3);    --info: var(--c4);
--accent: var(--c5);  --link: var(--c4);
```

### 5.2 Default themes to ship — done, milestone 5

Tomorrow Night, Solarized Dark, Solarized Light, Gruvbox Dark, Dracula,
Nord, plus a plain "green phosphor" and "amber phosphor", plus **Pawpaw**,
the default (below). All nine are in `src/themes/`, selectable from
`test/components.html`.

The six published schemes are transcribed as their authors define them. The
two phosphor themes are ours: a monochrome CRT has one phosphor, so an ANSI
color arrives as a beam intensity and not a hue. Each slot's intensity is the
relative luminance of the corresponding xterm color, rank-ordered and spread
over the usable range of the gun (pure luminance leaves blue at 1.2:1), mixed
in linear light — which is what beam current is linear in. An error box and
an info box therefore differ in intensity but not in hue, as on the hardware.

**The default: Pawpaw.** A framework with no colors of its own renders an
unstyled page until the author picks a theme, so `src/webterm.css` imports
one: `themes/pawpaw.css`, the Pawpaw Analytics house palette taken from the
design system's own tokens (dark-mode values where it publishes a pair). The
brand owns five hues and an ANSI scheme needs six plus two neutral ramps, so
the slots the brand does not own are derived rather than invented — the two
published accent levels fix a lightness and chroma in OKLCh, blue takes
Payne's gray's hue, magenta the midpoint of the one gap left in the brand hue
wheel, and yellow the brand warning token's hue; the file's header comment
carries the arithmetic. It needs no `--muted`/`--border` override: `--c8` is
the dark mode's Payne's gray at 4.65:1.

Two mechanics make a default theme safe to ship:

- it is imported into a cascade layer (`layer(webterm-default-theme)`), and
  an unlayered rule beats a layered one at any order, so a theme `<link>`
  replaces it whole even when the link comes *before* `webterm.css`;
- the default theme may not override a semantic alias. A `<link>`ed theme
  declares only its own variables, so an alias the default set and the next
  theme does not would survive the swap and tint the new scheme. Overriding
  an alias stays legal for every other theme; `themes.spec.js` enforces this
  one on the default.

`test/themes.spec.js` lints all nine without a browser, in two halves:

- *contract* — each declares exactly the §5.1 set, as hex, under `:root`
  only, and sets no property that is not a custom property. That is what
  makes a theme swappable by one `<link>` and what the generator (§5.3) has
  to emit.
- *legibility* — WCAG ratios for the pairs the grid layer actually paints.
  Floors are set at what the hand-transcribed schemes meet, not at round
  numbers: 4.5:1 for body text and for inverse video (the §2.3 hierarchy
  mechanism, and the pair most at risk on a light scheme), 4:1 for the
  cursor and selection pairs, 2.4:1 for dim text and box edges — the faint
  attribute is meant to recede — and 2.5:1 for the semantic foregrounds.

Every floor exists because a raw ANSI slot fails it somewhere. Dim is `--c8`,
and in Tomorrow Night and Solarized Dark `--c8` *is* the background, so the
faint attribute would be invisible; Nord's `--c8` sits at 2.0:1. Those three
and Gruvbox override `--muted`/`--border`, and the suite is what says they
must. The phosphor ramps and Pawpaw need no override: the dim slot is well
behaved by construction.

`test/default.spec.js` is the browser half of the default: it loads
`test/default-theme.html`, the page that links nothing but the framework, and
asserts every contract variable resolves to Pawpaw's value, that the page
actually paints them, and that a theme `<link>` added afterwards still wins.

### 5.3 Theme generator (tabled, see §8)

Input formats seen in the wild: iTerm2 `.itermcolors` (XML plist),
base16 `.yaml`, Gogh `.json`, Xresources, Alacritty `.toml`, Kitty `.conf`,
Windows Terminal `.json`, Ghostty, VS Code `.json`.

Decision: pick **one** canonical input and convert others to it.
Leading candidate is **Gogh JSON** (flat schema, ~250 ready themes, trivial
to parse). Alternative is base16 YAML (semantic slots, but bright ANSI
variants are approximate).

Output: one `themes/<name>.css` per scheme setting only the variables in
§5.1. Hand-write the §5.2 themes first; automate once the variable contract
is stable.

## 6. Layer 3: skin (optional)

- `.crt` — scanline overlay via repeating-linear-gradient, slight text glow
  via `text-shadow`, optional vignette.
- `.cursor-blink` — blinking inverse cell for inputs.
- Must not alter any layout metric. Purely visual overlays.

## 7. Repo layout

```
webterm/
  PLAN.md
  src/
    grid/        reset.css tokens.css layout.css box.css type.css
                 table.css forms.css components.css overlay.css
    themes/      pawpaw.css (the default) tomorrow-night.css
                 solarized-dark.css ...
    skin/        crt.css
    behavior/    webterm.js (entry) toast.js modal.js progress.js
                 placeholder.js
      lib/       cells.js motion.js box.js aria.js
  dist/          built single-file bundles (webterm.css, webterm.min.css)
  fonts/         bundled full-coverage woff2 + webterm-fonts.css,
                 metrics.json (font-table limits)
  test/
    metrics.html         font calibration page (§4.7)
    metrics.spec.js      node:test + Playwright: seams, ch/lh exactness
    calibration.json     last calibration sweep (source of each K)
    components.html      visual kitchen-sink
    default-theme.html   the framework with no theme <link> (§5.2)
    themes.spec.js       theme contract + contrast lint (no browser)
    default.spec.js      the shipped default paints, and a <link> beats it
    behavior.html        kitchen sink for the behavior layer (§11)
    behavior.spec.js     Playwright: the JS components, cell-exact at every
                         frame, plus the layer-4 source lint
    lib/color.js         hex -> luminance -> WCAG contrast
    lib/theme.js         theme file -> resolved variable map
    lib/grid.js          cell probe + off-grid math, shared by specs
    lib/borders.js       PNG border continuity + corner checks
    *.spec.js            Playwright: assert computed widths are integer ch
  tools/
    font-limits.py       font tables → fonts/metrics.json
    calibrate.js         empirical line-height sweep → test/calibration.json
    gen-theme.*          (later) color scheme → themes/*.css
```

## 8. Open questions / tabled

- [ ] Calibration is Chromium-only. Firefox and Safari round font metrics
      differently; measure them (Playwright firefox/webkit) before v1.
- [ ] **Horizontal seams, and the two metrics tests they fail (§4.7).**
      `1ch` is already a whole px at every size, so "snap `--wt-font-size` so
      `1ch` is whole px" is not the fix — the seam comes from the gap between
      the painted em advance and the rounded cell. What is left:
      - `--wt-font-size: 16px` gives JetBrains Mono a 10px cell against a
        9.6px advance, its worst case. A size where `advanceEm × size` is an
        integer (15px, 20px, 25px for JetBrains Mono; even px for Iosevka)
        is seam-free for the line glyphs. Changing the default size is a
        framework-wide decision, so it is parked here rather than taken.
      - `test/metrics.spec.js` asserts `ch80 == 80 × advanceEm × size` from
        the font tables and so fails at every size where that product is not
        an integer (100 failures, deterministic). The assertion should hold
        the grid property — N equal whole-px cells, no drift — not the
        em-advance prediction, which Chromium does not use.
      - the horizontal seam test picks its sizes from the same prediction,
        so it skips most sizes and runs exactly where it fails.
      - whether this is Chromium 153 or a missing subpixel-positioning
        setting in this environment is not yet established; it decides
        whether the fix belongs in the spec or in the harness. Firefox and
        WebKit (first item above) will answer part of it.
      - progress fill via a CSS background instead of `█` runs, which is
        seam-free regardless.

- [ ] Theme generator: language (Python vs Node) and canonical input format.
- [ ] Fractional ch from flex distribution: accept or enforce integers?
- [ ] Wide glyph support (`2ch` inline-block wrapper) — post-v1.
- [ ] Half-block / braille image renderer — post-v1, JS, separate package.
- [x] Interactive JS — **taken**, as layer 4 (§11). Optional, inside this
      repo, and the CSS never depends on it. Round one is toasts, loading,
      placeholders and modals; collapse, dropdown, tabs, tooltip and
      offcanvas are the next pass.
- [ ] Light-background themes: does inverse-video hierarchy still read well?

## 9. Milestones

1. **Metrics** — `test/metrics.html`, calibrate 3 fonts, lock `line-height`. ✅
2. **Grid core** — reset, tokens, `.screen`, `.row/.col`, `.box` (style 1). ✅
3. **Type + table** — typography scale, table, `hr`, lists. ✅
4. **Forms + components** — buttons, inputs, progress, alerts, nav, status. ✅
5. **Themes** — variable contract frozen; hand-write 8 themes. ✅
   All 8 written, plus Pawpaw, which `src/webterm.css` imports as the
   default; `test/themes.spec.js` lints each one for the contract and for the
   contrast of every pair the grid layer paints, and `test/default.spec.js`
   checks the default in the browser (§5.2).
6. **Tests** — Playwright checks: every `.box` edge lands on an integer
   `ch`/`lh` boundary; borders have no sub-cell gaps (pixel diff).
7. **Skin** — `.crt`.
8. **Behavior** — layer 4 (§11), in five phases: foundation, loading,
   placeholders, toasts, modals, then docs.
9. **Docs site** — built with webterm itself.
10. **Generator** — resolve §8 and automate themes.

## 10. Testing approach

Test-driven where it is measurable:

- Playwright + Chromium: load `test/components.html`, read
  `getBoundingClientRect()` for every `.box`, `.col-*`, and table cell;
  assert `width % chPx` and `height % lhPx` are within 0.5px of 0.
- Screenshot diff of the `│` seam test at each shipped font/line-height.
- Theme files linted: every theme must define exactly the §5.1 variable set.

## 11. Layer 4: behavior

Bootstrap's value is not only its CSS: it ships default behavior for the
handful of things every page needs — a toast, a spinner, a skeleton, a modal.
webterm's §2 rules make those *harder* and more interesting, because a toast
that slides in on a sub-cell offset, or a skeleton that resizes when the real
text arrives, breaks the one property the framework exists to hold.

Round one is **toasts, loading, placeholders and modals**. Collapse, dropdown,
tabs, tooltip and offcanvas are the next pass, listed here only so the
conventions below are designed to carry them.

### 11.1 The rule that keeps the core CSS-only

**The CSS never depends on the JS.** Every component has a complete, styled,
static declarative form that renders with no script loaded; the JS only drives
transitions between states. `src/webterm.css` stays a whole framework on its
own, with no dependencies and no build step — the behavior layer is a second,
optional `<script type="module">`.

Consequences that are easy to get wrong, so they are rules:

- a component's *appearance* lives entirely in `src/grid/`, never in a JS
  template's inline styles;
- a server-rendered toast or modal in the initial HTML looks right before the
  module loads, and is adopted by it on init rather than rebuilt;
- if the module fails to load, the page degrades to static boxes, not to
  invisible ones. No component is `display: none` by default and revealed by
  script — `.toast` and `<dialog>` are visible when present in the DOM, and
  the JS removes them.

### 11.2 Conventions

Decided once, because retrofitting them across four components is the
expensive kind of mistake.

1. **Namespace.** Classes stay short and Bootstrap-like (`.toast`, `.modal`),
   matching the existing `.badge`/`.alert`. Everything that is not a class is
   namespaced `wt`: attributes `data-wt-toggle`, `data-wt-target`,
   `data-wt-dismiss`, and events `wt:toast:show`.
2. **Dual API.** Declarative first —
   `data-wt-toggle="modal" data-wt-target="#confirm"` needs no JS written by
   the author. Imperative for everything else: `Webterm.toast(…)`,
   `Webterm.Modal.getOrCreate(el).show()`. One instance per element, cached on
   the element.
3. **Lifecycle events** on the component element, bubbling, with cancelable
   before-events: `wt:x:show` → `wt:x:shown`, `wt:x:hide` → `wt:x:hidden`.
   `preventDefault()` on a before-event cancels the transition.
4. **No px from JS either.** Any inline style the JS writes is `Nch`, `Nlh` or
   a unitless custom property (`--cells: 24`). Geometry is computed in cells,
   never in pixels, and `lib/cells.js` is the only module that reads a pixel
   measurement at all. `behavior.spec.js` lints `src/behavior/**/*.js` for px,
   rem and em lengths and for color literals, the same way `grid.spec.js`
   lints the grid layer.
5. **Motion is cell-stepped.** A terminal does not tween: it repaints a cell.
   Every animation advances by whole cells or whole rows on a tick,
   `--wt-tick: 60ms` (≈16 cells/s), which is the one timing knob. CSS
   animations use `steps(N, end)` and translate in `ch`/`lh`; JS animations go
   through the single scheduler in `lib/motion.js`, so the whole page steps on
   one clock instead of N drifting intervals.
6. **Reduced motion means the final state immediately** — not a faster
   animation — in every component. `prefers-reduced-motion: reduce` does it
   automatically; `<html data-wt-motion="off">` forces it, which is also how
   the specs make animation deterministic (Playwright's
   `animations: 'disabled'` disables CSS animations only, not JS ones).
7. **Zero dependencies, no build.** ES modules importing each other by
   relative path, loaded as `<script type="module">` and served unbundled from
   jsDelivr exactly like the CSS. The entry also assigns `window.Webterm`, so
   the data API works for authors who write no JS. A concatenation script can
   come later if the request count ever matters; it is not needed for the
   framework to work.
8. **Accessibility is part of each component**, not a later pass: toasts live
   in a live region, modals are native `<dialog>` with `showModal()`, and a
   scrambling placeholder exposes its real text to assistive technology from
   the first frame.

### 11.3 Four grid-specific hazards

These are the places where ordinary component JS would quietly break §2, and
they are settled in the foundation phase rather than per component.

**Scroll locking changes the column count.** A modal that locks page scroll
removes the scrollbar, `.screen` rounds up by a column, and the entire page
reflows behind the dialog. `reset.css` gets `scrollbar-gutter: stable`, and a
spec asserts the column count is identical with a modal open.

**Centering lands on a half row.** The viewport is not a whole number of rows,
so `place-content: center` puts a dialog's top edge mid-cell. An overlay is
`height: round(down, 100dvh, 1lh)`; a dialog's offset from it rounds down to
`1lh`. Where CSS cannot know the child's height, the no-JS fallback is a fixed
`--wt-dialog-top: 4lh` and the JS snaps to the nearest whole row.

**A backdrop cannot name a color.** `grid.spec.js` forbids `rgba()` and
`color-mix()` in the grid layer, which rules out the usual translucent black.
The terminal answer is better: dim the page behind a dialog with a 2-D run of
`░` in `--c8`, a new token in `glyphs.css` built the same way as the border
runs. That is what a TUI does, and it stays cell-exact. `opacity` over
`var(--bg)` is kept as a `.backdrop-plain` variant for pages with a lot behind
the dialog.

**Stacking needs a scale.** `.statusbar-fixed` currently takes `z-index: 1` on
its own. `overlay.css` defines the whole order: content 0, statusbar 10, toast
20, backdrop 30, modal 31.

And one smaller trap: anything the JS builds that is a `.box` must carry its
`<span class="box-edge">`, or it draws two edges out of four (box.css). A
shared `createBox()` in `lib/box.js` is the only place a box is constructed.

### 11.4 Loading

Mostly CSS, which is the point: a spinner that needs JS to animate is a
spinner that stops when the main thread is busy.

- `.progress` is unchanged: `--cells` wide, `--fill` cells filled.
- `.progress-indeterminate` — a short lit run marching the track, a
  `steps(--cells)` keyframe translating in `ch`. No JS.
- `.spin` gains real frames with the same trick the borders use: a `1ch`
  window clipping a horizontal run of frame glyphs, translated `1ch` per step
  by a `steps(N)` animation. Frame sets as tokens, selected by class:
  `.spin-line` (`|/-\`), `.spin-quad` (`▖▘▝▗`), `.spin-half` (`▌▀▐▄`),
  `.spin-bar` (`▁▂▃▄▅▆▇█`) and `.spin-shade` (`░▒▓█`).

  **Braille is not among them, and that is a measurement.** The braille
  spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) is what every terminal tool uses — ora, cli-spinners,
  most Rust CLIs — and it is 12px wide in a 10px cell in JetBrains Mono and
  DejaVu Sans Mono. It is correct only in Iosevka. The arc (`◜◝◞◟`), circle
  (`◐◓◑◒`) and triangle (`▲▶▼◀`) sets each fail in a different subset of
  the three fonts. What lands on a cell in all of them is ASCII plus
  U+2500–259F, which is exactly the range the README already guarantees the
  bundled fonts cover in full — the same range the borders need, and for the
  same reason (§4.7). So that is the rule for a frame set, and
  `behavior.spec.js` enforces it twice: a lint on the run itself, and a
  measurement of every glyph against `1ch` in each of the three fonts.
- `.loading` on a `.btn` or `.box` sets `aria-busy`, dims the content and
  centers a spinner **inside the same cell count**, so nothing reflows while
  it waits.
- `.progress-label` is a fixed `4ch`, right-aligned, so `9%` → `100%` does not
  shift the bar it labels.

`progress.js` is small: `Webterm.Progress(el).set(value, max)` converts to
whole cells, writes `--fill` and mirrors `aria-valuenow`; `data-wt-progress`
is watched with a `MutationObserver` so a server-rendered update (htmx, Shiny)
needs no JS at all. The rounding rule is floor, with two exceptions that stop
it lying: never 0 cells while `value > 0`, and never `--cells` until
`value === max`.

### 11.5 Placeholders

The novel one. A cell grid can promise something a rem-based skeleton cannot:
**the placeholder occupies exactly the cells the real content will occupy**, so
resolution causes no layout shift at all.

**`.ph` — text scramble.** The real text stays in the DOM:

```html
<span class="ph" data-wt-ph>alpha-7</span>
```

On init the element's text is read and stored, the element is locked to `N`
cells where `N` is that string's length, and the animating glyphs are
`aria-hidden` behind an accessible name carrying the real text. Each tick,
every unresolved position shows a fresh random character from the charset, and
`k` more positions settle on their real character permanently — so the text
arrives piece by piece out of noise, and the width never changes from the
first frame.

Knobs, all `data-` attributes with custom-property defaults:
`data-wt-order="ltr|rtl|random|center|ends"` (which positions settle first),
`data-wt-charset="alnum|hex|binary|symbols|blocks"`, `data-wt-tick`,
`data-wt-duration`, and `data-wt-cycle` (how many random characters a cell
shows before settling, so a cell reads as spinning rather than flickering
once).

Charsets contain only single-cell characters. Katakana is the obvious
temptation and is excluded by rule 7: it is double-width, so it would break
the grid. The spec measures every character in every shipped charset against
`1ch`, which makes that a test failure rather than a visual regression.

**`.ph-area` — the same settle in two dimensions.** A `--cells` × `--rows`
rectangle of noise over content that is already on the grid: a `<pre>` table,
an ascii plot, a log. Same scheduler, same order options, one more axis.

The first attempt had it *erode* — a settled cell going blank to let the
content show through — and that is wrong for a reason worth recording. The
mask has to be opaque, or the noise and the text behind it overlap into mush;
and an opaque mask eroding to a blank reveals the background, not the content.
So an area settles exactly as text does: each cell takes the character that
belongs to it. That is only possible because the content is itself on cells,
which on this framework it is — and it means one code path rather than two.
Content that is not text on the grid is out of scope.

Whitespace never scrambles, in both shapes, which matters more here: the gaps
are the table’s columns, so the layout is there from the first frame and the
values arrive into it. The static no-JS form is a flat `░` fill, the
conventional skeleton, painted by `.ph-mask:empty::before` so that one element
covers both the script-free and the animated case.

**States**, which is what makes this useful rather than decorative:
`Webterm.ph(el).hold()` scrambles indefinitely while a fetch is in flight,
`.resolve(text)` settles on a value that may differ from what the element held,
and `.fail()` settles on `?` in `--error`. `hold()` → `resolve(actual)` is the
async-dashboard flow, and the cell count comes from the placeholder's declared
width rather than the eventual text, so the two must agree — documented, and
over-long text is clipped rather than allowed to reflow.

### 11.6 Toasts

A stack in any corner, each toast a `.box` with its `.box-edge`, a level
`.box-title`, and tinting that reuses `.alert`'s semantic borders.

- width is `--cells` (default 40) clamped to the screen's column count; height
  is however many whole rows the text wraps to
- the stack grows from its corner with `1lh` gaps and a `1ch`/`1lh` inset, and
  clears `.statusbar-fixed` when it is bottom-anchored
- entry is a **typed reveal**: the box draws, then the text appears `k` cells
  per tick, reusing the placeholder scheduler. Exit is immediate.
- **the bottom border is the dismiss timer.** A cell at a time, from the
  right, the `─` run turns to `░` until the whole edge is shaded and the toast
  goes with it — a progress indicator obtained for free out of a border the box
  already draws. The first attempt erased the border instead, which reads as
  damage rather than as a countdown and strands the far corner on its own.
- pause on hover and on focus; a queue cap (`Webterm.config.toastMax`,
  default 4) with overflow queued, and identical consecutive messages
  collapsed into a `×N` counter in the title
- `Webterm.toast('replica charlie is behind', { level: 'warn', timeout: 6000 })`,
  and toasts already in the initial HTML are adopted with the same lifecycle

### 11.7 Modals

Native `<dialog>` with `showModal()`, which is the whole reason `modal.js`
stays small: focus trap, `Escape`, `inert` background and top-layer stacking
are the browser's job.

```html
<dialog class="box modal modal-60" id="confirm">
  <span class="box-edge"></span>
  <span class="box-title">Confirm</span>
  <p class="modal-body">Drop replica charlie?</p>
  <div class="modal-actions">
    <button class="btn btn-error" data-wt-dismiss="modal" value="yes">Yes</button>
    <button class="btn" data-wt-dismiss="modal">Cancel</button>
  </div>
</dialog>
```

- `.modal-40` / `.modal-60` / `.modal-80` are widths in cells, clamped to the
  screen's columns; the top edge is snapped to a whole row (§11.3)
- the `░` shade backdrop (§11.3), with `::backdrop` taking the plain variant
  since a pseudo-element cannot hold a clipped glyph run
- `data-wt-toggle="modal"`, `data-wt-dismiss="modal"`, backdrop click to close
  with `data-wt-static` to refuse it, and focus restored to the opener
- scroll locked without changing the column count (§11.3)
- `await Webterm.confirm('Drop replica charlie?')` and
  `Webterm.prompt({ label: 'host', cells: 24 })` — promise helpers, because a
  terminal UI asks small questions constantly and a `<dialog>` per question is
  not worth writing
- `.modal-stack`: a second dialog shades the first, the classic TUI look

### 11.8 Phases

Spec first at every step, per the repo's test-based protocol: failing
assertions in `behavior.spec.js`, then the CSS, then the JS, then the README,
then `npm test` green.

| phase | contents | why in this order |
|-------|----------|-------------------|
| 0 | §11.1–§11.3: `lib/cells.js`, `lib/motion.js`, `lib/box.js`, `webterm.js`, `overlay.css`, `scrollbar-gutter`, the shade token, the harness refactor (`test/lib/grid.js`, `test/lib/borders.js`, `behavior.html`, `behavior.spec.js`) and the layer-4 source lint | nothing ships visibly; everything after it is cheap |
| 1 | §11.4 loading | mostly CSS, exercises stepped motion, needs no overlay |
| 2 | §11.5 placeholders | self-contained, and where the scheduler earns its keep |
| 3 | §11.6 toasts | first component needing the overlay layer, a lifecycle and a queue |
| 4 | §11.7 modals | focus management and the scroll-lock hazard; leans on all of the above |
| 5 | docs | README behavior section, revised CSS-only claims, limitations, test-status table |

### 11.9 What the specs check

Beyond each component's own behavior, the suite holds layer 4 to §2:

- **source lint** — no px/rem/em length and no color literal anywhere in
  `src/behavior/`
- **cell exactness at every frame, not just at rest.** Animation is sampled
  mid-flight with the scheduler driven by the test, and every sampled frame
  has to be on the grid. A component that is only correct once it settles
  fails here, which is the whole difference between this and a skin.
- **no layout shift** — a placeholder's cell width is identical at frame 0,
  mid-resolution and resolved; a `.loading` button's width is identical before
  and after
- **single-cell charsets** — every character the placeholder can emit measures
  exactly `1ch`
- **borders survive** — anything the JS builds as a `.box` passes the same PNG
  corner and continuity checks as a hand-written one (`test/lib/borders.js`)
- **the column count never moves** — opening a modal, showing a toast and
  locking scroll all leave `.screen` on the same number of columns
- **events** fire in order and the before-events are cancelable
- **reduced motion** reaches the final state on frame 0 and leaves no timer
  running
