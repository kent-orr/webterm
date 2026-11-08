'use strict';
// Cell geometry for the browser specs (PLAN §10).
//
// Every spec that loads a page in Chromium asks the same two questions — how
// big is a cell, and is this element's box a whole number of them — so the
// probe and the off-grid arithmetic live here rather than once per spec file.
//
// The probe measures 100 cells and divides, not one cell, because `1ch` is a
// whole number of CSS px (PLAN §4.7) but the *layout* of a 100ch element is
// what a reader actually sees drift; measuring the aggregate catches a
// rounding error that a single cell would hide.

const TOL = 0.5; // PLAN §10: half a px of slack against a cell boundary.

async function cellSize(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:100ch;height:100lh';
    document.body.append(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { ch: r.width / 100, lh: r.height / 100 };
  });
}

// Every match for `selector`, with the fields the grid assertions need. A
// fixed element is flagged: it is positioned against the viewport, whose
// height is not a whole number of rows, so only its size is on the grid.
async function rects(page, selector) {
  return page.$$eval(selector, (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && String(el.className).slice(0, 40),
      x: r.x, y: r.y, w: r.width, h: r.height,
      fixed: getComputedStyle(el).position === 'fixed',
    };
  }));
}

// Distance from `value` to the nearest multiple of `unit`, in either
// direction. 19.6px against a 20px row is 0.4 off the grid, not 19.6.
function offGrid(value, unit) {
  const m = ((value % unit) + unit) % unit;
  return Math.min(m, unit - m);
}

function describeRect(r) {
  return `${r.tag}${r.cls ? '.' + r.cls.trim().split(/\s+/).join('.') : ''}`;
}

// The column count of the screen container. Several layer-4 assertions are
// "this did not change the column count", because anything that adds or
// removes a scrollbar reflows the whole page by one column (PLAN §11.3).
async function screenColumns(page, cell) {
  const [screen] = await rects(page, '.screen');
  return Math.round(screen.w / cell.ch);
}

/*
 * Hide fixed elements for a screenshot, and put them back.
 *
 * A fullPage screenshot keeps a fixed element at its viewport position, so a
 * pinned status bar paints over whatever border happens to be behind it. It
 * has to go for the duration.
 *
 * Not page.addStyleTag({ id }): that option does not exist, so the tag it
 * creates has no id and the usual getElementById(...).remove() silently fails
 * — leaving every later test looking at a page with no status bar. Injecting
 * the element here means the handle is real.
 */
const HIDE_ID = 'wt-spec-hide-fixed';

async function hideFixed(page, selector = '.statusbar-fixed, .toast-stack, dialog.offcanvas[open]') {
  await page.evaluate(([id, sel]) => {
    document.getElementById(id)?.remove();
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `${sel} { display: none !important; }`;
    document.head.append(style);
  }, [HIDE_ID, selector]);
}

async function showFixed(page) {
  await page.evaluate((id) => document.getElementById(id)?.remove(), HIDE_ID);
}

module.exports = {
  TOL, cellSize, rects, offGrid, describeRect, screenColumns, hideFixed, showFixed,
};
