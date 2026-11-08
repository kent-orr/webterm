'use strict';
// Box borders, checked in pixels.
//
// The border technique — four over-long glyph runs clipped to disjoint strips,
// each anchored at the end that owns a corner (box.css) — fails by dropping a
// corner or the tail of a run. Geometry cannot see that: the element is still
// the right size, it is just missing ink. So the check is a screenshot and a
// luminance sweep over the cells a border should occupy.
//
// Shared by grid.spec.js (hand-written boxes) and behavior.spec.js (boxes the
// behavior layer builds), because a toast assembled by JS has to pass exactly
// the same check as one typed into the page — that is what makes createBox()
// worth having (PLAN §11.3).

const { PNG } = require('pngjs');

// Luminance range within a region; a blank cell over any uniform background
// is flat, an inked one is not.
const INK = 20;

function readShot(buffer) {
  return PNG.sync.read(buffer);
}

// Document-space geometry of every box matching `selector`, plus the spans of
// whatever is deliberately drawn into its border row.
//
// A title interrupts the top run on purpose (┌─ Title ──┐), and so does a
// toast's dismiss control. Both are opaque and both are meant to be there, so
// the continuity check skips their columns. Anything else that breaks a run is
// a bug. A component marks its own interrupters with data-wt-gap.
//
// `fixed: true` reads viewport coordinates instead of document ones, for a
// fixed-position component screenshotted without fullPage.
async function boxGeometry(page, selector = '.box', { fixed = false } = {}) {
  return page.$$eval(selector, (els, isFixed) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const dx = isFixed ? 0 : window.scrollX;
    const dy = isFixed ? 0 : window.scrollY;
    const gaps = [...el.querySelectorAll(':scope > .box-title, :scope > [data-wt-gap]')]
      .map((g) => g.getBoundingClientRect())
      .map((g) => ({ x0: g.x + dx, x1: g.x + g.width + dx }));
    return {
      cls: String(el.className),
      x: r.x + dx, y: r.y + dy, w: r.width, h: r.height,
      gaps,
    };
  }), fixed);
}

// Whether pixel column x falls inside something the box draws into its border.
function inGap(box, x, slack) {
  return (box.gaps || []).some((g) => x >= Math.floor(g.x0) - slack && x < Math.ceil(g.x1) + slack);
}

function inGapCell(box, x, ch) {
  return (box.gaps || []).some((g) => x >= g.x0 - ch && x < g.x1);
}

function range(png, x0, y0, x1, y1) {
  let lo = 255;
  let hi = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const i = (y * png.width + x) * 4;
      const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
  }
  return hi - lo;
}

// Each of the three checks returns a list of human-readable problems, so a
// spec can assert deepEqual(..., []) and read the failure.

function missingCorners(png, boxes, cell) {
  const { ch, lh } = cell;
  const bad = [];
  for (const b of boxes) {
    const corners = {
      tl: [b.x, b.y],
      tr: [b.x + b.w - ch, b.y],
      bl: [b.x, b.y + b.h - lh],
      br: [b.x + b.w - ch, b.y + b.h - lh],
    };
    for (const [name, [cx, cy]] of Object.entries(corners)) {
      const r = range(png, Math.ceil(cx), Math.ceil(cy), Math.floor(cx + ch), Math.floor(cy + lh));
      if (r < INK) bad.push(`${b.cls} ${name} (range ${r.toFixed(0)})`);
    }
  }
  return bad;
}

// Box-drawing glyphs run edge to edge of their cell, so a run of them is one
// unbroken line and can be checked pixel column by pixel column. ASCII - and |
// do not touch their cell edges, which is why box-drawing exists; pass those
// boxes to brokenAsciiCells instead.
function brokenEdges(png, boxes, cell) {
  const { ch, lh } = cell;
  const bad = [];
  for (const b of boxes) {
    for (const [name, ey] of [['top', b.y], ['bottom', b.y + b.h - lh]]) {
      let gaps = 0;
      for (let x = Math.ceil(b.x + ch); x < Math.floor(b.x + b.w - ch); x++) {
        if (name === 'top' && inGap(b, x, 1)) continue;
        if (range(png, x, Math.ceil(ey), x + 1, Math.floor(ey + lh)) < INK) gaps++;
      }
      if (gaps) bad.push(`${b.cls} ${name}: ${gaps} blank px columns`);
    }
    for (const [name, ex] of [['left', b.x], ['right', b.x + b.w - ch]]) {
      let gaps = 0;
      for (let y = Math.ceil(b.y + lh); y < Math.floor(b.y + b.h - lh); y++) {
        if (range(png, Math.ceil(ex), y, Math.floor(ex + ch), y + 1) < INK) gaps++;
      }
      if (gaps) bad.push(`${b.cls} ${name}: ${gaps} blank px rows`);
    }
  }
  return bad;
}

function brokenAsciiCells(png, boxes, cell) {
  const { ch, lh } = cell;
  const bad = [];
  for (const b of boxes) {
    const cols = Math.round(b.w / ch);
    const rows = Math.round(b.h / lh);
    for (let c = 0; c < cols; c++) {
      for (const [name, row] of [['top', 0], ['bottom', rows - 1]]) {
        if (name === 'top' && inGapCell(b, b.x + c * ch, ch)) continue;
        const r = range(png, Math.ceil(b.x + c * ch), Math.ceil(b.y + row * lh), Math.floor(b.x + (c + 1) * ch), Math.floor(b.y + (row + 1) * lh));
        if (r < INK) bad.push(`${b.cls} ${name} cell ${c}`);
      }
    }
    for (let rw = 0; rw < rows; rw++) {
      for (const [name, col] of [['left', 0], ['right', cols - 1]]) {
        const r = range(png, Math.ceil(b.x + col * ch), Math.ceil(b.y + rw * lh), Math.floor(b.x + (col + 1) * ch), Math.floor(b.y + (rw + 1) * lh));
        if (r < INK) bad.push(`${b.cls} ${name} cell ${rw}`);
      }
    }
  }
  return bad;
}

module.exports = {
  INK,
  readShot,
  boxGeometry,
  range,
  missingCorners,
  brokenEdges,
  brokenAsciiCells,
};
