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
  --wt-lh-ratio: 1.157;            /* per font, see §4.7 */
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
| JuliaMono        | 1.157           | 18px     | blocks 1.175, lines 1.674 |
| JetBrains Mono   | 1.291           | 20px     | blocks 1.32, lines 1.52 |
| Iosevka          | 1.199           | 19px     | blocks 1.18 (hhea), lines 1.23 |
| DejaVu Sans Mono | 1.153           | 18px     | blocks & lines 1.18  |

Findings:

- **Limit is a whole px per size, not a ratio.** Chromium rounds ascent and
  descent to whole px, so the seam-free line-height at each size is an
  integer N(size) with ~0.02px slack. A fixed unitless ratio either wastes a
  pixel at some sizes or seams at others. Hence the `round(down, …, 1px)`
  formula: K is the largest ratio with floor(size·K) ≤ N(size) for every
  size 10–32px. At 16px all four fonts hit their per-size optimum; other
  sizes lose at most 1px.
- **Blocks bind, not lines.** `█` spans exactly ascent+descent, so it is the
  tighter constraint. We require `█` to stack cleanly, as in a real terminal.
- **Chromium ignores USE_TYPO_METRICS for Iosevka**: measured limits match
  the hhea prediction, not typo. Theory in `fonts/metrics.json`
  (`tools/font-limits.py`) is a guide; the empirical sweep is authoritative.
- **The limit depends on the Chromium build, not just the version.** The
  three ratios above are the milestone-1 run. Re-sweeping the same tree on
  the same reported Chromium version (153.0.8010.12) later measured 1px more
  permissive on 160 of 414 rows — no 16px row moved, so nothing the framework
  ships at its default size changes, but the K digits do. Glyph ink height is
  identical in both (an isolated `│` is the same pixel count at every line
  box), so this is rasterization, not layout. Consequence: a K is only as
  reproducible as the binary that measured it, and `test/calibration.json`
  records which run each font came from. JuliaMono's K was measured on the
  later build, and it also stays under the font-table block limit (1.157 vs
  1.175) at every size, which is the one bound that does not depend on a
  renderer.
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
  end exactly on the advance (`█` in all four fonts; `─`/`┼` in Iosevka)
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

- `.crt` — scanline overlay, slight text glow, optional vignette.
- `.cursor-blink` — a blinking inverse cell for inputs.
- Must not alter any layout metric. Purely visual overlays.

Specified in §12.

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
      repo, and the CSS never depends on it. Round one was toasts, loading,
      placeholders and modals; round two (§11.10) was collapse, tabs,
      dropdown, tooltip and offcanvas. Both are built.
- [ ] Light-background themes: does inverse-video hierarchy still read well?

## 9. Milestones

1. **Metrics** — `test/metrics.html`, calibrate 4 fonts, lock `line-height`. ✅
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
7. **Skin** — `.crt`. ✅
   `src/skin/crt.css`: scanlines, glow, vignette and the cursor blink, with the
   layer held to one rule — it declares nothing that can move an element
   (§12). `test/skin.spec.js` measures that three ways, and `test/skin.html`
   is the demo.
8. **Behavior** — layer 4 (§11). ✅
   Round one: foundation, loading, placeholders, toasts and modals. Round two
   (§11.10): collapse, tabs, dropdown, tooltip and offcanvas. Each phase
   spec-first; `test/behavior.spec.js` holds the layer to §2 with 180
   assertions, sampling cell exactness mid-animation and loading the whole page
   with JavaScript disabled.
   Still open for a third pass: a vertical tablist, and a wipe transition
   between tab panels if one can be made cell-exact.
9. **Docs site** — built with webterm itself, and held to §2 page by page
   (§13). ✅
   Ten static pages in `docs/`, no build step, examples generated from their
   own live markup; `test/docs.spec.js` runs the grid sweep over every one of
   them twice — once normally, once with JavaScript disabled — for 376
   assertions. `docs/skin.html` wears the CRT glass while it is swept, which
   is §12's rule measured on a page built to be read rather than one built to
   be measured.
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

Round one is **toasts, loading, placeholders and modals**. Round two —
**collapse, tabs, dropdown, tooltip and offcanvas** — is §11.10, and the
conventions below were designed to carry it before it was written.

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
  DejaVu Sans Mono, neither of which has the block at all. It is correct only
  in Iosevka and JuliaMono. The arc (`◜◝◞◟`), circle (`◐◓◑◒`) and triangle
  (`▲▶▼◀`) sets each fail in a different subset of the four fonts. What lands on a cell in all of them is ASCII plus
  U+2500–259F, which is exactly the range the README already guarantees the
  bundled fonts cover in full — the same range the borders need, and for the
  same reason (§4.7). So that is the rule for a frame set, and
  `behavior.spec.js` enforces it twice: a lint on the run itself, and a
  measurement of every glyph against `1ch` in each of the four fonts.
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

Round two's phases are §11.10, numbered 6 to 11 and following the same
protocol.

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

### 11.10 Round two: collapse, tabs, dropdown, tooltip, offcanvas

Round one left these named but unspecified so the conventions could be
designed to carry them (§11.2). They are, and the five fall out of two
observations. All five are built; the phase table at the end of this section
is the order they were written in.

**The first: a disclosure is `<details>`.** Collapse and dropdown are the same
widget — a trigger and a region that is there or is not — differing only in
whether the region is in flow or floating over it. `<details>`/`<summary>`
gives both of them the trigger semantics, the keyboard, the `open` state and
the accessible name for free, and gives §11.1 something better than a
degradation: with no script a disclosure is not merely *visible*, it
**works**. Nothing else in the framework can claim that. The cost is that the
browser owns `open`, so the JS has to take the click, animate, and set `open`
itself at the end of the close — and has to watch the `toggle` event, because
`name=` accordion grouping closes a sibling with no click to intercept. That
is the same shape as the modal's `close` listener and is handled the same way.

**The second: the vertical axis has the same promise as the horizontal one.**
§11.5 is only interesting because the placeholder reserves the cells the value
will occupy. A tab strip whose panels are different heights, or a collapse that
tweens a pixel height, breaks that promise on the other axis — the page below
the component moves. So: a collapse animates in **whole rows on the tick**,
never a fractional height, and a tab region is locked to the **tallest panel's
row count**, measured, so switching tabs moves nothing at all. Both measure
through `lib/cells.js`, which stays the one module that reads a pixel.

#### Collapse

```html
<details class="collapse">
  <summary>disk</summary>
  <div class="collapse-body">…</div>
</details>
```

The marker is a glyph, so it comes from the ranges that are one cell in all
four bundled fonts — ASCII and U+2500-259F (glyphs.css). That excludes `▸`
and `▾`, which is what a disclosure triangle wants to be and what every
tempting example uses: U+25B8 is in Geometric Shapes, outside the measured
range. So the default pair is ASCII `+`/`-`, exposed as
`--wt-collapse-closed`/`--wt-collapse-open` for a page that ships a font where
something better is exactly one cell.

Opening steps the body's height from 0 to its natural row count, `k` rows per
tick, where the tick count comes from `data-wt-duration` and not from the row
count — the same reasoning as §11.5's settle schedule, and literally the same
function, which moves to `lib/motion.js` as `stepPlan()` and is imported by
both. Closing runs it backwards and only then clears `open`.

The natural row count is measured once per animation, with the clamp off, in
the same turn that starts it: `<details>` does not render its content while
closed, so there is nothing to measure until `open` is set. Set it, read the
height, clamp to zero and step — all before the frame paints, so the full
height never flashes.

#### Tabs

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

With no script that is a document with two sections and two links to them,
which is the honest static form: every panel readable, the nav working as
in-page navigation. The module upgrades it in place — `role="tablist"`,
`aria-selected`, roving `tabindex`, arrow/Home/End keys, inactive panels
`hidden` — and reuses `.nav`, so a tab strip is not a second set of styles for
something the grid layer already draws.

The height lock is the part that matters. `.tabs-panels` is measured while
every panel is still visible, before the first one is hidden, and pinned to
the tallest in whole rows. Switching tabs then moves nothing below it.
`data-wt-fit="content"` opts out for a page that would rather have the jump
than the empty rows. Text rewraps when the window changes, so the row count is
re-measured on resize — once, from one module-level listener over the live
instances, rather than one listener per tab strip.

No cross-fade and no slide: a terminal repaints a pane, and a transition
between two panels that both have to stay on the grid would be a wipe at best.
The switch is immediate, which is also the behavior reduced motion would force.

#### Dropdown

```html
<details class="dropdown">
  <summary class="btn">actions</summary>
  <div class="box menu dropdown-menu" style="--cells: 20">…</div>
</details>
```

Positioned with `top: 100%` against the summary rather than an offset in rows,
so the menu lands directly below a trigger of any height and stays on the grid
without arithmetic. The same trick does the edge flip: `.dropdown-up` is
`bottom: 100%` and `.dropdown-end` is `right: 0`, so the JS flips a popup by
switching which edge it is anchored to — nothing is ever shifted by a computed
distance, and therefore nothing can land mid-cell. Deciding *whether* to flip
needs the viewport, which is a pixel read, so it goes through a new
`cells.overflow(el)` that reports how far a box falls outside in whole cells
and rows. Tooltip uses it too.

The module adds what a native `<details>` has no opinion about: Escape, a
click outside, one open at a time, roving focus through the menu items, and
focus back to the summary on close. `--wt-z-dropdown` is 15 — above the status
bar, because a dropdown in a status bar is the whole reason the status bar
exists.

#### Tooltip

```html
<span class="tip" data-wt-tip="replica charlie is behind">charlie</span>
```

CSS-only in its static form: `.tip::after` takes its text from the attribute
and shows on `:hover`/`:focus-visible`. It is an inverse-video strip, one row
tall or wrapped to whole rows, `fit-content` wide so the box is the width of
its longest line in cells.

No arrow. A CSS triangle is a sub-cell shape and the glyph that would stand in
for one is not in the single-cell range, so the bubble sits directly against
the trigger's edge instead. That is what a TUI hint line does.

Two things the pseudo-element cannot do are the reason the module replaces it
with a real `.tip-bubble` once it has loaded: it cannot be the target of
`aria-describedby`, and it cannot be flipped away from a viewport edge.
`html[data-wt-ready] .tip::after { content: none }` hands over — CSS keyed on
the ready flag the registry already sets, which is the dependency pointing the
allowed way (§11.1 forbids the static form needing the JS, not the JS
improving on it). The module also adds the open delay, in ticks.

#### Offcanvas

```html
<dialog class="box offcanvas offcanvas-left" style="--cells: 28">…</dialog>
```

A `<dialog>`, exactly like the modal, which means `class Offcanvas extends
Modal`: `showModal()`, Escape, the inert background, the top layer, the
reference-counted scroll lock and the `░` backdrop are all already written and
all already specced. What is new is one axis of geometry and one animation —
`--cells` wide and the viewport's whole rows tall for a side panel, `--rows`
tall for a top or bottom one — and the slide, which steps `--wt-slide` from the
panel's cell count to zero through `stepPlan()`, so every frame of it is a
whole-cell translate.

`--wt-z-offcanvas` goes in the scale at 31 and the modal moves to 32, so a
dialog opened from inside a drawer is above it. The top layer makes that
ordering moot for two `showModal()` dialogs, and the token still has to be
right for a page that opens one non-modally.

#### Phases

Same protocol: failing assertions first, then the CSS, then the JS, then the
README, then `npm test` green.

| phase | contents | why in this order |
|-------|----------|-------------------|
| 6 | collapse, `stepPlan()` out of §11.5 into `lib/motion.js`, `cells.roundRows()` | in flow, no positioning, and it establishes row-stepping for the two components that reuse it |
| 7 | tabs | needs row measuring, nothing else; no overlay, no popup |
| 8 | dropdown, `cells.overflow()` | first popup: light dismiss, roving focus, the edge flip |
| 9 | tooltip | reuses the flip and the ready-flag handover |
| 10 | offcanvas | extends Modal, so it lands last and smallest |
| 11 | docs: README sections, the test-status table, §11 limitations |

#### What the specs add

Beyond each component's own behavior, round two extends the §11.9 sweeps
rather than restating them:

- **the vertical axis of "no layout shift"** — a collapse's height is a whole
  number of rows at every sampled tick and never decreases while opening; a
  tab switch leaves the row below the panels at the same y
- **the disclosure degrades to a working widget** — with scripts disabled, a
  `<details class="collapse">` still opens, and its summary and body are on
  the grid in both states
- **popups land on the grid after a flip**, at the viewport edges where the
  flip triggers, not only in the middle of the page
- **single-cell glyphs** extends to the collapse markers, in all four fonts
- **one timer** — a tooltip's delay, a collapse's step and a drawer's slide all
  go through the one clock, so `motion.clock.jobs` returns to zero after each

## 12. Layer 3: the skin

§6 names three effects and one rule. The rule is the interesting part, and it
is the same shape as the rule that defines each of the other layers: the grid
names no color, the theme sets nothing but color, the behavior layer is
something the CSS never depends on (§11.1). The skin's rule is:

> **the skin declares nothing that can move an element.**

Not "should not" — it is measurable, and `skin.spec.js` measures it twice.
Every rect on the kitchen-sink page is identical with `.crt` and without it,
and a page that loads `crt.css` but never applies the class is pixel-identical
to one that does not load it at all. The first holds the §6 promise. The second
makes the skin something a page can ship unconditionally and switch on at
runtime, which is what a skin is for.

### 12.1 Three constraints that fall out of the layer rules

**No `px`, `rem` or `em` — the same lint as the grid layer.** A scanline is a
sub-cell shape, which looks like the one place the framework would have to
reach for a pixel. It does not: the period is `1lh` and the ink band is a
fraction of `1lh`, so a scanline is one line per *character row* by
construction, and the effect scales with the font instead of drifting away from
it as the page's font-size changes. Every other skin length is a fraction of
`1ch` or `1lh` for the same reason. The glow radius is in `ch`.

Naming it this way is also the webterm-specific part of the effect. A CRT skin
elsewhere picks a 2px or 4px period because it has no better unit available;
here the row *is* the unit, and the lines land on the same boundaries the text
does.

**No literal color — also the same lint as the grid layer.** A skin that names
a color stops surviving a theme swap, which is the one thing every layer above
the theme has to do. That is a real constraint rather than a stylistic one,
because the two overlay effects are both ramps in *alpha*, and alpha with no
color function (`rgba()`, `color-mix()`) available has to come from somewhere
else. It comes from a mask: each overlay is a solid fill of a theme color,
masked by a gradient that is the *shape* of the effect, with the layer's
`opacity` for its strength. The mask's own stops are `currentColor` and
`transparent` — in a mask only the alpha is read, so neither names a color
either.

**The ink is `--bg`, because the contract has no darker token.** `--c0` looks
like the right answer — a scanline is the absence of phosphor, so it should ink
in the theme's black — and it is wrong. The ANSI slots are a *palette*, not a
brightness order: `solarized-light` sets `--c0: #eee8d5`, because slot 0 of the
light Solarized terminal palette is a light tone. A `--c0` overlay would
lighten that theme. `--bg` darkens a dark theme and is a no-op on a light one,
which is the weaker effect and the one that never inverts; a CRT on a light
theme is close to a contradiction anyway, and `--wt-crt-ink` is there for a
page that wants one regardless.

The cost is that the ink is also the page's background, so a *pixel* test for
the scanline geometry cannot tell an inked row from a clear one. `skin.spec.js`
sets `--wt-crt-ink` to `var(--fg)` for those two tests and leaves the default
to the lint and the eye — the geometry is what the pixels are there to check.

### 12.2 Scanlines

```css
.crt::before {
  background-color: var(--wt-crt-ink);
  mask-image: repeating-linear-gradient(to bottom,
    currentColor 0 calc(var(--wt-crt-scan-thickness) * 1lh),
    transparent calc(var(--wt-crt-scan-thickness) * 1lh)
                calc(var(--wt-crt-scan-rows) * 1lh));
  opacity: var(--wt-crt-scan-ink);
}
```

Hard stops, not a ramp: a soft scanline would put a gradient across a character
cell, and the one thing this framework will not do is paint a shape that the
grid cannot account for. `--wt-crt-scan-rows` is 1 and
`--wt-crt-scan-thickness` is 0.5 — half a row of ink, half a row clear.

The overlay is `position: fixed`, so it is glass in front of a moving page
rather than a texture glued to the content. The consequence is honest and
belongs in the limitations: the lines are row-aligned at rest and after a
scroll of a whole number of rows, and sit mid-row at any other scroll offset.
The alternative — an absolute overlay inside the `.crt` element — is
row-aligned at every offset but does not cover `.statusbar-fixed`, a toast
stack or a drawer, which are exactly the elements an overlay like this is most
visible against. Covering the whole screen is the point of the effect; perfect
alignment while a scroll is in flight is not.

### 12.3 Glow

`text-shadow: 0 0 calc(var(--wt-crt-glow) * 1ch) currentColor`, set once on the
`.crt` element and inherited by everything under it. `currentColor` rather than
a token, so a `.c2` span glows green and a `.c1` span glows red — a phosphor
glows in the color it is lit in, and that is also the only form that needs no
color literal. The radius is in cells, so it tracks the font size.

One side effect is worth naming rather than enjoying quietly: the glow covers
the faint horizontal seam of §8. It covers it. It does not fix it, the seam is
still there with the skin off, and a skin is not a solution to a layout bug.

### 12.4 Vignette

`.crt-vignette`, opt-in, same construction as the scanlines with an elliptical
mask: transparent through the middle, opaque at the corners. Nothing new.

### 12.5 The cursor

`.cursor-blink` adds **only the animation**. The lit cell comes from `.inverse`
in the grid layer, or from a `.field`'s block caret:

```html
<span class="inverse cursor-blink"> </span>
```

That is the layer rule applied to the one piece of the skin that is not an
overlay. A skin that also painted the cell would mean a page whose cursor
*disappears* when the skin is omitted; this way the skin is omitted and the
cursor stops blinking, which is exactly the degradation §6 promises.

It blinks on the same clock as everything else (§11.2 rule 5):
`--wt-blink-ticks: 8` is 8 ticks lit and 8 clear, 480ms each at the default
tick. The animation is `opacity: 1 -> 0` under `steps(2, jump-none)`, which
holds 1 for the first half of the period and 0 for the second — on and off,
never a fade, because a terminal cursor does not fade. Under reduced motion it
parks lit (§11.2 rule 6): the final state of a blink is a visible cursor, and
losing the cursor is not a reduced-motion outcome anyone wants.

### 12.6 Where `.crt` goes

On `<html>` or `<body>`. The two overlays are that element's `::before` and
`::after`, and `.box` already uses both of its own for the border runs, so
`.crt` on a box would erase its border. That is a documented restriction rather
than a defensive rule, because defending against it would mean the skin
generating DOM, and the skin is a stylesheet.

`--wt-z-skin: 40` joins the declared stacking order in `overlay.css` rather
than being invented here — the whole reason that scale exists is that it is one
list (§11.3). It is the rung above `--wt-z-modal`. A `<dialog>` opened with
`showModal()` is in the top layer and paints above every z-index there is, so
the glass does not cover an open modal or drawer. The dim behind it is covered,
the dialog itself is not, and that is a limitation, not a setting.

### 12.7 What the spec checks

`test/skin.spec.js`, against `test/components.html` with the skin injected, so
the skin faces every component rather than a page built to flatter it:

- **nothing moves** — every rect the grid suite measures is identical with
  `.crt` and without it, to the pixel, and `.screen` keeps its column count
- **unapplied is inert** — `crt.css` linked without the class leaves a
  full-page screenshot byte-identical to the page without the link
- **the period is a row** — the scanline mask's computed value resolves to
  exactly `1lh`, and its ink band to `thickness × 1lh`
- **the lines land on rows** — in pixels, at scroll 0 and after a whole-row
  scroll
- **the glass is inert** — no pointer events, no selection, not in the
  accessibility tree, and the element under the center of the viewport is still
  the one that was there before
- **source lint** — no `px`/`rem`/`em`, no literal color, and every selector
  scoped to a skin class, which is what makes the inertness structural rather
  than lucky
- **the blink is on the clock** — a whole number of ticks, and parked lit under
  both `prefers-reduced-motion` and `data-wt-motion="off"`

## 13. Milestone 9: the docs site

This is the milestone that cannot be faked. README prose can *claim* the grid
holds. A ten-page site with a nav, a table of contents, long paragraphs, code
listings and live examples either lands on the character grid or it does not —
and `test/docs.spec.js` runs the same sweep over every page of it that
`grid.spec.js` runs over the kitchen sink.

So the site is not a brochure. It is the framework's largest test case, and the
first thing in the repo that has to be *read* rather than measured. Prose at
one size, no indents and no proportional type is exactly where a terminal grid
is least comfortable, which is the point: if webterm cannot document itself
legibly, the §2 rules are a stunt rather than a framework.

It also closes the loop on §1. The prior art this plan argues with — those
skins — all document themselves with a *normal* website. Here the docs are the
proof.

### 13.1 Four decisions, and the rule they follow from

The rule, in the shape of the other layers' rules (§11.1, §12):

> **the docs site uses nothing a reader of the docs could not use.**

No build step, no preprocessor, no framework-only escape hatch. Whatever the
site needs in order to be a site, the framework has to already provide — or
the site goes without it. Four consequences:

**No build step, so no partials.** The header and nav are literal HTML,
repeated verbatim in every page. That is duplication, and duplication rots, so
`docs.spec.js` extracts the block between two sentinel comments from every page
and asserts the blocks are byte-identical apart from the one `aria-current`
attribute. The copies stay honest because a test fails the moment two of them
disagree.

**Pages are plain files and links.** One page per topic, `<a href>` between
them, the current page marked `aria-current="page"`. No router and no
client-side nav — the site works from `file://` for everything but the fonts,
over `npm run serve` locally, and from `/docs` on GitHub Pages, with no
configuration in any of the three.

**Examples have one source.** An example is *live markup* on the page; the
listing under it is generated at runtime from that markup's own `innerHTML`.
Two copies of the same snippet is the one duplication a docs site always has
and always gets wrong, and the framework's own rule (§11.1 — the CSS never
depends on the JS) says which copy has to be the real one: with the script
blocked, every example still renders, and only the listings are missing. The
spec checks both halves — that the page renders with JavaScript off, and that
with it on each listing round-trips to markup equal to the live block.

**The docs CSS is held to the grid layer's lint.** `docs/docs.css` exists —
a site needs a sidebar, a prose measure and a listing style — and it is linted
exactly like `src/grid/`: no `px`, no `rem`, no `em`, no literal color. The
docs get no privileges the framework does not grant.

### 13.2 Structure

```
docs/
  index.html      what it is, the quick start, the rules (§2)
  layout.html     .screen, .row/.col, spacing, breakpoints in columns
  boxes.html      .box, titles, edges, dividers, ascii, nesting
  type.html       hierarchy without size, lists, hr, tables
  forms.html      buttons, inputs, selects, checks, fields
  components.html badges, alerts, nav, statusbar, progress, kv
  behavior.html   layer 4, the nine components, and the JS-off form of each
  theming.html    the variable contract, the nine themes, live picker, size
  skin.html       layer 3, the .crt glass
  about.html      limitations, development, test status, license
  docs.css        the site's own chrome — linted like the grid layer
  docs.js         listing generation and the theme picker; optional by design
```

Ten pages, two assets, no index of indexes. The content is largely a port of
the README sections (which stay — the README is what a reader sees on GitHub),
with the examples turned live.

Layout per page: a fixed single-column shell. `.screen` holds a header strip,
a nav row of inline links, the content, and a `.statusbar` pinned to the
bottom showing the page's column count — the same readout the test pages
carry, because on a docs site it doubles as the demo.

### 13.3 The example pattern

```html
<figure class="ex">
  <figcaption>A box with a title</figcaption>
  <div class="ex-live">
    <div class="box">
      <span class="box-edge"></span>
      <span class="box-title">Hosts</span>
      <p>alpha</p>
    </div>
  </div>
</figure>
```

`docs.js` walks every `.ex-live`, takes its `innerHTML`, strips the common
leading indent, and inserts `<pre class="ex-src">` after it. Consequences
worth naming:

- the listing is the *parsed* markup, not the file's bytes, so it shows what
  the browser built — attribute order normalized, no comments, self-closing
  tags expanded. For a docs site that is a feature: the reader is shown
  markup that is known to produce the thing directly above it.
- a listing is `pre-wrap`, never a horizontal scroller. An inner scroller
  needs a scrollbar, a scrollbar is px, and px is off the grid. The cost is
  that long lines wrap mid-token, so the spec asserts no listing line exceeds
  the content measure and the examples are written to fit.
- `.ex-live` is a plain block with no padding, so an example's own geometry is
  on the grid and the grid sweep covers examples for free.

### 13.4 What the spec checks

`test/docs.spec.js`, over **every** `docs/*.html` the directory holds, so a
page added later cannot skip the suite:

- **the grid holds, page by page** — the `lib/grid.js` sweep from
  `grid.spec.js`: integer `ch` widths, integer `lh` heights, every element
  starting on a cell boundary, `.screen` a whole column count, and no
  horizontal overflow. This is the milestone.
- **borders survive prose** — `lib/borders.js` corner and continuity checks on
  every box on every page, including the boxes that wrap live examples
- **the chrome is one chrome** — the sentinel-delimited header/nav block is
  byte-identical across all ten pages but for `aria-current`
- **the nav is complete and correct** — every page is linked from the nav,
  every nav link resolves to a file that exists, and each page's
  `aria-current` points at itself
- **no dead links** — every relative `href`/`src` in every page resolves on
  disk, anchors included
- **JavaScript off, the site still reads** — the whole site loaded with
  scripts blocked: every `.ex-live` renders, the grid sweep still passes, and
  no page shows an empty listing shell
- **listings are the file** — each `.ex-src` text parses to markup equal to
  the `.ex-live` content of the page's own *source file*, fetched and parsed
  in the browser. Comparing against the live DOM was the first design and it
  does not survive `behavior.html`, where layer 4 has mounted into the DOM by
  the time the check runs. The file is what the reader would have typed, so
  it is the better target anyway.
- **and the live DOM is the file too**, except where layer 4 legitimately
  rewrites it. Those examples carry `data-docs-mounts`, which — like
  `.docs-partial`, the box on `boxes.html` that is missing its `.box-edge` on
  purpose — is counted by the suite, because an opt-out nobody counts is the
  hole the whole thing leaks through.
- **listings fit** — no generated line wider than the content measure
- **source lint** — `docs.css`: no px/rem/em, no literal color. `docs.js`: no
  px/rem/em length and no color literal, the same lint as layer 4.
- **the docs link what they document** — every component class the docs
  mention in a listing exists in `src/`, which catches a renamed class the
  prose kept

### 13.5 Phases

Spec first at every step, as in §11.8.

| phase | contents | why in this order |
|-------|----------|-------------------|
| 0 | `docs.css`, `docs.js`, the chrome, `index.html`, and all of `docs.spec.js` that does not need the other nine pages | the shell and the harness; every page after it is cheap and arrives already measured |
| 1 | `layout.html`, `boxes.html` | the two pages whose own subject is the grid, so the sweep is doing real work from the start |
| 2 | `type.html`, `forms.html` | prose and tables are the hardest legibility case; controls are the hardest geometry case |
| 3 | `components.html` | the largest port, and it is mostly mechanical once phase 2 fixes the example pattern |
| 4 | `behavior.html` | needs the real layer-4 bundle on the page and the JS-off pass to still hold |
| 5 | `theming.html`, `skin.html` | both need a live picker, which is the one place `docs.js` grows |
| 6 | `about.html`, the nav-completeness and dead-link checks at full size, README and `test/index.html` cross-links | closes the milestone |

All six are built. Three things the spec found that the eye did not: a closed
`<details>` still reports a rect for its absolutely positioned menu, so the
border sweep was checking ink that is never painted; Playwright's screenshot
leaves `style=""` on every control with a caret, which only shows up as a
listing mismatch on the one page with form controls; and the first fix for
the first finding marked the DOM, which the file-comparison check caught
immediately on five other pages. None of the three was a framework bug, and
all three would have been invisible without a suite that measures the
documentation.
