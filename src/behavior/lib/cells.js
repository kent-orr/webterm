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

/** The row count of the viewport, rounded down — a terminal's height. */
export function viewportRows() {
  return floorRows(window.innerHeight);
}
