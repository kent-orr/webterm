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
// fails by dropping a corner or a tail, which geometry alone cannot see.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { startServer } = require('./lib/server');

const TOL = 0.5; // PLAN §10
const SRC = path.resolve(__dirname, '..', 'src');

// Luminance range within a single pixel line; a blank cell over any uniform
// background is flat, an inked one is not.
const INK = 20;

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

async function rects(selector) {
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

function offGrid(value, unit) {
  const m = ((value % unit) + unit) % unit;
  return Math.min(m, unit - m);
}

function describeRect(r) {
  return `${r.tag}${r.cls ? '.' + r.cls.trim().split(/\s+/).join('.') : ''}`;
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
  cell = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:100ch;height:100lh';
    document.body.append(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { ch: r.width / 100, lh: r.height / 100 };
  });
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

  test('every theme defines the same variable contract (PLAN §5.1)', () => {
    const names = (css) => new Set([...stripComments(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const themes = cssFiles(path.join(SRC, 'themes'));
    assert.ok(themes.length >= 3, 'expected at least three themes');
    const required = [
      '--bg', '--fg', '--cursor', '--cursor-fg', '--sel', '--sel-fg',
      ...Array.from({ length: 16 }, (_, i) => `--c${i}`),
    ];
    for (const [name, css] of themes) {
      const have = names(css);
      assert.deepEqual(required.filter((v) => !have.has(v)), [], `${name} is missing variables`);
    }
  });
});

describe('cell grid', () => {
  test('the screen is a whole number of columns', async () => {
    const [screen] = await rects('.screen');
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
      const found = await rects(sel);
      assert.ok(found.length > 0, `no ${sel} on the page`);
      const bad = found.filter((r) => offGrid(r.w, cell.ch) >= TOL);
      assert.deepEqual(bad.map((r) => `${describeRect(r)} w=${r.w} (${(r.w / cell.ch).toFixed(3)}ch)`), []);
    });

    test(`${sel}: height is a whole number of lh`, async () => {
      const bad = (await rects(sel)).filter((r) => offGrid(r.h, cell.lh) >= TOL);
      assert.deepEqual(bad.map((r) => `${describeRect(r)} h=${r.h} (${(r.h / cell.lh).toFixed(3)}lh)`), []);
    });

    // Fixed elements are positioned against the viewport, whose height is not
    // a whole number of rows, so only their size is on the grid.
    test(`${sel}: starts on a cell boundary`, async () => {
      const [screen] = await rects('.screen');
      const bad = (await rects(sel)).filter(
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
    await page.addStyleTag({ id: 'no-fixed', content: '.statusbar-fixed { display: none !important; }' });
    const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    png = PNG.sync.read(shot);
    boxes = await page.$$eval('.box', (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      // A title is meant to interrupt the top run: ┌─ Title ─────┐. Its span
      // is excluded from the continuity check.
      const t = el.querySelector(':scope > .box-title');
      const tr = t && t.getBoundingClientRect();
      return {
        cls: String(el.className),
        x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height,
        title: tr && { x0: tr.x + window.scrollX, x1: tr.x + tr.width + window.scrollX },
      };
    }));
  });

  after(async () => {
    await page.evaluate(() => document.getElementById('no-fixed')?.remove());
  });

  // Luminance range down a pixel column (axis 'y') or across a row (axis 'x').
  function range(x0, y0, x1, y1) {
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

  test('every box has all four corner glyphs', () => {
    const ch = cell.ch;
    const lh = cell.lh;
    const bad = [];
    for (const b of boxes) {
      const corners = {
        tl: [b.x, b.y],
        tr: [b.x + b.w - ch, b.y],
        bl: [b.x, b.y + b.h - lh],
        br: [b.x + b.w - ch, b.y + b.h - lh],
      };
      for (const [name, [cx, cy]] of Object.entries(corners)) {
        const r = range(Math.ceil(cx), Math.ceil(cy), Math.floor(cx + ch), Math.floor(cy + lh));
        if (r < INK) bad.push(`${b.cls} ${name} (range ${r.toFixed(0)})`);
      }
    }
    assert.deepEqual(bad, []);
  });

  // Box-drawing glyphs run edge to edge of their cell, so a run of them is one
  // unbroken line. ASCII - and | do not touch their cell edges, which is why
  // box-drawing exists; .box-ascii is checked cell by cell instead.
  test('every box-drawing edge is continuous between its corners', () => {
    const ch = cell.ch;
    const lh = cell.lh;
    const bad = [];
    for (const b of boxes.filter((x) => !/\bbox-ascii\b/.test(x.cls))) {
      // Horizontal edges: every pixel column between the corner cells.
      for (const [name, ey] of [['top', b.y], ['bottom', b.y + b.h - lh]]) {
        let gaps = 0;
        for (let x = Math.ceil(b.x + ch); x < Math.floor(b.x + b.w - ch); x++) {
          if (name === 'top' && b.title && x >= Math.floor(b.title.x0) - 1 && x < Math.ceil(b.title.x1) + 1) continue;
          if (range(x, Math.ceil(ey), x + 1, Math.floor(ey + lh)) < INK) gaps++;
        }
        if (gaps) bad.push(`${b.cls} ${name}: ${gaps} blank px columns`);
      }
      // Vertical edges: every pixel row between the corner cells.
      for (const [name, ex] of [['left', b.x], ['right', b.x + b.w - ch]]) {
        let gaps = 0;
        for (let y = Math.ceil(b.y + lh); y < Math.floor(b.y + b.h - lh); y++) {
          if (range(Math.ceil(ex), y, Math.floor(ex + ch), y + 1) < INK) gaps++;
        }
        if (gaps) bad.push(`${b.cls} ${name}: ${gaps} blank px rows`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('an ascii box has a glyph in every border cell', () => {
    const ch = cell.ch;
    const lh = cell.lh;
    const ascii = boxes.filter((b) => /\bbox-ascii\b/.test(b.cls));
    assert.ok(ascii.length > 0, 'no .box-ascii on the page');
    const bad = [];
    for (const b of ascii) {
      const cols = Math.round(b.w / ch);
      const rows = Math.round(b.h / lh);
      for (let c = 0; c < cols; c++) {
        for (const [name, row] of [['top', 0], ['bottom', rows - 1]]) {
          if (name === 'top' && b.title && b.x + c * ch >= b.title.x0 - ch && b.x + c * ch < b.title.x1) continue;
          const r = range(Math.ceil(b.x + c * ch), Math.ceil(b.y + row * lh), Math.floor(b.x + (c + 1) * ch), Math.floor(b.y + (row + 1) * lh));
          if (r < INK) bad.push(`${b.cls} ${name} cell ${c}`);
        }
      }
      for (let rw = 0; rw < rows; rw++) {
        for (const [name, col] of [['left', 0], ['right', cols - 1]]) {
          const r = range(Math.ceil(b.x + col * ch), Math.ceil(b.y + rw * lh), Math.floor(b.x + (col + 1) * ch), Math.floor(b.y + (rw + 1) * lh));
          if (r < INK) bad.push(`${b.cls} ${name} cell ${rw}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
});
