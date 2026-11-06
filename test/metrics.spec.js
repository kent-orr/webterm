'use strict';
// Milestone 1 (PLAN §4.7, §10): font metrics.
//
// Asserts that, for each bundled font, the line-height locked in
// src/grid/tokens.css makes box-drawing and block glyphs stack without
// vertical seams, and that `ch` / `lh` lengths match the glyph grid exactly.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fonts = require('../fonts/metrics.json');
const calibration = require('./calibration.json');
const { openMetrics } = require('./lib/metrics-page');

const FAMILY = {
  'jetbrains-mono': 'JetBrains Mono',
  iosevka: 'Iosevka',
  'dejavu-sans-mono': 'DejaVu Sans Mono',
};
const FONTS = Object.keys(FAMILY);
const SIZES = Array.from({ length: 23 }, (_, i) => 10 + i); // 10..32
const DPRS = [1, 1.5, 2];
const OFFSETS = [0, 0.25, 0.5, 0.75];
const DEFAULT_SIZE = 16;
const LAYOUT_UNIT = 1 / 64; // Chromium LayoutUnit
const CLEAN = 0.05; // max loss for a seam-free run (see test/lib/seams.js)
const H_LINES = ['─', '═', '━', '┼'];

let mp;
before(async () => {
  mp = await openMetrics({ dprs: DPRS });
});
after(async () => {
  await mp.close();
});

test('font table data covers every bundled font', () => {
  assert.deepEqual(Object.keys(fonts).sort(), [...FONTS].sort());
});

for (const font of FONTS) {
  describe(font, () => {
    test('regular and bold load from the bundled files', async () => {
      const m = await mp.measure(1, { font });
      assert.equal(m.fontFamily.split(',')[0].replace(/"/g, '').trim(), FAMILY[font]);
      for (const w of [400, 700]) assert.ok(m.fontsLoaded.includes(`${FAMILY[font]}:${w}`), `${w} not loaded: ${m.fontsLoaded}`);
    });

    test('tokens.css defaults to 16px and the calibrated --wt-lh-ratio', async () => {
      const m = await mp.measure(1, { font });
      assert.equal(m.fontSize, DEFAULT_SIZE);
      assert.equal(m.lhRatio, calibration.summary[font].k, 'tokens.css and test/calibration.json disagree; rerun tools/calibrate.js');
    });

    for (const size of SIZES) {
      test(`${size}px: 1ch is the glyph advance; N glyphs are exactly N ch`, async () => {
        const m = await mp.measure(1, { font, size });
        const advance = fonts[font].advanceEm * size;
        assert.ok(Math.abs(m.ch80 - 80 * advance) <= LAYOUT_UNIT, `80ch = ${m.ch80}, expected ${80 * advance}`);
        for (const a of m.advances) {
          assert.equal(a.n, 80);
          assert.ok(
            Math.abs(a.width - m.ch80) <= 2 * LAYOUT_UNIT,
            `${a.n}×${a.glyph}${a.bold ? ' (bold)' : ''} = ${a.width}px, 80ch = ${m.ch80}px`,
          );
        }
      });

      test(`${size}px: line-height is floor(size × ratio), whole px, within the measured limit`, async () => {
        const m = await mp.measure(1, { font, size });
        assert.equal(m.lineHeightPx, Math.floor(size * m.lhRatio + 1e-9));
        assert.ok(m.lineHeightPx > size, `line-height ${m.lineHeightPx}px`);
        const max = calibration.summary[font].maxPx[size];
        assert.ok(m.lineHeightPx <= max, `line-height ${m.lineHeightPx}px exceeds measured limit ${max}px`);
      });

      test(`${size}px: Nlh is N × line-height`, async () => {
        const m = await mp.measure(1, { font, size });
        assert.ok(Math.abs(m.lh12 - 12 * m.lineHeightPx) <= LAYOUT_UNIT, `12lh = ${m.lh12}, line-height ${m.lineHeightPx}`);
      });

      test(`${size}px: locked line-height has no vertical seams at any DPR or offset`, async () => {
        const failures = [];
        for (const dpr of DPRS) {
          for (const offset of OFFSETS) {
            const { seams } = await mp.render(dpr, { font, size, offset });
            for (const s of seams) {
              if (s.axis === 'vertical' && s.worst > CLEAN) failures.push(`dpr ${dpr} offset ${offset} ${s.glyph} loss ${s.worst}`);
            }
          }
        }
        assert.deepEqual(failures, []);
      });

      // Horizontal seams depend on the font and size, not on line-height:
      // when a cell is a whole number of device pixels, adjacent glyphs meet
      // on a pixel boundary and must not leave a lighter column.
      for (const dpr of DPRS) {
        const devicePx = fonts[font].advanceEm * size * dpr;
        if (Math.abs(devicePx - Math.round(devicePx)) > 1e-9) continue;
        test(`${size}px dpr ${dpr}: integer device-pixel cells have no horizontal seams`, async () => {
          const { seams } = await mp.render(dpr, { font, size });
          const bad = seams.filter((s) => s.axis === 'horizontal' && s.worst > CLEAN);
          assert.deepEqual(bad.map((s) => `${s.glyph} loss ${s.worst}`), []);
        });
      }
    }

    test('negative control: the detector finds seams above the theoretical limit', async () => {
      const limit = Math.max(...Object.values(fonts[font].limits).map((l) => l.lines));
      const { seams } = await mp.render(1, { font, size: DEFAULT_SIZE, lh: limit + 0.1 });
      for (const s of seams.filter((x) => x.axis === 'vertical')) {
        assert.ok(s.gaps > 0, `${s.glyph}: expected gaps at line-height ${limit + 0.1}`);
      }
      // Horizontal runs do not depend on line-height and must stay intact.
      for (const s of seams.filter((x) => x.axis === 'horizontal' && H_LINES.includes(x.glyph))) {
        assert.equal(s.gaps, 0, `${s.glyph}: unexpected horizontal gap`);
      }
    });
  });
}
