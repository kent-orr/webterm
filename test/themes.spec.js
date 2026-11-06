'use strict';
// Milestone 5 (PLAN §5): the theme layer.
//
// A theme is nothing but the ~22 color values every terminal scheme encodes,
// so it is checkable without a browser. Two kinds of check:
//
//   1. contract — the eight shipped schemes exist, each declares exactly the
//      §5.1 variable set, as hex, under :root, and sets no layout property.
//      This is what makes themes interchangeable with one <link> swap, and
//      what the generator (§5.3) will have to emit.
//   2. legibility — the pairs the grid layer actually paints have to read.
//      Thresholds are WCAG contrast ratios, floored at what the hand-vetted
//      schemes meet rather than at a round number, and every one of them
//      exists because a raw ANSI slot failed it in some real scheme: dim is
//      --c8, and in Tomorrow Night and Solarized Dark --c8 is the background
//      itself, so the dim attribute would be invisible. Those themes override
//      --muted/--border for exactly that reason, and this suite is what says
//      they must.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHex, contrast } = require('./lib/color');
const theme = require('./lib/theme');

// PLAN §5.2.
const SHIPPED = [
  'amber-phosphor.css',
  'dracula.css',
  'green-phosphor.css',
  'gruvbox-dark.css',
  'nord.css',
  'solarized-dark.css',
  'solarized-light.css',
  'tomorrow-night.css',
];

// Each entry: [label, foreground var, background var, minimum ratio, why].
const PAIRS = [
  ['body text', '--fg', '--bg', 4.5, 'WCAG AA: this is every character on the page'],
  // Inverse video is the whole hierarchy mechanism (PLAN §2.3), and on a light
  // scheme it is the pair most likely to fail; it is the body pair reversed,
  // so the ratio is the same number and the floor is too.
  ['inverse video', '--bg', '--fg', 4.5, 'h1, badges and the status bar swap fg/bg'],
  ['cursor', '--cursor-fg', '--cursor', 4.0, 'the character under the cursor'],
  ['selection', '--sel-fg', '--sel', 4.0, 'selected text'],
  // The faint attribute is meant to recede, so it sits below AA by design.
  // The floor only has to catch a dim slot that has vanished into the
  // background entirely.
  ['dim text', '--muted', '--bg', 2.4, 'the .dim class and faint attribute'],
  ['border', '--border', '--bg', 2.4, 'every box edge glyph'],
  ['body text on a pre/box fill', '--fg', '--c0', 4.0, '--c0 is the pre and code-block background'],
];

// Semantic slots painted as a foreground: alerts, links, code, accents.
const SEMANTIC = ['--error', '--ok', '--warn', '--info', '--accent', '--link'];
const SEMANTIC_MIN = 2.5;

const files = theme.themeFiles();
const loaded = new Map(files.map((f) => [f, theme.readTheme(f)]));
const resolved = new Map(files.map((f) => [f, theme.resolve(loaded.get(f))]));

describe('theme contract (PLAN §5.1)', () => {
  test('all eight schemes in PLAN §5.2 ship', () => {
    assert.deepEqual(files, SHIPPED);
  });

  for (const f of files) {
    describe(f, () => {
      const t = loaded.get(f);

      test('declares every contract variable', () => {
        const missing = theme.REQUIRED.filter((v) => !t.raw.has(v));
        assert.deepEqual(missing, []);
      });

      test('declares nothing outside the contract', () => {
        const allowed = new Set([...theme.REQUIRED, ...theme.ALIASES]);
        const extra = [...t.raw.keys()].filter((v) => !allowed.has(v));
        assert.deepEqual(extra, []);
      });

      // Schemes are published as hex triples and the generator (§5.3) will
      // emit hex, so hex is the only notation a theme may use. It also keeps
      // this suite's contrast math exact.
      test('every value is a hex color', () => {
        const bad = [...t.raw.entries()].filter(([, v]) => !parseHex(v)).map(([k, v]) => `${k}: ${v}`);
        assert.deepEqual(bad, []);
      });

      // A theme is swapped by changing one <link>. If a theme used a stronger
      // selector than :root, it would keep winning after the swap.
      test('targets only :root', () => {
        const bad = theme.rules(t.css).map((r) => r.selector).filter((s) => s !== ':root');
        assert.deepEqual(bad, []);
      });

      test('sets no property but custom properties', () => {
        const bad = theme.allDeclarations(t.css)
          .filter((d) => !d.name.startsWith('--'))
          .map((d) => `${d.selector} { ${d.name} }`);
        assert.deepEqual(bad, []);
      });

      test('credits its source in a leading comment', () => {
        assert.match(t.css, /^\/\*[^*]/, 'first line should be a comment naming the scheme and its author');
      });
    });
  }
});

describe('theme legibility', () => {
  for (const f of files) {
    describe(f, () => {
      const r = resolved.get(f);
      const at = (name) => {
        const v = r.get(name);
        assert.ok(v && parseHex(v), `${name} does not resolve to a color (got ${v})`);
        return v;
      };

      for (const [label, fg, bg, min, why] of PAIRS) {
        test(`${label} reaches ${min}:1`, () => {
          const ratio = contrast(at(fg), at(bg));
          assert.ok(ratio >= min, `${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1 — ${why}`);
        });
      }

      // Dim has to read as dimmer than body text, or the faint attribute
      // carries no information. Checked against --fg rather than --bg so it
      // works on light and dark schemes alike.
      test('dim text is distinguishable from body text', () => {
        const ratio = contrast(at('--muted'), at('--fg'));
        assert.ok(ratio >= 1.3, `--muted against --fg is only ${ratio.toFixed(2)}:1`);
      });

      test('a selection is visible against the background', () => {
        const ratio = contrast(at('--sel'), at('--bg'));
        assert.ok(ratio >= 1.1, `--sel against --bg is only ${ratio.toFixed(2)}:1`);
      });

      // pre and code blocks sit on --c0. It must read as a panel, not as a
      // second background color competing with --bg.
      test('the pre/box fill is visible but quiet', () => {
        const ratio = contrast(at('--c0'), at('--bg'));
        assert.ok(ratio >= 1.04, `--c0 against --bg is only ${ratio.toFixed(2)}:1`);
        assert.ok(ratio <= 2.0, `--c0 against --bg is ${ratio.toFixed(2)}:1, too loud for a panel fill`);
      });

      for (const name of SEMANTIC) {
        test(`${name} reads as a foreground`, () => {
          const ratio = contrast(at(name), at('--bg'));
          assert.ok(ratio >= SEMANTIC_MIN, `${name} on --bg is ${ratio.toFixed(2)}:1, needs ${SEMANTIC_MIN}:1`);
        });
      }
    });
  }
});

describe('the theme picker lists every shipped theme', () => {
  // test/components.html is the kitchen sink and the only consumer of the
  // theme directory; a theme nobody can select is a theme nobody reviews.
  test('components.html offers all of them', () => {
    const html = fs.readFileSync(path.join(__dirname, 'components.html'), 'utf8');
    const picker = /<select id="theme-pick">([\s\S]*?)<\/select>/.exec(html);
    assert.ok(picker, 'no #theme-pick select in components.html');
    const options = [...picker[1].matchAll(/value="([^"]+)"/g)].map((m) => `${m[1]}.css`).sort();
    assert.deepEqual(options, SHIPPED);
  });
});
