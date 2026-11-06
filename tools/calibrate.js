#!/usr/bin/env node
'use strict';
// Empirical line-height calibration (PLAN §4.7).
//
// webterm line-heights are whole CSS pixels:
//
//   line-height = round(down, font-size × K, 1px)
//
// For each font × size × device-pixel-ratio × sub-pixel offset this finds
// N(size): the largest whole-px line-height at which box-drawing lines
// (│ ║ ┃ ┼) and the full block (█) stack with no vertical seam. The font's
// K is then the largest ratio with floor(size × K) ≤ N(size) at every size:
//
//   K < (N(size) + 1) / size     for all sizes
//
// Horizontal seam severity (which depends on font and size, not on
// line-height) is recorded too. Results: test/calibration.json, and the
// suggested K per font on stdout.
//
// Usage: node tools/calibrate.js [--out test/calibration.json]

const fs = require('node:fs');
const path = require('node:path');
const { openMetrics } = require('../test/lib/metrics-page');
const fonts = require('../fonts/metrics.json');

const FONTS = Object.keys(fonts);
const SIZES = Array.from({ length: 23 }, (_, i) => 10 + i); // 10..32
const DPRS = [1, 1.5, 2];
const OFFSETS = [0, 0.5];
const VERTICAL = ['│', '║', '┃', '┼', '█'];
const H_LINES = ['─', '═', '━', '┼'];
const CLEAN = 0.05; // max tolerated loss (see test/lib/seams.js)
const DOWN_CHECK = 2; // also verify this many px below N(size)
const K_DECIMALS = 3;

const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(__dirname, '..', outArg > 0 ? process.argv[outArg + 1] : 'test/calibration.json');

function worst(seams, axis, glyphs) {
  return Math.max(...seams.filter((s) => s.axis === axis && glyphs.includes(s.glyph)).map((s) => s.worst));
}

async function main() {
  const mp = await openMetrics({ dprs: DPRS });
  const rows = [];
  let flakes = 0;

  for (const font of FONTS) {
    const theory = Math.max(...Object.values(fonts[font].limits).map((l) => l.lines));
    for (const size of SIZES) {
      for (const dpr of DPRS) {
        for (const offset of OFFSETS) {
          // A failure is only accepted if a fresh render reproduces it.
          const clean = async (px) => {
            const lh = px / size;
            const a = await mp.render(dpr, { font, size, lh, offset });
            if (worst(a.seams, 'vertical', VERTICAL) <= CLEAN) return { ok: true, seams: a.seams };
            const b = await mp.render(dpr, { font, size, lh, offset });
            const ok = worst(b.seams, 'vertical', VERTICAL) <= CLEAN;
            if (ok) flakes++;
            return { ok, seams: b.seams };
          };
          let px = Math.ceil(theory * size) + 1;
          let res = await clean(px);
          while (!res.ok && px > size) res = await clean(--px);
          let monotonic = true;
          for (let d = 1; d <= DOWN_CHECK; d++) if (!(await clean(px - d)).ok) monotonic = false;
          const row = {
            font, size, dpr, offset,
            maxPx: px,
            monotonic,
            hLines: worst(res.seams, 'horizontal', H_LINES),
            hBlock: worst(res.seams, 'horizontal', ['█']),
          };
          rows.push(row);
          process.stderr.write(`${font.padEnd(17)} ${String(size).padStart(2)}px dpr ${dpr} off ${offset}  N=${px}px (${(px / size).toFixed(4)})  mono ${monotonic}  hLines ${row.hLines}  hBlock ${row.hBlock}\n`);
        }
      }
    }
  }
  await mp.close();

  const summary = {};
  for (const font of FONTS) {
    const perSize = {};
    for (const size of SIZES) {
      perSize[size] = Math.min(...rows.filter((r) => r.font === font && r.size === size).map((r) => r.maxPx));
    }
    // Largest K (to K_DECIMALS) with floor(size × K) ≤ N(size) for every size.
    const bound = Math.min(...SIZES.map((s) => (perSize[s] + 1) / s));
    const scale = 10 ** K_DECIMALS;
    let k = Math.floor(bound * scale) / scale;
    if (k >= bound) k = (Math.ceil(bound * scale) - 1) / scale;
    const fr = rows.filter((r) => r.font === font);
    summary[font] = {
      k,
      bindingSize: SIZES.find((s) => (perSize[s] + 1) / s === bound),
      maxPx: perSize,
      lineHeightPx: Object.fromEntries(SIZES.map((s) => [s, Math.floor(s * k + 1e-9)])),
      monotonic: fr.every((r) => r.monotonic),
      hLinesWorst: Math.max(...fr.map((r) => r.hLines)),
      hBlockWorst: Math.max(...fr.map((r) => r.hBlock)),
    };
  }

  const result = {
    generated: new Date().toISOString(),
    chromium: await mp.version(),
    clean: CLEAN,
    sizes: SIZES,
    dprs: DPRS,
    offsets: OFFSETS,
    flakes,
    summary,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  for (const [font, s] of Object.entries(summary)) {
    console.log(`${font.padEnd(17)} K = ${s.k}  (binding at ${s.bindingSize}px)  16px -> ${s.lineHeightPx[16]}px  monotonic ${s.monotonic}  hLines ${s.hLinesWorst}  hBlock ${s.hBlockWorst}`);
  }
  console.log(`flaky renders: ${flakes}`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
