/*
 * Cell metrics — the only place the behavior layer reads a pixel.
 *
 * Everything above this module thinks in cells and rows. A component that
 * needs to know how many columns fit asks here and gets an integer; it never
 * sees a pixel and never writes one (PLAN §11.2 rule 4).
 *
 * The probe is 100 cells by 100 rows, not one of each: `1ch` is a whole number
 * of CSS px in Chromium (PLAN §4.7), but what a reader notices is drift
 * accumulated over a long run, and measuring the aggregate is what catches it.
 * Its styles live in grid/overlay.css as .wt-probe, so this file writes no CSS
 * of its own.
 */

// Floating-point slack, so floorCells(13 cells) is 13 and not 12.
const EPS = 1e-9;

let cached = null;
let watching = false;

function measure() {
  const probe = document.createElement('div');
  probe.className = 'wt-probe';
  document.body.append(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { ch: r.width / 100, lh: r.height / 100 };
}

// A resize cannot change the cell, but a font load or a changed --wt-font-size
// can, and both arrive after the first measurement. Invalidate lazily rather
// than re-measuring on the event: a re-measure forces layout, and nothing has
// asked for the new value yet.
function watch() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('resize', invalidate, { passive: true });
  if (document.fonts) document.fonts.addEventListener('loadingdone', invalidate);
}

/** The cell, measured once and cached. */
export function cell() {
  watch();
  if (!cached) cached = measure();
  return cached;
}

/** Re-measure now. Call after changing the font or the font size by hand. */
export function refresh() {
  cached = measure();
  return cached;
}

/** Drop the cached cell; the next cell() measures again. */
export function invalidate() {
  cached = null;
}

/** A pixel width as a possibly fractional number of cells. */
export function toCells(px) {
  return px / cell().ch;
}

/** A pixel height as a possibly fractional number of rows. */
export function toRows(px) {
  return px / cell().lh;
}

/** A pixel width as a whole number of cells, rounded down, never negative. */
export function floorCells(px) {
  return Math.max(0, Math.floor(toCells(px) + EPS));
}

/** A pixel height as a whole number of rows, rounded down, never negative. */
export function floorRows(px) {
  return Math.max(0, Math.floor(toRows(px) + EPS));
}

/** A pixel width as a whole number of cells, rounded to the nearest. */
export function roundCells(px) {
  return Math.max(0, Math.round(toCells(px)));
}

/** A pixel height as a whole number of rows, rounded to the nearest. */
export function roundRows(px) {
  return Math.max(0, Math.round(toRows(px)));
}

/**
 * The column count of the screen container `el` sits in, or of the first
 * .screen on the page, or of the viewport if the page has none. This is the
 * width a toast or a dialog clamps itself to.
 */
export function screenCols(el = null) {
  const screen = (el && el.closest && el.closest('.screen')) || document.querySelector('.screen');
  const width = screen ? screen.getBoundingClientRect().width : document.documentElement.clientWidth;
  return roundCells(width);
}

/**
 * How far `el`'s box falls outside the viewport, in whole cells and rows.
 *
 * A popup has to know whether it fits before it decides which edge to anchor
 * to, and that is a viewport question, so it is a pixel question — which means
 * it belongs in this module and nowhere else (PLAN §11.2 rule 4). The caller
 * gets four integers and never sees a pixel.
 *
 * Rounded up, deliberately: a box hanging a third of a cell over the edge is
 * over the edge, and a popup that flips on that is right to.
 */
export function overflow(el) {
  const r = el.getBoundingClientRect();
  const root = document.documentElement;
  const out = (px, unit) => Math.max(0, Math.ceil(px / unit - EPS));
  const { ch, lh } = cell();
  return {
    left: out(-r.left, ch),
    right: out(r.right - root.clientWidth, ch),
    top: out(-r.top, lh),
    bottom: out(r.bottom - root.clientHeight, lh),
  };
}

/** The row count of the viewport, rounded down — a terminal's height. */
export function viewportRows() {
  return floorRows(window.innerHeight);
}
