'use strict';
// Pixel analysis of the metrics page specimens.
//
// Each specimen is a run of one repeated glyph. Along the run we take, for
// every pixel row (vertical runs) or pixel column (horizontal runs), the
// darkest pixel across the stroke. A seam is a line along the run whose
// darkest pixel is lighter than the same glyph's stroke drawn in isolation
// (the #solo specimen). The isolated stroke is the reference because where
// neighbouring glyphs overlap, anti-aliased pixels composite twice and come
// out darker than a single stroke; a median over the run would be skewed.
//
//   loss = max(0, line - ref) / (255 - ref)
//
// 0 means fully inked, 1 means blank paper. `worst` is the maximum loss in
// the run; `gaps` counts lines with loss > 0.5 (an obvious break).
const { PNG } = require('pngjs');

const GAP_LOSS = 0.5;

function decode(buf) {
  return PNG.sync.read(buf);
}

function lum(png, x, y) {
  const i = (y * png.width + x) * 4;
  return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
}

function profile(png, box, along) {
  const out = [];
  if (along === 'y') {
    for (let y = box.y0; y < box.y1; y++) {
      let m = 255;
      for (let x = box.x0; x < box.x1; x++) m = Math.min(m, lum(png, x, y));
      out.push(m);
    }
  } else {
    for (let x = box.x0; x < box.x1; x++) {
      let m = 255;
      for (let y = box.y0; y < box.y1; y++) m = Math.min(m, lum(png, x, y));
      out.push(m);
    }
  }
  return out;
}

function score(prof, ref) {
  const span = Math.max(1, 255 - ref);
  let worst = 0;
  let gaps = 0;
  for (const v of prof) {
    const loss = Math.max(0, (v - ref) / span);
    if (loss > worst) worst = loss;
    if (loss > GAP_LOSS) gaps++;
  }
  return { worst: Math.round(worst * 1000) / 1000, gaps };
}

// m: result of window.wtMeasure(); png: full-page screenshot at `dpr`.
// The run ends are trimmed by one device pixel to drop partial edge pixels.
function analyze(png, m, dpr) {
  const px = (v) => v * dpr;
  const ch = m.ch80 / 80;
  const lh = m.lh12 / 12;
  const out = [];

  // Isolated-stroke reference: the lightest line in the middle half of the
  // glyph, along the stroke. The interior of a lone glyph has no seams, and
  // for crossings (┼) the lightest line is the plain stroke, not the darker
  // line where the perpendicular stroke passes through.
  const s = m.solo.rect;
  const vRef = (i) => {
    const cx = s.x + 2 * i * ch;
    return Math.max(...profile(png, {
      x0: Math.floor(px(cx)), x1: Math.ceil(px(cx + ch)),
      y0: Math.round(px(s.y + 0.25 * lh)), y1: Math.round(px(s.y + 0.75 * lh)),
    }, 'y'));
  };
  const hRef = (i) => {
    const cx = s.x + 2 * i * ch;
    const cy = s.y + 2 * lh;
    return Math.max(...profile(png, {
      x0: Math.round(px(cx + 0.25 * ch)), x1: Math.round(px(cx + 0.75 * ch)),
      y0: Math.floor(px(cy)), y1: Math.ceil(px(cy + lh)),
    }, 'x'));
  };

  const v = m.vert;
  const y0 = Math.ceil(px(v.rect.y)) + 1;
  const y1 = Math.floor(px(v.rect.y + m.rows * lh)) - 1;
  v.glyphs.forEach((glyph, i) => {
    const cx = v.rect.x + 2 * i * ch;
    const box = { x0: Math.floor(px(cx)), x1: Math.ceil(px(cx + ch)), y0, y1 };
    out.push({ glyph, axis: 'vertical', ...score(profile(png, box, 'y'), vRef(i)) });
  });

  const h = m.horiz;
  const x0 = Math.ceil(px(h.rect.x)) + 1;
  const x1 = Math.floor(px(h.rect.x + h.run * ch)) - 1;
  h.glyphs.forEach((glyph, i) => {
    const cy = h.rect.y + 2 * i * lh;
    const box = { x0, x1, y0: Math.floor(px(cy)), y1: Math.ceil(px(cy + lh)) };
    out.push({ glyph, axis: 'horizontal', ...score(profile(png, box, 'x'), hRef(i)) });
  });

  return out;
}

module.exports = { decode, analyze, score, GAP_LOSS };
