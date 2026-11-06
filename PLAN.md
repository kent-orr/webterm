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

## 3. Architecture: three layers

```
┌──────────────────────────────────────────────┐
│ 3. skin      (optional) CRT effects: scanlines,│
│              glow, cursor blink, noise        │
├──────────────────────────────────────────────┤
│ 2. theme     color custom properties only     │
│              (16 ANSI + fg/bg/cursor/select)  │
├──────────────────────────────────────────────┤
│ 1. grid      reset, cell units, rows/cols,    │
│              boxes, type, tables, forms       │
└──────────────────────────────────────────────┘
```

- **grid** never mentions a literal color. It references `var(--c0)` …
  `var(--c15)`, `var(--fg)`, `var(--bg)`, etc.
- **theme** is one file per color scheme that sets only those variables.
- **skin** is additive and can be omitted without affecting layout.

## 4. Layer 1: grid

### 4.1 Root tokens

```css
:root {
  font-family: "JetBrains Mono", "DejaVu Sans Mono", monospace;
  font-size: 16px;            /* the only px in the framework */
  line-height: 1.2;           /* tuned per font, see §4.7 */
  font-variant-ligatures: none;
  font-kerning: none;
  letter-spacing: 0;
  tab-size: 4;
}
```

### 4.2 Screen container

```css
.screen {
  width: calc(round(down, 100vw, 1ch));
  margin: 0 auto;
  container-type: inline-size;
}
```

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

Implementation candidates, to be prototyped in order:

1. `::before` / `::after` pseudo-elements filled with repeated glyphs,
   sides via absolutely positioned elements. Keeps HTML as a plain `<div>`.
2. `border-image` with a generated SVG 9-patch of box glyphs.
3. Literal CSS grid of `repeat(N,1ch) × repeat(M,1lh)` with glyphs in edge
   cells. Most faithful, most DOM. Fallback only.

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

### 4.7 Font metrics (make-or-break)

Box-drawing glyphs connect vertically only when glyph height equals the
line box height. A `line-height` of 1.2 leaves a 1–3px gap in `│` every
row on most fonts.

Plan:
- Pick 3 candidate fonts: JetBrains Mono, DejaVu Sans Mono, Iosevka.
- Build a metrics test page that renders a tall `│` column and a `┼` grid.
- Find the line-height per font where seams close, and ship a per-font
  override: `.font-jetbrains { line-height: 1.19 }` etc.
- Verify `1ch` is truly the cell advance for each (it is the width of `0`;
  in monospace fonts this equals every glyph, but confirm).
- Document that user-supplied fonts need the same calibration.

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

### 5.2 Default themes to ship

Tomorrow Night, Solarized Dark, Solarized Light, Gruvbox Dark, Dracula,
Nord, plus a plain "green phosphor" and "amber phosphor".

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
                 table.css forms.css components.css
    themes/      tomorrow-night.css solarized-dark.css ...
    skin/        crt.css
  dist/          built single-file bundles (webterm.css, webterm.min.css)
  test/
    metrics.html         font calibration page (§4.7)
    components.html      visual kitchen-sink
    *.spec.js            Playwright: assert computed widths are integer ch
  tools/
    gen-theme.*          (later) color scheme → themes/*.css
```

## 8. Open questions / tabled

- [ ] Theme generator: language (Python vs Node) and canonical input format.
- [ ] Fractional ch from flex distribution: accept or enforce integers?
- [ ] Wide glyph support (`2ch` inline-block wrapper) — post-v1.
- [ ] Half-block / braille image renderer — post-v1, JS, separate package.
- [ ] Interactive JS (dropdowns, modals) — out of scope; CSS-only v1.
- [ ] Light-background themes: does inverse-video hierarchy still read well?

## 9. Milestones

1. **Metrics** — `test/metrics.html`, calibrate 3 fonts, lock `line-height`.
2. **Grid core** — reset, tokens, `.screen`, `.row/.col`, `.box` (style 1).
3. **Type + table** — typography scale, table, `hr`, lists.
4. **Forms + components** — buttons, inputs, progress, alerts, nav, status.
5. **Themes** — variable contract frozen; hand-write 8 themes.
6. **Tests** — Playwright checks: every `.box` edge lands on an integer
   `ch`/`lh` boundary; borders have no sub-cell gaps (pixel diff).
7. **Skin** — `.crt`.
8. **Docs site** — built with webterm itself.
9. **Generator** — resolve §8 and automate themes.

## 10. Testing approach

Test-driven where it is measurable:

- Playwright + Chromium: load `test/components.html`, read
  `getBoundingClientRect()` for every `.box`, `.col-*`, and table cell;
  assert `width % chPx` and `height % lhPx` are within 0.5px of 0.
- Screenshot diff of the `│` seam test at each shipped font/line-height.
- Theme files linted: every theme must define exactly the §5.1 variable set.
