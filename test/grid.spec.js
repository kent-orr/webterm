'use strict';
// Milestones 2-3 (PLAN §4.2-§4.6, §10): the grid is character-faithful.
//
// Loads the kitchen-sink page and asserts the two rules that make webterm more
// than a skin:
//
//   1. every element's width is a whole number of ch and height a whole
//      number of lh, and every element starts on a cell boundary;
//   2. box borders are continuous glyph runs with all four corners present.
//
// (2) is checked in pixels, because the border technique (four runs clipped to
// disjoint strips, each anchored at the end that owns a corner — see box.css)
// fails by dropping a corner or a tail, which geometry alone cannot see. The
// sweep itself lives in lib/borders.js, shared with behavior.spec.js so a box
// the JS builds faces the same check as one typed into the page.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('./lib/server');
const { TOL, cellSize, rects, offGrid, describeRect, hideFixed, showFixed } = require('./lib/grid');
const borders = require('./lib/borders');

const SRC = path.resolve(__dirname, '..', 'src');

let server;
let browser;
let page;
let cell;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function cssFiles(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [path.join(path.basename(dir), f), fs.readFileSync(path.join(dir, f), 'utf8')]);
}

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 } });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.origin}/test/components.html`);
  await page.waitForSelector('html[data-ready="1"]');
  assert.deepEqual(errors, [], 'page script errors');
  cell = await cellSize(page);
});

after(async () => {
  await browser.close();
  await server.close();
});

describe('source', () => {
  // Rule 1: no px, rem or em anywhere in the grid layer. tokens.css owns the
  // single px font-size and the round(..., 1px) line-height step.
  test('the grid layer declares no px, rem or em length outside tokens.css', () => {
    const bad = [];
    for (const [name, css] of cssFiles(path.join(SRC, 'grid'))) {
      if (name.endsWith('tokens.css')) continue;
      for (const m of stripComments(css).matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g)) {
        bad.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('tokens.css uses px only for the font size and the line-height step', () => {
    const css = stripComments(fs.readFileSync(path.join(SRC, 'grid', 'tokens.css'), 'utf8'));
    const found = [...css.matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g)].map((m) => m[0]);
    assert.deepEqual(found.sort(), ['16px', '1px']);
  });

  test('the grid layer names no literal color', () => {
    const bad = [];
    for (const [name, css] of cssFiles(path.join(SRC, 'grid'))) {
      const body = stripComments(css);
      for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/g)) {
        bad.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

});

describe('cell grid', () => {
  test('the screen is a whole number of columns', async () => {
    const [screen] = await rects(page, '.screen');
    assert.ok(offGrid(screen.w, cell.ch) < TOL, `screen width ${screen.w} is ${screen.w / cell.ch} ch`);
  });

  test('the page does not overflow horizontally', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `overflows by ${over}px`);
  });

  // Boxes, columns and controls are the elements whose edges a reader can see
  // against the character grid.
  const SELECTORS = [
    '.box', '.col', '[class*="col-"]', '.badge', '.progress', '.field',
    '.select', '.statusbar', 'th', 'td', 'hr', '.box-divide',
  ];

  for (const sel of SELECTORS) {
    test(`${sel}: width is a whole number of ch`, async () => {
      const found = await rects(page, sel);
      assert.ok(found.length > 0, `no ${sel} on the page`);
      const bad = found.filter((r) => offGrid(r.w, cell.ch) >= TOL);
      assert.deepEqual(bad.map((r) => `${describeRect(r)} w=${r.w} (${(r.w / cell.ch).toFixed(3)}ch)`), []);
    });

    test(`${sel}: height is a whole number of lh`, async () => {
      const bad = (await rects(page, sel)).filter((r) => offGrid(r.h, cell.lh) >= TOL);
      assert.deepEqual(bad.map((r) => `${describeRect(r)} h=${r.h} (${(r.h / cell.lh).toFixed(3)}lh)`), []);
    });

    // Fixed elements are positioned against the viewport, whose height is not
    // a whole number of rows, so only their size is on the grid.
    test(`${sel}: starts on a cell boundary`, async () => {
      const [screen] = await rects(page, '.screen');
      const bad = (await rects(page, sel)).filter(
        (r) => !r.fixed && (offGrid(r.x - screen.x, cell.ch) >= TOL || offGrid(r.y - screen.y, cell.lh) >= TOL),
      );
      assert.deepEqual(bad.map((r) => `${describeRect(r)} at +${(r.x - screen.x).toFixed(2)},+${(r.y - screen.y).toFixed(2)}`), []);
    });
  }

  test('.col-N is exactly N columns wide', async () => {
    const found = await page.$$eval('[class*="col-"]', (els) => els.map((el) => {
      const n = Number(/col-(\d+)/.exec(el.className)[1]);
      return { n, w: el.getBoundingClientRect().width, cls: el.className };
    }));
    assert.ok(found.length > 0);
    const bad = found.filter((r) => Math.abs(r.w - r.n * cell.ch) >= TOL);
    assert.deepEqual(bad.map((r) => `${r.cls}: ${r.w}px, expected ${r.n * cell.ch}`), []);
  });

  test('a progress fill is exactly --fill cells wide', async () => {
    const found = await page.$$eval('.progress', (els) => els.map((el) => ({
      cells: Number(getComputedStyle(el).getPropertyValue('--cells')),
      fill: Number(getComputedStyle(el).getPropertyValue('--fill')),
      w: el.getBoundingClientRect().width,
      barW: el.querySelector('.bar').getBoundingClientRect().width,
    })));
    assert.ok(found.length > 0);
    for (const p of found) {
      assert.ok(Math.abs(p.w - p.cells * cell.ch) < TOL, `track ${p.w}px, expected ${p.cells} cells`);
      assert.ok(Math.abs(p.barW - p.fill * cell.ch) < TOL, `fill ${p.barW}px, expected ${p.fill} cells`);
    }
  });
});

describe('box borders', () => {
  let png;
  let boxes;

  before(async () => {
    // A fullPage screenshot keeps fixed elements at their viewport position,
    // so the pinned status bar would paint over whatever border happens to be
    // behind it. Its own geometry is checked in the cell grid suite.
    await hideFixed(page);
    const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    png = borders.readShot(shot);
    boxes = await borders.boxGeometry(page, '.box');
  });

  after(async () => {
    await showFixed(page);
  });

  test('every box has all four corner glyphs', () => {
    assert.deepEqual(borders.missingCorners(png, boxes, cell), []);
  });

  test('every box-drawing edge is continuous between its corners', () => {
    const drawn = boxes.filter((b) => !/\bbox-ascii\b/.test(b.cls));
    assert.deepEqual(borders.brokenEdges(png, drawn, cell), []);
  });

  test('an ascii box has a glyph in every border cell', () => {
    const ascii = boxes.filter((b) => /\bbox-ascii\b/.test(b.cls));
    assert.ok(ascii.length > 0, 'no .box-ascii on the page');
    assert.deepEqual(borders.brokenAsciiCells(png, ascii, cell), []);
  });
});
