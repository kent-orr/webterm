'use strict';
// Layer 4 (PLAN §11): the behavior layer.
//
// Two things are being held here that an ordinary component suite would not
// bother with, and they are the whole reason this layer needs its own spec
// rather than a few assertions bolted onto grid.spec.js:
//
//   1. The behavior layer is bound by §2 exactly as the CSS is. No px from JS,
//      no color literals, and anything it builds or moves lands on a whole
//      cell — *at every frame*, not only once it settles.
//   2. The CSS never depends on the JS (§11.1), so the components also have to
//      be checked in their static, script-free form.
//
// Phase 0 covers the foundation: the source lint, the entry and its registry,
// cells.js, the one scheduler in motion.js, createBox, the overlay stack and
// the scroll lock. Components arrive in later phases.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('./lib/server');
const { TOL, cellSize, rects, offGrid, describeRect, screenColumns, hideFixed, showFixed } = require('./lib/grid');
const borders = require('./lib/borders');

const ROOT = path.resolve(__dirname, '..');
const BEHAVIOR = path.join(ROOT, 'src', 'behavior');

let server;
let browser;
let page;
let cell;

function stripJsComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Every .js file under src/behavior, at any depth, as [relative name, source].
function jsFiles(dir = BEHAVIOR, prefix = 'behavior') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full, `${prefix}/${entry.name}`));
    else if (entry.name.endsWith('.js')) out.push([`${prefix}/${entry.name}`, fs.readFileSync(full, 'utf8')]);
  }
  return out;
}

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 } });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.origin}/test/behavior.html`);
  await page.waitForSelector('html[data-ready="1"]');
  assert.deepEqual(errors, [], 'page script errors');
  cell = await cellSize(page);
});

after(async () => {
  await browser.close();
  await server.close();
});

describe('source', () => {
  test('there is something to lint', () => {
    const files = jsFiles();
    assert.ok(files.length >= 4, `only ${files.length} behavior modules found`);
  });

  // §11.2 rule 4. Geometry is computed in cells; the single pixel measurement
  // in the layer is the probe inside cells.js, which is written in ch and lh.
  test('the behavior layer declares no px, rem or em length', () => {
    const bad = [];
    for (const [name, js] of jsFiles()) {
      for (const m of stripJsComments(js).matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g)) {
        bad.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  // The grid layer names no color so a theme can swap wholesale; a JS template
  // that hardcodes one would defeat that just as thoroughly as CSS would.
  test('the behavior layer names no literal color', () => {
    const bad = [];
    for (const [name, js] of jsFiles()) {
      for (const m of stripJsComments(js).matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/g)) {
        bad.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  // §11.2 rule 7: no dependencies and no build step, which means every import
  // resolves to a relative path in this repo and nothing comes from a package.
  test('every import is relative, so the layer has no dependencies', () => {
    const bad = [];
    for (const [name, js] of jsFiles()) {
      for (const m of stripJsComments(js).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        if (!m[1].startsWith('./') && !m[1].startsWith('../')) bad.push(`${name}: ${m[1]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every module is an ES module', () => {
    const bad = [];
    for (const [name, js] of jsFiles()) {
      const body = stripJsComments(js);
      if (/\brequire\s*\(/.test(body)) bad.push(`${name}: uses require()`);
      if (/\bmodule\.exports\b/.test(body)) bad.push(`${name}: uses module.exports`);
      if (!/\bexport\b/.test(body)) bad.push(`${name}: exports nothing`);
    }
    assert.deepEqual(bad, []);
  });

  // Appearance lives in the grid layer (§11.1), so the JS may set a custom
  // property or a class but never a presentational style property.
  test('the behavior layer sets no presentational style property', () => {
    const bad = [];
    const banned = /\.style\.(color|background|backgroundColor|border|font|fontSize|fontWeight|width|height|top|left|right|bottom|margin|padding)\b/;
    for (const [name, js] of jsFiles()) {
      const body = stripJsComments(js);
      const m = banned.exec(body);
      if (m) bad.push(`${name}: ${m[0]}`);
      for (const s of body.matchAll(/setProperty\(\s*['"]([^'"]+)['"]/g)) {
        if (!s[1].startsWith('--')) bad.push(`${name}: setProperty(${s[1]})`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('webterm.css imports the overlay layer', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'webterm.css'), 'utf8');
    assert.match(css, /@import url\("grid\/overlay\.css"\)/);
  });
});

describe('entry', () => {
  test('the module exposes the documented surface', async () => {
    const shape = await page.evaluate(() => {
      const W = window.Webterm;
      return {
        keys: Object.keys(W).sort(),
        types: Object.fromEntries(Object.keys(W).map((k) => [k, typeof W[k]])),
      };
    });
    for (const name of ['version', 'config', 'cells', 'motion', 'createBox', 'register', 'init', 'emit', 'lockScroll', 'unlockScroll']) {
      assert.ok(shape.keys.includes(name), `missing export ${name}: have ${shape.keys.join(', ')}`);
    }
    assert.equal(shape.types.createBox, 'function');
    assert.equal(shape.types.register, 'function');
    assert.equal(shape.types.emit, 'function');
  });

  test('init marks the document ready and is idempotent', async () => {
    const result = await page.evaluate(() => {
      const first = document.documentElement.dataset.wtReady;
      window.Webterm.init();
      window.Webterm.init();
      return { first, after: document.documentElement.dataset.wtReady };
    });
    assert.equal(result.first, '1');
    assert.equal(result.after, '1');
  });

  // §11.2 rule 3: a before-event is cancelable and its name is namespaced.
  test('emit dispatches a bubbling wt: event and reports cancellation', async () => {
    const seen = await page.evaluate(() => {
      const el = document.createElement('div');
      document.body.append(el);
      const log = [];
      document.addEventListener('wt:probe:show', (e) => {
        log.push({ type: e.type, bubbles: e.bubbles, detail: e.detail, cancelable: e.cancelable });
        e.preventDefault();
      }, { once: true });
      const ok = window.Webterm.emit(el, 'probe:show', { n: 1 });
      const ok2 = window.Webterm.emit(el, 'probe:shown', { n: 2 });
      el.remove();
      return { log, ok, ok2 };
    });
    assert.equal(seen.log.length, 1);
    assert.equal(seen.log[0].type, 'wt:probe:show');
    assert.equal(seen.log[0].bubbles, true);
    assert.equal(seen.log[0].cancelable, true);
    assert.deepEqual(seen.log[0].detail, { n: 1 });
    assert.equal(seen.ok, false, 'a prevented before-event must report false');
    assert.equal(seen.ok2, true);
  });

  test('a registered component mounts once per element and is cached on it', async () => {
    const result = await page.evaluate(() => {
      const mounted = [];
      class Probe {
        constructor(el) { this.el = el; mounted.push(el.id); }
      }
      Probe.selector = '.probe-component';
      window.Webterm.register('probe', Probe);
      const el = document.createElement('div');
      el.id = 'p1';
      el.className = 'probe-component';
      document.body.append(el);
      window.Webterm.init();
      window.Webterm.init();
      const a = window.Webterm.getOrCreate('probe', el);
      const b = window.Webterm.getOrCreate('probe', el);
      el.remove();
      return { mounted, same: a === b, isProbe: a instanceof Probe };
    });
    assert.deepEqual(result.mounted, ['p1'], 'init mounted the element more than once');
    assert.ok(result.same, 'getOrCreate returned a second instance');
    assert.ok(result.isProbe);
  });
});

describe('cells', () => {
  test('the measured cell matches the spec probe', async () => {
    const measured = await page.evaluate(() => window.Webterm.cells.cell());
    assert.ok(Math.abs(measured.ch - cell.ch) < 0.01, `${measured.ch} vs ${cell.ch}`);
    assert.ok(Math.abs(measured.lh - cell.lh) < 0.01, `${measured.lh} vs ${cell.lh}`);
  });

  test('cell() is cached and refresh() re-measures', async () => {
    const result = await page.evaluate(() => {
      const before = window.Webterm.cells.cell();
      document.documentElement.style.setProperty('--wt-font-size', '24px');
      const stale = window.Webterm.cells.cell();
      const fresh = window.Webterm.cells.refresh();
      document.documentElement.style.removeProperty('--wt-font-size');
      window.Webterm.cells.refresh();
      return { before, stale, fresh };
    });
    assert.deepEqual(result.stale, result.before, 'cell() re-measured without refresh()');
    assert.ok(result.fresh.ch > result.before.ch, 'refresh() did not pick up the new size');
  });

  test('cell arithmetic is in whole cells', async () => {
    const result = await page.evaluate(() => {
      const { ch, lh } = window.Webterm.cells.cell();
      return {
        ch,
        lh,
        exact: window.Webterm.cells.toCells(ch * 12),
        floorC: window.Webterm.cells.floorCells(ch * 12.8),
        floorR: window.Webterm.cells.floorRows(lh * 7.9),
        zero: window.Webterm.cells.floorCells(0),
      };
    });
    assert.ok(Math.abs(result.exact - 12) < 1e-9, `${result.exact} cells, expected 12`);
    assert.equal(result.floorC, 12);
    assert.equal(result.floorR, 7);
    assert.equal(result.zero, 0);
  });

  test('screenCols matches the screen container', async () => {
    const reported = await page.evaluate(() => window.Webterm.cells.screenCols());
    assert.equal(reported, await screenColumns(page, cell));
  });
});

describe('motion', () => {
  // The page mounts one placeholder that resolves on load and one that holds
  // indefinitely, which is a real state rather than a leak. Let the first
  // finish, and count only jobs that would end on their own.
  before(async () => {
    await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      clock.pause();
      clock.drain();
      clock.resume();
    });
  });

  test('the tick comes from --wt-tick', async () => {
    const result = await page.evaluate(() => ({
      tick: window.Webterm.motion.tickMs(),
      declared: getComputedStyle(document.documentElement).getPropertyValue('--wt-tick').trim(),
    }));
    assert.equal(result.declared, '60ms');
    assert.equal(result.tick, 60);
  });

  // One clock for the whole page (§11.2 rule 5), which is also what makes the
  // component specs deterministic: pause it and step it by hand.
  test('a paused clock advances only when stepped', async () => {
    const result = await page.evaluate(async () => {
      const { clock, animate } = window.Webterm.motion;
      clock.pause();
      const ticks = [];
      let done = 0;
      const h = animate({ ticks: 10, onTick: (i) => ticks.push(i), onDone: () => { done += 1; } });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const beforeStep = ticks.length;
      clock.step();
      clock.step(3);
      const after = ticks.slice();
      h.cancel();
      clock.resume();
      return { beforeStep, after, done, jobs: clock.finiteJobs };
    });
    assert.equal(result.beforeStep, 0, 'a paused clock ticked on its own');
    assert.deepEqual(result.after, [0, 1, 2, 3]);
    assert.equal(result.done, 0);
    assert.equal(result.jobs, 0, 'cancel() left a job on the clock');
  });

  test('a job ends after its tick count, calls onDone once, and leaves the clock empty', async () => {
    const result = await page.evaluate(() => {
      const { clock, animate } = window.Webterm.motion;
      clock.pause();
      const ticks = [];
      let done = 0;
      animate({ ticks: 3, onTick: (i) => ticks.push(i), onDone: () => { done += 1; } });
      clock.step(10);
      const out = { ticks: ticks.slice(), done, jobs: clock.finiteJobs };
      clock.resume();
      return out;
    });
    assert.deepEqual(result.ticks, [0, 1, 2]);
    assert.equal(result.done, 1);
    assert.equal(result.jobs, 0);
  });

  test('finish() jumps to the end and cancel() does not', async () => {
    const result = await page.evaluate(() => {
      const { clock, animate } = window.Webterm.motion;
      clock.pause();
      let finished = 0;
      let cancelled = 0;
      const a = animate({ ticks: 100, onTick: () => {}, onDone: () => { finished += 1; } });
      a.finish();
      const b = animate({ ticks: 100, onTick: () => {}, onDone: () => { cancelled += 1; } });
      b.cancel();
      const out = { finished, cancelled, jobs: clock.finiteJobs };
      clock.resume();
      return out;
    });
    assert.equal(result.finished, 1, 'finish() must run onDone');
    assert.equal(result.cancelled, 0, 'cancel() must not run onDone');
    assert.equal(result.jobs, 0);
  });

  // §11.2 rule 6. Reduced motion is the final state immediately — not a faster
  // animation — and it leaves no timer running.
  test('data-wt-motion="off" resolves immediately and schedules nothing', async () => {
    const result = await page.evaluate(() => {
      const { clock, animate, motionEnabled } = window.Webterm.motion;
      document.documentElement.dataset.wtMotion = 'off';
      const enabled = motionEnabled();
      const ticks = [];
      let done = 0;
      animate({ ticks: 20, onTick: (i) => ticks.push(i), onDone: () => { done += 1; } });
      const out = { enabled, ticks: ticks.length, done, jobs: clock.finiteJobs };
      delete document.documentElement.dataset.wtMotion;
      return out;
    });
    assert.equal(result.enabled, false);
    assert.equal(result.ticks, 0, 'reduced motion must not tick');
    assert.equal(result.done, 1, 'reduced motion must still reach the final state');
    assert.equal(result.jobs, 0, 'reduced motion left a job on the clock');
  });

  test('prefers-reduced-motion disables motion without an attribute', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const result = await page.evaluate(() => {
      const { clock, animate, motionEnabled } = window.Webterm.motion;
      let done = 0;
      animate({ ticks: 20, onTick: () => {}, onDone: () => { done += 1; } });
      return { enabled: motionEnabled(), done, jobs: clock.finiteJobs };
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(result.enabled, false);
    assert.equal(result.done, 1);
    assert.equal(result.jobs, 0);
  });
});

describe('createBox', () => {
  test('a built box carries exactly one edge span', async () => {
    const result = await page.evaluate(() => {
      const box = window.Webterm.createBox({ title: 'probe', html: '<p>x</p>' });
      const out = {
        cls: box.className,
        edges: box.querySelectorAll(':scope > .box-edge').length,
        titles: box.querySelectorAll(':scope > .box-title').length,
        titleText: box.querySelector(':scope > .box-title')?.textContent,
        firstChild: box.firstElementChild.className,
      };
      return out;
    });
    assert.match(result.cls, /\bbox\b/);
    assert.equal(result.edges, 1, 'a box with no edge span draws two of its four edges');
    assert.equal(result.titles, 1);
    assert.equal(result.titleText, 'probe');
    assert.equal(result.firstChild, 'box-edge');
  });

  test('ensureEdge adopts a box that has none and leaves one that has', async () => {
    const result = await page.evaluate(() => {
      const a = document.createElement('div');
      a.className = 'box';
      window.Webterm.ensureEdge(a);
      const b = window.Webterm.createBox({});
      window.Webterm.ensureEdge(b);
      return {
        a: a.querySelectorAll(':scope > .box-edge').length,
        b: b.querySelectorAll(':scope > .box-edge').length,
      };
    });
    assert.equal(result.a, 1);
    assert.equal(result.b, 1);
  });

  test('a built box is cell-exact', async () => {
    const found = await rects(page, '#built > .box');
    assert.ok(found.length > 0, 'the page built no boxes');
    const [screen] = await rects(page, '.screen');
    const bad = found.filter((r) => offGrid(r.w, cell.ch) >= TOL
      || offGrid(r.h, cell.lh) >= TOL
      || offGrid(r.x - screen.x, cell.ch) >= TOL
      || offGrid(r.y - screen.y, cell.lh) >= TOL);
    assert.deepEqual(bad.map((r) => `${describeRect(r)} ${r.w}x${r.h} at +${(r.x - screen.x).toFixed(2)},+${(r.y - screen.y).toFixed(2)}`), []);
  });

  // The point of createBox: a box the JS assembles has to be indistinguishable
  // from one typed into the page, which means the same pixel sweep.
  test('a built box has four corners and continuous edges', async () => {
    await hideFixed(page);
    const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    await showFixed(page);
    const png = borders.readShot(shot);
    const boxes = await borders.boxGeometry(page, '#built > .box');
    assert.ok(boxes.length > 0);
    assert.deepEqual(borders.missingCorners(png, boxes, cell), []);
    assert.deepEqual(borders.brokenEdges(png, boxes, cell), []);
  });
});

describe('overlay', () => {
  test('the z-layer scale is declared and strictly ordered', async () => {
    const z = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const read = (n) => Number(s.getPropertyValue(n).trim());
      return {
        content: read('--wt-z-content'),
        statusbar: read('--wt-z-statusbar'),
        toast: read('--wt-z-toast'),
        backdrop: read('--wt-z-backdrop'),
        modal: read('--wt-z-modal'),
      };
    });
    const order = ['content', 'statusbar', 'toast', 'backdrop', 'modal'];
    for (const name of order) assert.ok(Number.isFinite(z[name]), `--wt-z-${name} is not a number`);
    for (let i = 1; i < order.length; i++) {
      assert.ok(z[order[i]] > z[order[i - 1]], `${order[i]} (${z[order[i]]}) must sit above ${order[i - 1]} (${z[order[i - 1]]})`);
    }
  });

  test('the status bar takes its z-index from the scale', async () => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('.statusbar-fixed');
      const s = getComputedStyle(document.documentElement);
      return { z: getComputedStyle(el).zIndex, want: s.getPropertyValue('--wt-z-statusbar').trim() };
    });
    assert.equal(result.z, result.want);
  });

  // §11.3: the viewport is not a whole number of rows, so an overlay rounds
  // down to one rather than centering its children on a half row.
  // A fixed element's containing block is the viewport, and the viewport is
  // not a whole number of cells either way — so an overlay rounds both of its
  // dimensions down, the way .screen rounds its width.
  test('an overlay is a whole number of cells in both directions', async () => {
    // The reference is a stretched fixed element, not the viewport: a fixed
    // containing block excludes the scrollbar gutter, so that is the box an
    // overlay is rounding down from.
    const h = await page.evaluate(() => {
      const ref = document.createElement('div');
      ref.style.cssText = 'position:fixed;top:0;bottom:0;left:0;right:0;visibility:hidden';
      const el = document.createElement('div');
      el.className = 'overlay';
      document.body.append(ref, el);
      const a = ref.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      ref.remove();
      el.remove();
      return { w: b.width, h: b.height, refW: a.width, refH: a.height };
    });
    assert.ok(offGrid(h.h, cell.lh) < TOL, `overlay is ${h.h}px, ${(h.h / cell.lh).toFixed(3)} rows`);
    assert.ok(offGrid(h.w, cell.ch) < TOL, `overlay is ${h.w}px, ${(h.w / cell.ch).toFixed(3)} ch`);
    assert.ok(h.h <= h.refH, `overlay ${h.h}px exceeds its containing block ${h.refH}px`);
    assert.ok(h.w <= h.refW, `overlay ${h.w}px exceeds its containing block ${h.refW}px`);
    assert.ok(h.refH - h.h < cell.lh, `overlay leaves ${h.refH - h.h}px unfilled, more than a row`);
    assert.ok(h.refW - h.w < cell.ch, `overlay leaves ${h.refW - h.w}px unfilled, more than a cell`);
  });

  // §11.3: a backdrop cannot name a color under the grid lint, so it covers
  // what is behind it with block-shade glyphs painted in --bg.
  test('a shade is a wrapping run of single-cell glyphs in --bg', async () => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('#demo-shade');
      const s = getComputedStyle(el);
      const probe = getComputedStyle(el, '::before');
      const root = getComputedStyle(document.documentElement);
      return {
        color: s.color,
        bg: root.getPropertyValue('--bg').trim(),
        wrap: s.whiteSpace,
        breaks: s.overflowWrap + ' ' + s.wordBreak,
        content: probe.content.slice(0, 4),
        rect: el.getBoundingClientRect(),
        host: document.querySelector('#shade-host').getBoundingClientRect(),
      };
    });
    assert.match(result.wrap, /pre-wrap/, 'a shade has to wrap to fill its box');
    assert.match(result.breaks, /anywhere|break-all/, 'an unbroken glyph run will not wrap without this');
    assert.match(result.content, /[░▒▓]/, `content starts ${JSON.stringify(result.content)}`);
    assert.ok(offGrid(result.rect.width, cell.ch) < TOL, `shade is ${result.rect.width}px wide`);
    assert.ok(offGrid(result.rect.height, cell.lh) < TOL, `shade is ${result.rect.height}px tall`);
  });

  test('every shade glyph occupies exactly one cell', async () => {
    const widths = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.setProperty('--probe', '1');
      probe.className = 'pre';
      document.body.append(probe);
      const out = {};
      for (const g of ['░', '▒', '▓', '█']) {
        probe.textContent = g.repeat(10);
        out[g] = probe.getBoundingClientRect().width / 10;
      }
      probe.remove();
      return out;
    });
    for (const [glyph, w] of Object.entries(widths)) {
      assert.ok(Math.abs(w - cell.ch) < 0.05, `${glyph} is ${w}px, cell is ${cell.ch}px`);
    }
  });
});

describe('scroll lock', () => {
  // §11.3, the hazard that is specific to a character grid: removing the
  // scrollbar re-rounds .screen and reflows the entire page behind the dialog.
  test('html reserves a stable scrollbar gutter', async () => {
    const gutter = await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter);
    assert.equal(gutter, 'stable');
  });

  test('locking scroll leaves the column count unchanged', async () => {
    const before = await screenColumns(page, cell);
    await page.evaluate(() => window.Webterm.lockScroll());
    const locked = await screenColumns(page, cell);
    const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
    await page.evaluate(() => window.Webterm.unlockScroll());
    const after = await screenColumns(page, cell);
    assert.match(overflow, /hidden/, 'lockScroll did not lock anything');
    assert.equal(locked, before, 'the page reflowed by a column when scroll locked');
    assert.equal(after, before);
  });

  test('the lock is reference counted', async () => {
    const result = await page.evaluate(() => {
      const { lockScroll, unlockScroll } = window.Webterm;
      lockScroll();
      lockScroll();
      unlockScroll();
      const mid = getComputedStyle(document.documentElement).overflow;
      unlockScroll();
      unlockScroll();
      const end = getComputedStyle(document.documentElement).overflow;
      return { mid, end };
    });
    assert.match(result.mid, /hidden/, 'the first unlock released a nested lock');
    assert.ok(!/hidden/.test(result.end), 'the lock never released');
  });
});

/* ------------------------------------------------------- phase 1: loading */

// The frame sets are the interesting constraint. The braille spinner is the
// one every terminal tool uses (ora, cli-spinners, every Rust CLI), and it is
// double-width in two of the three bundled fonts — 12px in a 10px cell for
// JetBrains Mono and DejaVu Sans Mono, correct only in Iosevka. So are the
// arc, circle and triangle spinners, each in a different subset of the fonts.
// What survives all three is ASCII plus U+2500-259F, which is exactly the
// range the README guarantees the bundled fonts cover in full. These two tests
// are what keep a tempting charset out.
describe('frame sets', () => {
  const FONTS = ['font-jetbrains-mono', 'font-iosevka', 'font-dejavu-sans-mono'];
  const SETS = ['line', 'quad', 'half', 'bar', 'shade'];

  test('glyphs.css declares a frame run for every shipped spinner', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'grid', 'glyphs.css'), 'utf8');
    const components = fs.readFileSync(path.join(ROOT, 'src', 'grid', 'components.css'), 'utf8');
    for (const name of SETS) {
      assert.match(css, new RegExp(`--wt-frames-${name}:`), `glyphs.css has no --wt-frames-${name}`);
      assert.match(components, new RegExp(`\\.spin-${name}\\b`), `components.css has no .spin-${name}`);
    }
  });

  test('a frame run uses only ascii and U+2500-259F', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'grid', 'glyphs.css'), 'utf8');
    const bad = [];
    for (const m of css.matchAll(/--wt-frames-([a-z]+):\s*"((?:[^"\\]|\\.)*)"/g)) {
      for (const c of [...m[2]]) {
        const cp = c.codePointAt(0);
        const ok = (cp >= 0x20 && cp < 0x7f) || (cp >= 0x2500 && cp <= 0x259f);
        if (!ok) bad.push(`${m[1]}: ${c} U+${cp.toString(16).toUpperCase()}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  for (const font of FONTS) {
    test(`every frame glyph is exactly one cell in ${font}`, async () => {
      const result = await page.evaluate(async (f) => {
        const previous = document.documentElement.className;
        document.documentElement.className = f;
        await document.fonts.ready;
        const probe = document.createElement('span');
        probe.className = 'wt-probe';
        document.body.append(probe);
        probe.textContent = '';
        const root = getComputedStyle(document.documentElement);
        // The cell for this font, measured the same way cells.js does.
        const stick = document.createElement('div');
        stick.className = 'wt-probe';
        document.body.append(stick);
        const ch = stick.getBoundingClientRect().width / 100;
        stick.remove();

        const measure = document.createElement('span');
        measure.className = 'pre';
        measure.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        document.body.append(measure);
        const out = {};
        for (const name of ['line', 'quad', 'half', 'bar', 'shade']) {
          const run = root.getPropertyValue(`--wt-frames-${name}`).trim().replace(/^"|"$/g, '');
          const glyphs = [...run.replace(/\\\\/g, '\\')];
          out[name] = { count: glyphs.length, bad: [] };
          for (const g of glyphs) {
            measure.textContent = g.repeat(20);
            const w = measure.getBoundingClientRect().width / 20;
            if (Math.abs(w - ch) > 0.02) out[name].bad.push(`${g}=${w.toFixed(3)} (cell ${ch.toFixed(3)})`);
          }
        }
        measure.remove();
        probe.remove();
        document.documentElement.className = previous;
        await document.fonts.ready;
        return out;
      }, font);

      const problems = [];
      for (const [name, info] of Object.entries(result)) {
        if (info.count === 0) problems.push(`${name}: run is empty`);
        for (const b of info.bad) problems.push(`${name}: ${b}`);
      }
      assert.deepEqual(problems, []);
    });
  }

  test('each spinner class declares a frame count matching its run', async () => {
    const result = await page.evaluate(() => {
      const out = {};
      for (const name of ['line', 'quad', 'half', 'bar', 'shade']) {
        const el = document.createElement('span');
        el.className = `spin spin-${name}`;
        document.body.append(el);
        const s = getComputedStyle(el);
        const run = s.getPropertyValue('--wt-frames').trim().replace(/^"|"$/g, '');
        out[name] = {
          declared: Number(s.getPropertyValue('--wt-frame-count')),
          actual: [...run.replace(/\\\\/g, '\\')].length,
        };
        el.remove();
      }
      return out;
    });
    const bad = Object.entries(result)
      .filter(([, v]) => v.declared !== v.actual)
      .map(([k, v]) => `${k}: --wt-frame-count ${v.declared}, run has ${v.actual}`);
    assert.deepEqual(bad, []);
  });
});

describe('spinner', () => {
  test('a spinner is one cell by one row', async () => {
    const found = await rects(page, '.spin');
    assert.ok(found.length > 0, 'no .spin on the page');
    const bad = found.filter((r) => Math.abs(r.w - cell.ch) >= TOL || Math.abs(r.h - cell.lh) >= TOL);
    assert.deepEqual(bad.map((r) => `${describeRect(r)} ${r.w}x${r.h}`), []);
  });

  // The frame window is one cell wide over a run of frames, translated a whole
  // cell per step (the trick box.css uses for borders). Sampled over real
  // frames: a stepped animation is on a cell boundary at every instant, and an
  // eased one would not be.
  test('the frame window sits on a cell boundary at every sampled frame', async () => {
    const samples = await page.evaluate(async () => {
      const el = document.querySelector('.spin');
      const out = [];
      for (let i = 0; i < 24; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        const host = el.getBoundingClientRect();
        // The run is the ::before box; its offset shows through as the
        // element's first child box, so read the transform directly.
        const t = new DOMMatrixReadOnly(getComputedStyle(el, '::before').transform);
        out.push({ x: t.m41, host: host.x });
      }
      return out;
    });
    assert.ok(samples.length === 24);
    const bad = samples.filter((s) => offGrid(s.x, cell.ch) >= TOL);
    assert.deepEqual(bad.map((s) => `${s.x}px (${(s.x / cell.ch).toFixed(3)} cells)`), []);
  });

  test('a spinner actually advances', async () => {
    const moved = await page.evaluate(async () => {
      const el = document.querySelector('.spin');
      const read = () => new DOMMatrixReadOnly(getComputedStyle(el, '::before').transform).m41;
      const seen = new Set();
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        seen.add(read());
      }
      return seen.size;
    });
    assert.ok(moved > 1, 'the spinner never moved');
  });

  test('motion off freezes the spinner on its first frame', async () => {
    const result = await page.evaluate(async () => {
      document.documentElement.dataset.wtMotion = 'off';
      const el = document.querySelector('.spin');
      const read = () => new DOMMatrixReadOnly(getComputedStyle(el, '::before').transform).m41;
      await new Promise((r) => requestAnimationFrame(r));
      const a = read();
      const name = getComputedStyle(el, '::before').animationName;
      for (let i = 0; i < 10; i += 1) await new Promise((r) => requestAnimationFrame(r));
      const b = read();
      delete document.documentElement.dataset.wtMotion;
      return { a, b, name };
    });
    assert.equal(result.name, 'none', 'the spinner keeps animating with motion off');
    assert.equal(result.a, result.b);
    assert.equal(result.a, 0, 'a frozen spinner must show its first frame');
  });
});

describe('progress', () => {
  test('an indeterminate bar is a whole number of cells at every sampled frame', async () => {
    const samples = await page.evaluate(async () => {
      const track = document.querySelector('.progress-indeterminate');
      const bar = track.querySelector('.bar');
      const out = [];
      for (let i = 0; i < 24; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        const t = track.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        out.push({ dx: b.x - t.x, w: b.width });
      }
      return out;
    });
    const bad = samples.filter((s) => offGrid(s.dx, cell.ch) >= TOL || offGrid(s.w, cell.ch) >= TOL);
    assert.deepEqual(bad.map((s) => `+${s.dx.toFixed(2)}px w=${s.w}`), []);
  });

  test('an indeterminate bar marches', async () => {
    const seen = await page.evaluate(async () => {
      const bar = document.querySelector('.progress-indeterminate .bar');
      const out = new Set();
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        out.add(Math.round(bar.getBoundingClientRect().x));
      }
      return out.size;
    });
    assert.ok(seen > 1, 'the indeterminate bar never moved');
  });

  test('a progress label is a fixed four cells, right aligned', async () => {
    const found = await rects(page, '.progress-label');
    assert.ok(found.length > 0, 'no .progress-label on the page');
    for (const r of found) {
      assert.ok(Math.abs(r.w - 4 * cell.ch) < TOL, `label is ${r.w}px, expected 4 cells`);
    }
    const align = await page.$eval('.progress-label', (el) => getComputedStyle(el).textAlign);
    assert.equal(align, 'right');
  });

  // The rounding rule (PLAN §11.4): floor, except never 0 while value > 0 and
  // never full until value === max, so a bar cannot lie in either direction.
  test('a fill is always a whole number of cells inside the track', async () => {
    const bad = await page.evaluate(() => {
      const el = document.querySelector('#prog-determinate');
      const p = window.Webterm.getOrCreate('progress', el);
      const cells = Number(getComputedStyle(el).getPropertyValue('--cells'));
      const problems = [];
      let seed = 7;
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < 200; i += 1) {
        const max = 1 + Math.floor(rand() * 500);
        const value = rand() * max;
        p.set(value, max);
        const fill = Number(getComputedStyle(el).getPropertyValue('--fill'));
        const label = `${value.toFixed(2)}/${max} -> ${fill}`;
        if (!Number.isInteger(fill)) problems.push(`${label}: not an integer`);
        if (fill < 0 || fill > cells) problems.push(`${label}: outside 0..${cells}`);
        if (value > 0 && fill === 0) problems.push(`${label}: empty while value > 0`);
        if (value < max && fill === cells) problems.push(`${label}: full before value === max`);
      }
      p.set(1, 1);
      if (Number(getComputedStyle(el).getPropertyValue('--fill')) !== cells) problems.push('value === max is not full');
      p.set(0, 1);
      if (Number(getComputedStyle(el).getPropertyValue('--fill')) !== 0) problems.push('zero is not empty');
      return problems.slice(0, 10);
    });
    assert.deepEqual(bad, []);
  });

  test('a progress element carries its aria state', async () => {
    const aria = await page.evaluate(() => {
      const el = document.querySelector('#prog-determinate');
      const p = window.Webterm.getOrCreate('progress', el);
      p.set(3, 8);
      return {
        role: el.getAttribute('role'),
        now: el.getAttribute('aria-valuenow'),
        min: el.getAttribute('aria-valuemin'),
        max: el.getAttribute('aria-valuemax'),
        indeterminate: document.querySelector('.progress-indeterminate').hasAttribute('aria-valuenow'),
      };
    });
    assert.equal(aria.role, 'progressbar');
    assert.equal(aria.now, '3');
    assert.equal(aria.min, '0');
    assert.equal(aria.max, '8');
    assert.equal(aria.indeterminate, false, 'an indeterminate bar must not claim a value');
  });

  // A server-rendered update (htmx, Shiny) changes an attribute and nothing
  // else, so the attribute is the API and no JS has to be written at all.
  test('data-wt-progress drives the fill, including when it changes', async () => {
    const result = await page.evaluate(async () => {
      const el = document.querySelector('#prog-attr');
      const read = () => Number(getComputedStyle(el).getPropertyValue('--fill'));
      const initial = read();
      el.setAttribute('data-wt-progress', '0.5');
      await new Promise((r) => setTimeout(r, 0));
      const half = read();
      el.setAttribute('data-wt-progress', '1');
      await new Promise((r) => setTimeout(r, 0));
      const full = read();
      return { initial, half, full, cells: Number(getComputedStyle(el).getPropertyValue('--cells')) };
    });
    assert.equal(result.initial, Math.floor(0.25 * result.cells), 'the initial attribute was not applied');
    assert.equal(result.half, result.cells / 2);
    assert.equal(result.full, result.cells);
  });
});

describe('loading', () => {
  test('a loading button keeps its exact width', async () => {
    const result = await page.evaluate(async () => {
      const btn = document.querySelector('#load-btn');
      const before = btn.getBoundingClientRect().width;
      window.Webterm.setLoading(btn, true);
      const during = btn.getBoundingClientRect().width;
      const busy = btn.getAttribute('aria-busy');
      const spinners = btn.querySelectorAll(':scope > .spin').length;
      const labelHidden = getComputedStyle(btn.querySelector(':scope > .loading-label')).visibility;
      window.Webterm.setLoading(btn, false);
      const after = btn.getBoundingClientRect().width;
      return {
        before, during, after, busy, spinners, labelHidden,
        leftovers: btn.querySelectorAll(':scope > .spin, :scope > .loading-label').length,
        text: btn.textContent.trim(),
      };
    });
    assert.equal(result.during, result.before, 'the button resized while loading');
    assert.equal(result.after, result.before, 'the button did not return to its size');
    assert.equal(result.busy, 'true');
    assert.equal(result.spinners, 1);
    assert.equal(result.labelHidden, 'hidden');
    assert.equal(result.leftovers, 0, 'setLoading(false) left its own nodes behind');
    assert.equal(result.text, 'save');
  });

  test('the spinner in a loading element lands on a cell', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      const probe = document.createElement('div');
      probe.className = 'wt-probe';
      document.body.append(probe);
      const r = probe.getBoundingClientRect();
      const ch = r.width / 100;
      const lh = r.height / 100;
      probe.remove();
      for (const id of ['#load-btn', '#load-box']) {
        const host = document.querySelector(id);
        window.Webterm.setLoading(host, true);
        const h = host.getBoundingClientRect();
        const s = host.querySelector(':scope > .spin').getBoundingClientRect();
        const dx = s.x - h.x;
        const dy = s.y - h.y;
        const off = (v, u) => Math.min(((v % u) + u) % u, u - ((v % u) + u) % u);
        if (off(dx, ch) >= 0.5 || off(dy, lh) >= 0.5) out.push(`${id} at +${dx.toFixed(2)},+${dy.toFixed(2)}`);
        window.Webterm.setLoading(host, false);
      }
      return out;
    });
    assert.deepEqual(bad, []);
  });

  test('a loading box keeps its border and hides only its content', async () => {
    const result = await page.evaluate(() => {
      const box = document.querySelector('#load-box');
      window.Webterm.setLoading(box, true);
      const out = {
        edges: box.querySelectorAll(':scope > .box-edge').length,
        titles: box.querySelectorAll(':scope > .box-title').length,
        titleWrapped: !!box.querySelector('.loading-label > .box-title'),
        edgeWrapped: !!box.querySelector('.loading-label > .box-edge'),
        busy: box.getAttribute('aria-busy'),
      };
      window.Webterm.setLoading(box, false);
      return out;
    });
    assert.equal(result.edges, 1, 'the edge span was moved or lost');
    assert.equal(result.titles, 1);
    assert.equal(result.titleWrapped, false, 'the title must stay out of the hidden wrapper');
    assert.equal(result.edgeWrapped, false, 'the edge span must stay out of the hidden wrapper');
    assert.equal(result.busy, 'true');
  });

  test('a loading button cannot be pressed again', async () => {
    const result = await page.evaluate(() => {
      const btn = document.querySelector('#load-btn');
      window.Webterm.setLoading(btn, true);
      const during = btn.disabled;
      window.Webterm.setLoading(btn, false);
      return { during, after: btn.disabled };
    });
    assert.equal(result.during, true);
    assert.equal(result.after, false, 'the button stayed disabled');
  });

  test('setLoading is idempotent', async () => {
    const result = await page.evaluate(() => {
      const btn = document.querySelector('#load-btn');
      window.Webterm.setLoading(btn, true);
      window.Webterm.setLoading(btn, true);
      const nodes = btn.querySelectorAll(':scope > .spin, :scope > .loading-label').length;
      window.Webterm.setLoading(btn, false);
      window.Webterm.setLoading(btn, false);
      return { nodes, after: btn.querySelectorAll(':scope > .spin, :scope > .loading-label').length };
    });
    assert.equal(result.nodes, 2, 'a second setLoading(true) duplicated nodes');
    assert.equal(result.after, 0);
  });

  // §11.1: the loading state has a static form that needs no script.
  test('a hand-written loading element renders without the module', async () => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1280, height: 1024 },
      javaScriptEnabled: false,
    });
    const quiet = await ctx.newPage();
    await quiet.goto(`${server.origin}/test/behavior.html`);
    await quiet.waitForTimeout(200);
    const c = await cellSize(quiet);
    const result = await quiet.evaluate(() => {
      const el = document.querySelector('#load-static');
      const label = el.querySelector('.loading-label');
      const spin = el.querySelector('.spin');
      return {
        labelHidden: getComputedStyle(label).visibility,
        spin: spin.getBoundingClientRect(),
        host: el.getBoundingClientRect(),
      };
    });
    assert.equal(result.labelHidden, 'hidden');
    assert.ok(Math.abs(result.spin.width - c.ch) < TOL, `static spinner is ${result.spin.width}px`);
    assert.ok(offGrid(result.spin.x - result.host.x, c.ch) < TOL, 'static spinner is off the grid');
    await ctx.close();
  });
});

/* -------------------------------------------------- phase 2: placeholders */

// The claim a cell grid can make and a rem-based skeleton cannot: the
// placeholder occupies exactly the cells the real content will occupy, so the
// text resolves out of noise with no layout shift at any frame. Everything in
// this suite is that claim, taken apart.
describe('charsets', () => {
  const FONTS = ['font-jetbrains-mono', 'font-iosevka', 'font-dejavu-sans-mono'];

  test('the charsets are exposed and non-empty', async () => {
    const sets = await page.evaluate(() => Object.fromEntries(
      Object.entries(window.Webterm.CHARSETS).map(([k, v]) => [k, [...v].length]),
    ));
    for (const name of ['alnum', 'hex', 'binary', 'symbols', 'blocks', 'mixed']) {
      assert.ok(sets[name] >= 2, `charset ${name} has ${sets[name]} characters`);
    }
  });

  // Same rule as the spinner frames, and for the same reason: these are the
  // only ranges that land on a cell in all three bundled fonts. Katakana is
  // the obvious temptation for a scramble effect and is double-width.
  test('a charset uses only ascii and U+2500-259F', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const [name, chars] of Object.entries(window.Webterm.CHARSETS)) {
        for (const c of [...chars]) {
          const cp = c.codePointAt(0);
          const ok = (cp >= 0x20 && cp < 0x7f) || (cp >= 0x2500 && cp <= 0x259f);
          if (!ok) out.push(`${name}: ${c} U+${cp.toString(16).toUpperCase()}`);
        }
      }
      return out;
    });
    assert.deepEqual(bad, []);
  });

  test('a charset has no duplicate characters', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const [name, chars] of Object.entries(window.Webterm.CHARSETS)) {
        const seen = new Set();
        for (const c of [...chars]) {
          if (seen.has(c)) out.push(`${name}: ${c}`);
          seen.add(c);
        }
      }
      return out;
    });
    assert.deepEqual(bad, []);
  });

  for (const font of FONTS) {
    test(`every charset character is exactly one cell in ${font}`, async () => {
      const problems = await page.evaluate(async (f) => {
        const previous = document.documentElement.className;
        document.documentElement.className = f;
        await document.fonts.ready;

        const stick = document.createElement('div');
        stick.className = 'wt-probe';
        document.body.append(stick);
        const ch = stick.getBoundingClientRect().width / 100;
        stick.remove();

        const measure = document.createElement('span');
        measure.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        document.body.append(measure);
        const out = [];
        for (const [name, chars] of Object.entries(window.Webterm.CHARSETS)) {
          for (const c of [...chars]) {
            measure.textContent = c.repeat(20);
            const w = measure.getBoundingClientRect().width / 20;
            if (Math.abs(w - ch) > 0.02) {
              out.push(`${name}: ${c} is ${w.toFixed(3)}px in a ${ch.toFixed(3)}px cell`);
            }
          }
        }
        measure.remove();
        document.documentElement.className = previous;
        await document.fonts.ready;
        return out;
      }, font);
      assert.deepEqual(problems, []);
    });
  }
});

describe('placeholder text', () => {
  // The invariant. Width is sampled at frame 0, after every single tick, and
  // once resolved, across every charset and every resolution order.
  test('the cell width never changes, for any order or charset', async () => {
    const problems = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const orders = ['ltr', 'rtl', 'random', 'center', 'ends'];
      const charsets = Object.keys(window.Webterm.CHARSETS);
      const host = document.querySelector('#ph-lab');
      const out = [];
      clock.pause();
      for (const order of orders) {
        for (const charset of charsets) {
          const el = document.createElement('span');
          el.className = 'ph';
          el.textContent = 'alpha-7 bravo';
          el.setAttribute('data-wt-order', order);
          el.setAttribute('data-wt-charset', charset);
          host.append(el);
          const ph = window.Webterm.ph(el);
          ph.start();
          const widths = new Set([Math.round(el.getBoundingClientRect().width * 100)]);
          for (let i = 0; i < 60 && ph.live; i += 1) {
            clock.step();
            widths.add(Math.round(el.getBoundingClientRect().width * 100));
          }
          widths.add(Math.round(el.getBoundingClientRect().width * 100));
          if (widths.size !== 1) {
            out.push(`${order}/${charset}: ${[...widths].map((w) => w / 100).join(', ')}`);
          }
          el.remove();
        }
      }
      clock.resume();
      return out;
    });
    assert.deepEqual(problems, []);
  });

  test('the width is exactly the real text in cells', async () => {
    const result = await page.evaluate(() => {
      const host = document.querySelector('#ph-lab');
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = 'alpha-7';
      host.append(el);
      window.Webterm.motion.clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      const w = el.getBoundingClientRect().width;
      const cells = ph.cells;
      window.Webterm.motion.clock.drain();
      window.Webterm.motion.clock.resume();
      el.remove();
      return { w, cells, len: 'alpha-7'.length };
    });
    assert.equal(result.cells, result.len);
    assert.ok(Math.abs(result.w - result.len * cell.ch) < TOL, `${result.w}px for ${result.len} cells`);
  });

  test('every frame has exactly as many characters as the real text', async () => {
    const problems = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const real = 'charlie delta echo';
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = real;
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      const out = [];
      for (let i = 0; i < 80; i += 1) {
        const shown = ph.shown;
        if ([...shown].length !== [...real].length) {
          out.push(`tick ${i}: ${[...shown].length} characters, expected ${[...real].length} (${JSON.stringify(shown)})`);
        }
        if (!ph.live) break;
        clock.step();
      }
      clock.resume();
      el.remove();
      return out.slice(0, 5);
    });
    assert.deepEqual(problems, []);
  });

  test('it resolves to the real text, exactly, and leaves the DOM clean', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const real = 'alpha-7 ▓ bravo';
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = real;
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      const steps = clock.drain();
      clock.resume();
      const out = {
        real,
        text: el.textContent,
        steps,
        children: el.children.length,
        classes: el.className,
        jobs: clock.finiteJobs,
      };
      el.remove();
      return out;
    });
    assert.equal(result.text, result.real);
    assert.ok(result.steps > 1, 'it resolved without animating');
    assert.equal(result.children, 0, 'the scramble left its scaffolding behind');
    assert.equal(result.jobs, 0, 'the placeholder left a job on the clock');
  });

  // Piece by piece: a settled cell stays settled, and the count only grows.
  test('cells settle progressively and never unsettle', async () => {
    const problems = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      // Binary charset against letters-only text: a noise character can never
      // coincide with the real one, so "shows the real character" really does
      // mean settled.
      const real = 'alpha bravo charlie';
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = real;
      el.setAttribute('data-wt-order', 'ltr');
      el.setAttribute('data-wt-charset', 'binary');
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      const out = [];
      let previous = -1;
      let previousMask = null;
      for (let i = 0; i < 80; i += 1) {
        const settled = ph.settled;
        if (settled < previous) out.push(`tick ${i}: settled fell from ${previous} to ${settled}`);
        // ltr order: the settled prefix must match the real text and only grow.
        const shown = ph.shown;
        if (previousMask !== null) {
          for (let k = 0; k < previousMask.length; k += 1) {
            if (previousMask[k] === real[k] && shown[k] !== real[k]) {
              out.push(`tick ${i}: cell ${k} unsettled`);
            }
          }
        }
        previous = settled;
        previousMask = shown;
        if (!ph.live) break;
        clock.step();
      }
      if (previous !== [...real].length) out.push(`ended with ${previous} of ${[...real].length} settled`);
      clock.resume();
      el.remove();
      return out.slice(0, 5);
    });
    assert.deepEqual(problems, []);
  });

  test('ltr settles from the left and rtl from the right', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const out = {};
      clock.pause();
      for (const order of ['ltr', 'rtl']) {
        const el = document.createElement('span');
        el.className = 'ph';
        el.textContent = 'abcdefghijklmnop';
        el.setAttribute('data-wt-order', order);
        el.setAttribute('data-wt-charset', 'binary');
        host.append(el);
        const ph = window.Webterm.ph(el);
        ph.start();
        // Step until roughly half the cells have settled, then look at which.
        for (let i = 0; i < 40 && ph.settled < 8; i += 1) clock.step();
        out[order] = { shown: ph.shown, settled: ph.settled };
        el.remove();
      }
      clock.resume();
      return out;
    });
    // In ltr the first cell is real before the last; in rtl the reverse.
    assert.equal(result.ltr.shown[0], 'a', `ltr showed ${JSON.stringify(result.ltr.shown)}`);
    assert.equal(result.rtl.shown[15], 'p', `rtl showed ${JSON.stringify(result.rtl.shown)}`);
  });

  // Scrambling a space turns "alpha bravo" into one unreadable run and loses
  // the shape of the value, which is the thing the reader is waiting to see.
  test('whitespace is never scrambled', async () => {
    const problems = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const real = 'ab cd  ef';
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = real;
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      const out = [];
      for (let i = 0; i < 60; i += 1) {
        const shown = ph.shown;
        for (let k = 0; k < real.length; k += 1) {
          if (real[k] === ' ' && shown[k] !== ' ') out.push(`tick ${i}: cell ${k} is ${JSON.stringify(shown[k])}`);
        }
        if (!ph.live) break;
        clock.step();
      }
      clock.resume();
      el.remove();
      return out.slice(0, 5);
    });
    assert.deepEqual(problems, []);
  });

  test('the accessible name is the real text from the first frame', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const real = 'alpha-7';
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = real;
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      // What assistive technology is offered: every child that is not
      // aria-hidden, concatenated.
      const atText = () => [...el.childNodes]
        .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && n.getAttribute('aria-hidden') === 'true'))
        .map((n) => n.textContent)
        .join('');
      const atFirstFrame = atText();
      const maskHidden = el.querySelector('.ph-mask')?.getAttribute('aria-hidden');
      const realPresent = el.querySelector('.ph-real')?.textContent;
      clock.step(3);
      const midway = atText();
      clock.drain();
      clock.resume();
      el.remove();
      return { atFirstFrame, midway, maskHidden, realPresent, real };
    });
    assert.equal(result.maskHidden, 'true', 'the scrambling glyphs must be hidden from AT');
    assert.equal(result.realPresent, result.real, 'the real text must stay in the DOM for AT');
    assert.equal(result.atFirstFrame, result.real);
    assert.equal(result.midway, result.real);
  });

  // §11.2 rule 6: the final state, immediately, with nothing left scheduled.
  test('motion off resolves on frame 0', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      document.documentElement.dataset.wtMotion = 'off';
      const host = document.querySelector('#ph-lab');
      const real = 'alpha-7';
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = real;
      host.append(el);
      const ph = window.Webterm.ph(el);
      ph.start();
      const out = { text: el.textContent, live: ph.live, jobs: clock.finiteJobs, children: el.children.length };
      delete document.documentElement.dataset.wtMotion;
      el.remove();
      return out;
    });
    assert.equal(result.text, 'alpha-7');
    assert.equal(result.live, false);
    assert.equal(result.jobs, 0);
    assert.equal(result.children, 0);
  });

  test('hold scrambles until resolved, and resolve lands new text', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = '0.00';
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.hold();
      const w0 = el.getBoundingClientRect().width;
      clock.step(50);
      const heldText = ph.shown;
      const stillLive = ph.live;
      const wHeld = el.getBoundingClientRect().width;
      ph.resolve('3.91');
      clock.drain();
      const wEnd = el.getBoundingClientRect().width;
      clock.resume();
      const out = { w0, wHeld, wEnd, heldText, stillLive, text: el.textContent, jobs: clock.finiteJobs };
      el.remove();
      return out;
    });
    assert.equal(result.stillLive, true, 'hold() stopped on its own');
    assert.notEqual(result.heldText, '0.00', 'hold() is not scrambling');
    assert.equal(result.heldText.length, 4);
    assert.equal(result.text, '3.91');
    assert.equal(result.wHeld, result.w0, 'the width moved while holding');
    assert.equal(result.wEnd, result.w0, 'the width moved on resolve');
    assert.equal(result.jobs, 0);
  });

  test('resolving to longer text clips rather than reflowing', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = '0.00';
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.hold();
      const w0 = el.getBoundingClientRect().width;
      ph.resolve('a much longer value than four cells');
      clock.drain();
      const w1 = el.getBoundingClientRect().width;
      clock.resume();
      el.remove();
      return { w0, w1 };
    });
    assert.equal(result.w1, result.w0, 'long text reflowed the placeholder');
  });

  test('fail settles on an error marker', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = '0.00';
      host.append(el);
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.hold();
      ph.fail();
      clock.drain();
      clock.resume();
      const out = { text: el.textContent, failed: el.classList.contains('ph-failed'), jobs: clock.finiteJobs };
      el.remove();
      return out;
    });
    assert.match(result.text, /^\?+$/, `settled on ${JSON.stringify(result.text)}`);
    assert.equal(result.text.length, 4);
    assert.ok(result.failed, 'a failed placeholder needs a class to color');
    assert.equal(result.jobs, 0);
  });

  test('data-wt-ph mounts on init, and "hold" waits', async () => {
    const result = await page.evaluate(async () => {
      const auto = document.querySelector('#ph-auto');
      const held = document.querySelector('#ph-held');
      return {
        autoResolved: auto.textContent,
        autoMounted: !!window.Webterm.get('placeholder', auto),
        heldMounted: !!window.Webterm.get('placeholder', held),
        heldLive: window.Webterm.get('placeholder', held)?.live,
      };
    });
    assert.equal(result.autoMounted, true, 'init did not mount data-wt-ph');
    assert.equal(result.heldMounted, true);
    assert.equal(result.heldLive, true, 'data-wt-ph="hold" should keep scrambling');
  });

  test('a resolved placeholder fires wt:ph:resolved once', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const host = document.querySelector('#ph-lab');
      const el = document.createElement('span');
      el.className = 'ph';
      el.textContent = 'alpha';
      host.append(el);
      const seen = [];
      el.addEventListener('wt:ph:resolved', (e) => seen.push(e.detail.text));
      clock.pause();
      window.Webterm.ph(el).start();
      clock.drain();
      clock.resume();
      el.remove();
      return seen;
    });
    assert.deepEqual(result, ['alpha']);
  });
});

describe('placeholder area', () => {
  test('an area is exactly --cells by --rows', async () => {
    const found = await page.evaluate(() => [...document.querySelectorAll('.ph-area')].map((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        cells: Number(s.getPropertyValue('--cells')),
        rows: Number(s.getPropertyValue('--rows')),
        w: r.width,
        h: r.height,
      };
    }));
    assert.ok(found.length > 0, 'no .ph-area on the page');
    for (const a of found) {
      assert.ok(Math.abs(a.w - a.cells * cell.ch) < TOL, `area is ${a.w}px, expected ${a.cells} cells`);
      assert.ok(Math.abs(a.h - a.rows * cell.lh) < TOL, `area is ${a.h}px, expected ${a.rows} rows`);
    }
  });

  test('the noise mask is exactly --rows lines of --cells characters', async () => {
    const problems = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const el = document.querySelector('#ph-area-demo');
      const s = getComputedStyle(el);
      const cells = Number(s.getPropertyValue('--cells'));
      const rows = Number(s.getPropertyValue('--rows'));
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.hold();
      const out = [];
      for (let i = 0; i < 20; i += 1) {
        const lines = ph.shown.split('\n');
        if (lines.length !== rows) out.push(`tick ${i}: ${lines.length} lines, expected ${rows}`);
        for (const [k, line] of lines.entries()) {
          if ([...line].length !== cells) out.push(`tick ${i} line ${k}: ${[...line].length} characters, expected ${cells}`);
        }
        clock.step();
      }
      ph.resolve();
      clock.drain();
      clock.resume();
      return out.slice(0, 5);
    });
    assert.deepEqual(problems, []);
  });

  // An area's mask is opaque, so a settled cell cannot erode to a blank — it
  // would reveal the background, not the content. It takes the character that
  // belongs to that cell, exactly as a text placeholder does, which is only
  // possible because the content is already on the grid.
  test('an area settles onto its real content, then removes its mask', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const el = document.querySelector('#ph-area-demo');
      clock.pause();
      const ph = window.Webterm.ph(el);
      ph.start();
      const real = ph.real;
      const atStart = [...ph.shown].filter((c) => c !== ' ' && c !== '\n').length;
      // Part-way through, every settled cell must already read correctly.
      for (let i = 0; i < 6; i += 1) clock.step();
      const mid = ph.shown;
      const settledWrong = [...mid].filter((c, i) => c !== real[i] && c === ' ').length;
      const settledRight = [...mid].filter((c, i) => c === real[i] && c !== ' ' && c !== '\n').length;
      clock.drain();
      const masks = el.querySelectorAll('.ph-mask').length;
      clock.resume();
      return { atStart, settledWrong, settledRight, masks, content: el.textContent.includes('alpha') };
    });
    assert.ok(result.atStart > 0, 'the area started with no noise');
    assert.equal(result.settledWrong, 0, 'a cell blanked instead of settling on its character');
    assert.ok(result.settledRight > 0, 'no cell had settled part-way through');
    assert.equal(result.masks, 0, 'the mask outlived the animation');
    assert.ok(result.content, 'the real content did not come back');
  });

  test('an unmounted area shows a flat skeleton with no script', async () => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1280, height: 1024 },
      javaScriptEnabled: false,
    });
    const quiet = await ctx.newPage();
    await quiet.goto(`${server.origin}/test/behavior.html`);
    await quiet.waitForTimeout(200);
    const c = await cellSize(quiet);
    const result = await quiet.evaluate(() => {
      const el = document.querySelector('#ph-area-demo');
      const mask = el.querySelector('.ph-mask');
      return {
        r: el.getBoundingClientRect(),
        maskContent: getComputedStyle(mask, '::before').content.slice(0, 4),
        maskEmpty: mask.textContent === '',
      };
    });
    assert.ok(result.maskEmpty, 'the static mask should hold no text');
    assert.match(result.maskContent, /[░▒▓]/, `static skeleton paints ${JSON.stringify(result.maskContent)}`);
    assert.ok(offGrid(result.r.width, c.ch) < TOL, 'the static area is off the grid');
    await ctx.close();
  });
});

/* -------------------------------------------------------- phase 3: toasts */

// §11.1: a toast rendered by the server is adopted, not rebuilt. This runs
// before any suite that clears the stacks, because adoption is a fact about
// the page as it loaded.
describe('toast adoption', () => {
  test('a toast in the initial HTML is adopted with the same lifecycle', async () => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('#toast-static');
      const instance = window.Webterm.get('toast', el);
      const out = {
        mounted: !!instance,
        hasButton: !!el.querySelector('[data-wt-dismiss="toast"]'),
        edges: el.querySelectorAll(':scope > .box-edge').length,
      };
      return out;
    });
    assert.equal(result.mounted, true, 'init did not adopt the server-rendered toast');
    assert.equal(result.edges, 1);
  });

  // init() is documented as safe to repeat, and a page that inserts markup
  // will call it again. Anything the layer constructed directly has to be in
  // the registry, or the second init() mounts a second instance on it: two
  // close listeners on a dialog means two scroll unlocks for one close.
  test('re-running init does not mount a second instance on live components', async () => {
    const result = await page.evaluate(() => {
      const t = window.Webterm.toast('mounted once', { timeout: 0 });
      const before = window.Webterm.get('toast', t.el);
      window.Webterm.init();
      const after = window.Webterm.get('toast', t.el);
      const stacked = document.querySelectorAll('.toast-stack-br > .toast').length;
      window.Webterm.clearToasts();
      return { registered: before !== null, same: before === after, stacked };
    });
    assert.ok(result.registered, 'toast() did not register its instance');
    assert.ok(result.same, 'init() replaced the instance on a live toast');
    assert.equal(result.stacked, 1);
  });
});

describe('toast stack', () => {
  before(async () => {
    await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      clock.pause();
      clock.drain();
      window.Webterm.clearToasts();
    });
  });

  after(async () => {
    await page.evaluate(() => {
      window.Webterm.clearToasts();
      window.Webterm.motion.clock.resume();
    });
  });

  test('a stack sits on the grid in every corner', async () => {
    const problems = await page.evaluate(() => {
      const out = [];
      const probe = document.createElement('div');
      probe.className = 'wt-probe';
      document.body.append(probe);
      const r = probe.getBoundingClientRect();
      const ch = r.width / 100;
      const lh = r.height / 100;
      probe.remove();
      const off = (v, u) => Math.min(((v % u) + u) % u, u - ((v % u) + u) % u);
      for (const pos of ['tl', 'tr', 'bl', 'br']) {
        const t = window.Webterm.toast('corner ' + pos, { stack: pos, timeout: 0 });
        const stack = t.el.closest('.toast-stack');
        const s = stack.getBoundingClientRect();
        const b = t.el.getBoundingClientRect();
        if (off(b.width, ch) >= 0.5) out.push(`${pos}: toast is ${b.width}px wide`);
        if (off(b.height, lh) >= 0.5) out.push(`${pos}: toast is ${b.height}px tall`);
        if (off(s.width, ch) >= 0.5) out.push(`${pos}: stack is ${s.width}px wide`);
        if (off(b.x - s.x, ch) >= 0.5 || off(b.y - s.y, lh) >= 0.5) {
          out.push(`${pos}: toast at +${(b.x - s.x).toFixed(2)},+${(b.y - s.y).toFixed(2)} in its stack`);
        }
      }
      window.Webterm.clearToasts();
      return out;
    });
    assert.deepEqual(problems, []);
  });

  test('toasts stack with a one-row gap, every edge on a row', async () => {
    const result = await page.evaluate(() => {
      for (let i = 0; i < 3; i += 1) window.Webterm.toast(`message ${i}`, { timeout: 0 });
      const boxes = [...document.querySelectorAll('.toast-stack-br > .toast')]
        .map((el) => el.getBoundingClientRect())
        .sort((a, b) => a.y - b.y);
      const gaps = [];
      for (let i = 1; i < boxes.length; i += 1) gaps.push(boxes[i].y - boxes[i - 1].bottom);
      const out = { count: boxes.length, gaps };
      window.Webterm.clearToasts();
      return out;
    });
    assert.equal(result.count, 3);
    for (const gap of result.gaps) {
      assert.ok(Math.abs(gap - cell.lh) < TOL, `gap of ${gap}px, expected one row (${cell.lh}px)`);
    }
  });

  test('a bottom stack clears the fixed status bar', async () => {
    const result = await page.evaluate(() => {
      const t = window.Webterm.toast('clearance', { stack: 'br', timeout: 0 });
      const toast = t.el.getBoundingClientRect();
      const bar = document.querySelector('.statusbar-fixed').getBoundingClientRect();
      window.Webterm.clearToasts();
      return { toastBottom: toast.bottom, barTop: bar.top };
    });
    assert.ok(result.toastBottom <= result.barTop,
      `toast bottom ${result.toastBottom} overlaps the status bar at ${result.barTop}`);
  });

  test('a toast is as wide as --cells, clamped to the screen', async () => {
    const result = await page.evaluate(() => {
      const narrow = window.Webterm.toast('narrow', { cells: 24, timeout: 0 });
      const wide = window.Webterm.toast('wide', { cells: 10000, timeout: 0 });
      const out = {
        narrow: narrow.el.getBoundingClientRect().width,
        narrowCells: Number(getComputedStyle(narrow.el).getPropertyValue('--cells')),
        wideCells: Number(getComputedStyle(wide.el).getPropertyValue('--cells')),
        screen: window.Webterm.cells.screenCols(),
      };
      window.Webterm.clearToasts();
      return out;
    });
    assert.equal(result.narrowCells, 24);
    assert.ok(Math.abs(result.narrow - 24 * cell.ch) < TOL, `narrow toast is ${result.narrow}px`);
    assert.ok(result.wideCells <= result.screen, `a toast of ${result.wideCells} cells on a ${result.screen}-column screen`);
  });

  // The same pixel sweep a hand-written box gets. A toast is assembled by
  // createBox, and the point of createBox is that there is no difference.
  test('a toast draws four corners and continuous edges', async () => {
    await page.evaluate(() => {
      window.Webterm.toast('Replica charlie is behind the primary.', { level: 'warn', timeout: 0 });
      window.Webterm.motion.clock.drain();
    });
    // Only the status bar: the toast itself is the subject here.
    await hideFixed(page, '.statusbar-fixed');
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    await showFixed(page);
    const png = borders.readShot(shot);
    // A toast is fixed, so its client rect is already viewport-relative and
    // the screenshot is of the viewport: no scroll offset to add.
    const boxes = await borders.boxGeometry(page, '.toast', { fixed: true });
    assert.ok(boxes.length > 0, 'no toast on screen');
    assert.deepEqual(borders.missingCorners(png, boxes, cell), []);
    assert.deepEqual(borders.brokenEdges(png, boxes, cell), []);
    await page.evaluate(() => window.Webterm.clearToasts());
  });
});

describe('toast lifecycle', () => {
  before(async () => {
    await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      clock.pause();
      clock.drain();
      window.Webterm.clearToasts();
    });
  });

  after(async () => {
    await page.evaluate(() => {
      window.Webterm.clearToasts();
      window.Webterm.motion.clock.resume();
    });
  });

  test('a toast dismisses itself when its time is up', async () => {
    const result = await page.evaluate(() => {
      const { clock, tickMs } = window.Webterm.motion;
      const timeout = tickMs() * 10;
      const t = window.Webterm.toast('timed', { timeout });
      const present = () => document.body.contains(t.el);
      const atStart = present();
      clock.step(5);
      const halfway = present();
      clock.step(20);
      const after = present();
      window.Webterm.clearToasts();
      return { atStart, halfway, after, jobs: clock.finiteJobs };
    });
    assert.equal(result.atStart, true);
    assert.equal(result.halfway, true, 'the toast left before its time was up');
    assert.equal(result.after, false, 'the toast outstayed its timeout');
    assert.equal(result.jobs, 0, 'the toast left a job on the clock');
  });

  // The dismiss timeout is how long the reader has to read it, not decoration.
  // Routing it through animate() would dismiss every toast in the frame it
  // appeared for a reader who asked for reduced motion.
  test('reduced motion does not collapse the timeout', async () => {
    const result = await page.evaluate(() => {
      const { clock, tickMs } = window.Webterm.motion;
      document.documentElement.dataset.wtMotion = 'off';
      const t = window.Webterm.toast('still readable', { timeout: tickMs() * 10 });
      const atStart = document.body.contains(t.el);
      const typed = t.el.querySelector('.toast-rest') === null;
      clock.step(3);
      const during = document.body.contains(t.el);
      clock.step(20);
      const after = document.body.contains(t.el);
      delete document.documentElement.dataset.wtMotion;
      window.Webterm.clearToasts();
      return { atStart, during, after, typed };
    });
    assert.equal(result.atStart, true);
    assert.equal(result.during, true, 'reduced motion dismissed the toast immediately');
    assert.equal(result.after, false, 'the toast never dismissed');
    assert.equal(result.typed, true, 'reduced motion should show the whole message at once');
  });

  test('timeout 0 keeps a toast until it is dismissed', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const t = window.Webterm.toast('sticky', { timeout: 0 });
      clock.step(200);
      const stillThere = document.body.contains(t.el);
      t.hide();
      const gone = !document.body.contains(t.el);
      window.Webterm.clearToasts();
      return { stillThere, gone };
    });
    assert.equal(result.stillThere, true);
    assert.equal(result.gone, true);
  });

  test('the close button dismisses it', async () => {
    const result = await page.evaluate(() => {
      const t = window.Webterm.toast('closeable', { timeout: 0 });
      const btn = t.el.querySelector('[data-wt-dismiss="toast"]');
      btn.click();
      const out = { hadButton: !!btn, gone: !document.body.contains(t.el) };
      window.Webterm.clearToasts();
      return out;
    });
    assert.equal(result.hadButton, true, 'a toast needs a way to dismiss it');
    assert.equal(result.gone, true);
  });

  test('hovering holds the timer, leaving releases it', async () => {
    const result = await page.evaluate(() => {
      const { clock, tickMs } = window.Webterm.motion;
      const t = window.Webterm.toast('hover me', { timeout: tickMs() * 10 });
      t.el.dispatchEvent(new MouseEvent('mouseenter'));
      clock.step(40);
      const survivedHover = document.body.contains(t.el);
      t.el.dispatchEvent(new MouseEvent('mouseleave'));
      clock.step(40);
      const goneAfter = !document.body.contains(t.el);
      window.Webterm.clearToasts();
      return { survivedHover, goneAfter };
    });
    assert.equal(result.survivedHover, true, 'the toast timed out while hovered');
    assert.equal(result.goneAfter, true, 'the timer never resumed');
  });

  test('the timer erodes the bottom border in whole cells', async () => {
    const result = await page.evaluate(() => {
      const { clock, tickMs } = window.Webterm.motion;
      const t = window.Webterm.toast('counting down', { cells: 24, timeout: tickMs() * 12 });
      const timer = t.el.querySelector('.toast-timer');
      const read = () => Number(getComputedStyle(timer).getPropertyValue('--wt-timer-cells'));
      const widths = [];
      const seen = [read()];
      for (let i = 0; i < 12; i += 1) {
        clock.step();
        if (!document.body.contains(t.el)) break;
        seen.push(read());
        widths.push(timer.getBoundingClientRect().width);
      }
      window.Webterm.clearToasts();
      return { seen, widths, hadTimer: !!timer };
    });
    assert.equal(result.hadTimer, true, 'no timer element on the toast');
    assert.equal(result.seen[0], 0, 'the timer starts with the border whole');
    for (const [i, v] of result.seen.entries()) {
      assert.ok(Number.isInteger(v), `tick ${i}: ${v} cells`);
      if (i > 0) assert.ok(v >= result.seen[i - 1], `tick ${i}: the timer went backwards`);
    }
    assert.ok(result.seen.at(-1) > 0, 'the border never eroded');
    for (const w of result.widths) {
      assert.ok(offGrid(w, cell.ch) < TOL, `timer is ${w}px, off the grid`);
    }
  });
});

describe('toast typing', () => {
  before(async () => {
    await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      clock.pause();
      clock.drain();
      window.Webterm.clearToasts();
    });
  });

  after(async () => {
    await page.evaluate(() => {
      window.Webterm.clearToasts();
      window.Webterm.motion.clock.resume();
    });
  });

  // The message types in, and the box does not move while it does. The trick
  // is that the unrevealed tail is still laid out — `visibility: hidden`, not
  // absent — so the glyph sequence and therefore the wrapping never change.
  test('typing never changes the toast geometry', async () => {
    const problems = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const t = window.Webterm.toast(
        'Replica charlie is behind the primary by four hundred and twelve segments.',
        { cells: 32, timeout: 0 },
      );
      const sizes = new Set();
      const record = () => {
        const r = t.el.getBoundingClientRect();
        sizes.add(`${Math.round(r.width * 100)}x${Math.round(r.height * 100)}`);
      };
      record();
      for (let i = 0; i < 60; i += 1) {
        clock.step();
        record();
      }
      const out = { sizes: [...sizes], text: t.el.querySelector('.toast-body').textContent };
      window.Webterm.clearToasts();
      return out;
    });
    assert.equal(problems.sizes.length, 1, `the toast changed size while typing: ${problems.sizes.join(' ')}`);
    assert.match(problems.text, /^Replica charlie is behind the primary by four hundred and twelve segments\.$/);
  });

  test('the revealed text grows and ends up whole', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const message = 'alpha bravo charlie delta';
      const t = window.Webterm.toast(message, { cells: 32, timeout: 0 });
      const shown = () => t.el.querySelector('.toast-shown')?.textContent ?? t.el.querySelector('.toast-body').textContent;
      const lengths = [shown().length];
      for (let i = 0; i < 40; i += 1) {
        clock.step();
        lengths.push(shown().length);
      }
      const out = { lengths, final: shown(), message, rest: t.el.querySelector('.toast-rest') };
      window.Webterm.clearToasts();
      return { ...out, rest: out.rest === null };
    });
    for (let i = 1; i < result.lengths.length; i += 1) {
      assert.ok(result.lengths[i] >= result.lengths[i - 1], `the reveal went backwards at ${i}`);
    }
    assert.equal(result.final, result.message);
    assert.equal(result.rest, true, 'the hidden tail outlived the reveal');
  });
});

describe('toast queue and events', () => {
  before(async () => {
    await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      clock.pause();
      clock.drain();
      window.Webterm.clearToasts();
    });
  });

  after(async () => {
    await page.evaluate(() => {
      window.Webterm.clearToasts();
      window.Webterm.motion.clock.resume();
    });
  });

  test('no more than toastMax are visible, and the rest queue', async () => {
    const result = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      window.Webterm.config.toastMax = 3;
      const made = [];
      for (let i = 0; i < 7; i += 1) made.push(window.Webterm.toast(`queued ${i}`, { timeout: 60 * 4 }));
      const visible = () => document.querySelectorAll('.toast-stack-br > .toast').length;
      const atOnce = visible();
      clock.step(10);
      const afterSome = visible();
      clock.step(200);
      const atEnd = visible();
      const out = { atOnce, afterSome, atEnd, queued: window.Webterm.toastQueue() };
      window.Webterm.clearToasts();
      window.Webterm.config.toastMax = 4;
      return out;
    });
    assert.equal(result.atOnce, 3, `${result.atOnce} toasts visible with toastMax 3`);
    assert.ok(result.afterSome <= 3);
    assert.equal(result.atEnd, 0, 'the queue never drained');
    assert.equal(result.queued, 0);
  });

  test('a repeated message counts instead of stacking', async () => {
    const result = await page.evaluate(() => {
      const a = window.Webterm.toast('disk is full', { timeout: 0 });
      window.Webterm.toast('disk is full', { timeout: 0 });
      window.Webterm.toast('disk is full', { timeout: 0 });
      const count = document.querySelectorAll('.toast-stack-br > .toast').length;
      const title = a.el.querySelector('.box-title').textContent;
      window.Webterm.clearToasts();
      return { count, title };
    });
    assert.equal(result.count, 1, 'a repeated message made a new toast');
    assert.match(result.title, /×3/, `title reads ${JSON.stringify(result.title)}`);
  });

  test('a different message does not merge', async () => {
    const result = await page.evaluate(() => {
      window.Webterm.toast('disk is full', { timeout: 0 });
      window.Webterm.toast('disk is fine', { timeout: 0 });
      const count = document.querySelectorAll('.toast-stack-br > .toast').length;
      window.Webterm.clearToasts();
      return count;
    });
    assert.equal(result, 2);
  });

  test('the four lifecycle events fire in order', async () => {
    const seen = await page.evaluate(() => {
      const { clock } = window.Webterm.motion;
      const log = [];
      const types = ['wt:toast:show', 'wt:toast:shown', 'wt:toast:hide', 'wt:toast:hidden'];
      const handler = (e) => log.push(e.type);
      for (const t of types) document.addEventListener(t, handler);
      const t = window.Webterm.toast('eventful', { timeout: 60 * 3 });
      clock.step(60);
      for (const ty of types) document.removeEventListener(ty, handler);
      window.Webterm.clearToasts();
      return log;
    });
    assert.deepEqual(seen, ['wt:toast:show', 'wt:toast:shown', 'wt:toast:hide', 'wt:toast:hidden']);
  });

  test('preventing wt:toast:show stops it appearing', async () => {
    const result = await page.evaluate(() => {
      const block = (e) => e.preventDefault();
      document.addEventListener('wt:toast:show', block);
      const t = window.Webterm.toast('never seen', { timeout: 0 });
      document.removeEventListener('wt:toast:show', block);
      const out = {
        visible: document.querySelectorAll('.toast-stack-br > .toast').length,
        returned: t === null,
      };
      window.Webterm.clearToasts();
      return out;
    });
    assert.equal(result.visible, 0, 'a prevented toast appeared anyway');
    assert.equal(result.returned, true, 'toast() should report that it did not show');
  });

  test('preventing wt:toast:hide keeps it', async () => {
    const result = await page.evaluate(() => {
      const block = (e) => e.preventDefault();
      const t = window.Webterm.toast('stubborn', { timeout: 0 });
      document.addEventListener('wt:toast:hide', block);
      t.hide();
      const held = document.body.contains(t.el);
      document.removeEventListener('wt:toast:hide', block);
      t.hide();
      const gone = !document.body.contains(t.el);
      window.Webterm.clearToasts();
      return { held, gone };
    });
    assert.equal(result.held, true);
    assert.equal(result.gone, true);
  });

  test('a stack is a live region, and an error announces itself', async () => {
    const result = await page.evaluate(() => {
      const info = window.Webterm.toast('fyi', { level: 'info', timeout: 0 });
      const err = window.Webterm.toast('it broke', { level: 'error', timeout: 0 });
      const stack = info.el.closest('.toast-stack');
      const out = {
        live: stack.getAttribute('aria-live'),
        role: stack.getAttribute('role'),
        infoRole: info.el.getAttribute('role'),
        errRole: err.el.getAttribute('role'),
        errClass: err.el.className,
      };
      window.Webterm.clearToasts();
      return out;
    });
    assert.equal(result.live, 'polite');
    assert.equal(result.role, 'status');
    assert.equal(result.errRole, 'alert', 'an error toast must interrupt');
    assert.match(result.errClass, /toast-error/);
  });
});

/* -------------------------------------------------------- phase 4: modals */

describe('modal', () => {
  const close = async () => page.evaluate(() => {
    for (const d of document.querySelectorAll('dialog.modal')) if (d.open) d.close();
  });

  after(close);

  test('the data API opens and closes it', async () => {
    await page.click('[data-wt-toggle="modal"][data-wt-target="#modal-demo"]');
    const opened = await page.$eval('#modal-demo', (el) => el.open);
    await page.click('#modal-demo [data-wt-dismiss="modal"]');
    const closed = await page.$eval('#modal-demo', (el) => !el.open);
    assert.ok(opened, 'data-wt-toggle did not open the dialog');
    assert.ok(closed, 'data-wt-dismiss did not close it');
  });

  test('Escape closes it', async () => {
    await page.click('[data-wt-toggle="modal"][data-wt-target="#modal-demo"]');
    await page.keyboard.press('Escape');
    const open = await page.$eval('#modal-demo', (el) => el.open);
    assert.equal(open, false);
  });

  test('focus starts inside and returns to the opener', async () => {
    const opener = '[data-wt-toggle="modal"][data-wt-target="#modal-demo"]';
    await page.focus(opener);
    await page.click(opener);
    const inside = await page.evaluate(() => document.querySelector('#modal-demo').contains(document.activeElement));
    await page.keyboard.press('Escape');
    const returned = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), opener);
    assert.ok(inside, 'focus stayed outside the dialog');
    assert.ok(returned, 'focus did not come back to the opener');
  });

  // §11.3, the hazard this framework has and others do not.
  test('opening a modal does not change the column count', async () => {
    const before = await screenColumns(page, cell);
    await page.click('[data-wt-toggle="modal"][data-wt-target="#modal-demo"]');
    const during = await screenColumns(page, cell);
    const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
    await close();
    const after = await screenColumns(page, cell);
    assert.match(locked, /hidden/, 'the page was not scroll-locked');
    assert.equal(during, before, 'the page reflowed by a column behind the dialog');
    assert.equal(after, before);
  });

  test('a dialog is a whole number of cells, on a cell and on a row', async () => {
    await page.click('[data-wt-toggle="modal"][data-wt-target="#modal-demo"]');
    const r = await page.$eval('#modal-demo', (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, cells: Number(getComputedStyle(el).getPropertyValue('--cells')) };
    });
    await close();
    assert.ok(Math.abs(r.w - r.cells * cell.ch) < TOL, `dialog is ${r.w}px, expected ${r.cells} cells`);
    assert.ok(offGrid(r.h, cell.lh) < TOL, `dialog is ${r.h}px tall, ${(r.h / cell.lh).toFixed(3)} rows`);
    assert.ok(offGrid(r.x, cell.ch) < TOL, `dialog starts at x=${r.x}, off the grid`);
    assert.ok(offGrid(r.y, cell.lh) < TOL, `dialog starts at y=${r.y}, off a row`);
  });

  test('a dialog wider than the screen is clamped to it', async () => {
    const r = await page.evaluate(() => {
      const el = document.querySelector('#modal-demo');
      el.style.setProperty('--cells', '10000');
      el.showModal();
      const b = el.getBoundingClientRect();
      el.close();
      el.style.removeProperty('--cells');
      return { w: b.width, viewport: document.documentElement.clientWidth };
    });
    assert.ok(r.w <= r.viewport, `dialog is ${r.w}px in a ${r.viewport}px viewport`);
    assert.ok(offGrid(r.w, cell.ch) < TOL, `clamped dialog is ${r.w}px, off the grid`);
  });

  test('a dialog draws four corners and continuous edges', async () => {
    await page.click('[data-wt-toggle="modal"][data-wt-target="#modal-demo"]');
    await hideFixed(page, '.statusbar-fixed');
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    await showFixed(page);
    const png = borders.readShot(shot);
    const boxes = await borders.boxGeometry(page, '#modal-demo', { fixed: true });
    await close();
    assert.equal(boxes.length, 1);
    assert.deepEqual(borders.missingCorners(png, boxes, cell), []);
    assert.deepEqual(borders.brokenEdges(png, boxes, cell), []);
  });

  // The shade cannot be ::backdrop — that takes no generated content — so it
  // is a fixed child of the dialog, which is in the top layer with it.
  test('the backdrop is a glyph shade covering the viewport', async () => {
    await page.click('[data-wt-toggle="modal"][data-wt-target="#modal-demo"]');
    const r = await page.evaluate(() => {
      const shade = document.querySelector('#modal-demo > .backdrop');
      if (!shade) return null;
      const b = shade.getBoundingClientRect();
      // Measure against a stretched fixed element, not the viewport: a fixed
      // containing block excludes the scrollbar gutter.
      const ref = document.createElement('div');
      ref.style.cssText = 'position:fixed;top:0;bottom:0;left:0;right:0;visibility:hidden';
      document.body.append(ref);
      const a = ref.getBoundingClientRect();
      ref.remove();
      return {
        w: b.width,
        h: b.height,
        content: getComputedStyle(shade, '::before').content.slice(0, 4),
        position: getComputedStyle(shade).position,
        vw: a.width,
        vh: a.height,
      };
    });
    // Closing the element directly, as Escape does, leaves the cleanup to the
    // dialog's own close event — which is asynchronous.
    const gone = await page.evaluate(async () => {
      document.querySelector('#modal-demo').close();
      await new Promise((r) => setTimeout(r, 0));
      return document.querySelector('#modal-demo > .backdrop') === null;
    });
    assert.ok(r, 'the dialog has no backdrop element');
    assert.equal(r.position, 'fixed');
    assert.match(r.content, /[░▒▓]/, `backdrop paints ${JSON.stringify(r.content)}`);
    assert.ok(r.vw - r.w < cell.ch, `backdrop is ${r.w}px of a ${r.vw}px viewport`);
    assert.ok(r.vh - r.h < cell.lh, `backdrop is ${r.h}px of a ${r.vh}px viewport`);
    assert.ok(gone, 'the backdrop outlived the dialog');
  });

  test('clicking the backdrop closes it, unless it is static', async () => {
    const result = await page.evaluate(async () => {
      const plain = document.querySelector('#modal-demo');
      const stuck = document.querySelector('#modal-static');
      const clickOutside = (el) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', {
          bubbles: true, clientX: Math.max(0, r.left - 20), clientY: Math.max(0, r.top - 20),
        }));
      };
      plain.showModal();
      clickOutside(plain);
      const plainClosed = !plain.open;
      if (plain.open) plain.close();

      stuck.showModal();
      clickOutside(stuck);
      const staticStillOpen = stuck.open;
      stuck.close();
      return { plainClosed, staticStillOpen };
    });
    assert.equal(result.plainClosed, true, 'a backdrop click should dismiss an ordinary dialog');
    assert.equal(result.staticStillOpen, true, 'data-wt-static must refuse a backdrop click');
  });

  test('the four lifecycle events fire in order and show is cancelable', async () => {
    const seen = await page.evaluate(async () => {
      const el = document.querySelector('#modal-demo');
      const log = [];
      const types = ['wt:modal:show', 'wt:modal:shown', 'wt:modal:hide', 'wt:modal:hidden'];
      const handler = (e) => log.push(e.type);
      for (const t of types) el.addEventListener(t, handler);
      const modal = window.Webterm.getOrCreate('modal', el);
      modal.show();
      modal.hide();
      for (const t of types) el.removeEventListener(t, handler);

      const block = (e) => e.preventDefault();
      el.addEventListener('wt:modal:show', block);
      modal.show();
      const blocked = el.open;
      el.removeEventListener('wt:modal:show', block);
      if (el.open) el.close();
      return { log, blocked };
    });
    assert.deepEqual(seen.log, ['wt:modal:show', 'wt:modal:shown', 'wt:modal:hide', 'wt:modal:hidden']);
    assert.equal(seen.blocked, false, 'a prevented show opened the dialog anyway');
  });

  test('nested dialogs each hold their own scroll lock', async () => {
    const result = await page.evaluate(() => {
      const a = window.Webterm.getOrCreate('modal', document.querySelector('#modal-demo'));
      const b = window.Webterm.getOrCreate('modal', document.querySelector('#modal-static'));
      a.show();
      b.show();
      const both = window.Webterm.scrollLocks();
      b.hide();
      const afterInner = getComputedStyle(document.documentElement).overflow;
      a.hide();
      const afterOuter = getComputedStyle(document.documentElement).overflow;
      return { both, afterInner, afterOuter, locks: window.Webterm.scrollLocks() };
    });
    assert.equal(result.both, 2);
    assert.match(result.afterInner, /hidden/, 'closing the inner dialog unlocked the page under the outer one');
    assert.ok(!/hidden/.test(result.afterOuter), 'the lock never released');
    assert.equal(result.locks, 0);
  });

  test('confirm resolves true for yes and false for cancel', async () => {
    const yes = await page.evaluate(async () => {
      const answer = window.Webterm.confirm('Drop replica charlie?');
      await new Promise((r) => setTimeout(r, 0));
      document.querySelector('dialog.modal[open] [value="yes"]').click();
      return answer;
    });
    const no = await page.evaluate(async () => {
      const answer = window.Webterm.confirm('Drop replica charlie?');
      await new Promise((r) => setTimeout(r, 0));
      document.querySelector('dialog.modal[open] [value="no"]').click();
      return answer;
    });
    const escaped = await page.evaluate(async () => {
      const answer = window.Webterm.confirm('Drop replica charlie?');
      await new Promise((r) => setTimeout(r, 0));
      document.querySelector('dialog.modal[open]').close();
      return answer;
    });
    assert.equal(yes, true);
    assert.equal(no, false);
    assert.equal(escaped, false, 'a dismissed confirm must not read as yes');
  });

  test('confirm cleans up after itself', async () => {
    const left = await page.evaluate(async () => {
      const before = document.querySelectorAll('dialog.modal').length;
      const answer = window.Webterm.confirm('tidy?');
      await new Promise((r) => setTimeout(r, 0));
      document.querySelector('dialog.modal[open] [value="no"]').click();
      await answer;
      return document.querySelectorAll('dialog.modal').length - before;
    });
    assert.equal(left, 0, 'confirm left its dialog in the document');
  });

  test('prompt resolves the value, or null when dismissed', async () => {
    const value = await page.evaluate(async () => {
      const answer = window.Webterm.prompt({ label: 'host', value: 'alpha' });
      await new Promise((r) => setTimeout(r, 0));
      const dialog = document.querySelector('dialog.modal[open]');
      dialog.querySelector('.field').value = 'charlie';
      dialog.querySelector('[value="ok"]').click();
      return answer;
    });
    const dismissed = await page.evaluate(async () => {
      const answer = window.Webterm.prompt({ label: 'host' });
      await new Promise((r) => setTimeout(r, 0));
      document.querySelector('dialog.modal[open] [value="cancel"]').click();
      return answer;
    });
    assert.equal(value, 'charlie');
    assert.equal(dismissed, null);
  });

  // §11.1: the static form renders with no script at all.
  test('a dialog with [open] renders on the grid without the module', async () => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1280, height: 1024 },
      javaScriptEnabled: false,
    });
    const quiet = await ctx.newPage();
    await quiet.goto(`${server.origin}/test/behavior.html`);
    await quiet.waitForTimeout(200);
    const c = await cellSize(quiet);
    const r = await quiet.evaluate(() => {
      const el = document.querySelector('#modal-open');
      const b = el.getBoundingClientRect();
      const screen = document.querySelector('.screen').getBoundingClientRect();
      return { dx: b.x - screen.x, w: b.width, h: b.height, open: el.open };
    });
    assert.equal(r.open, true, 'the fixture is not open');
    assert.ok(offGrid(r.w, c.ch) < TOL, `static dialog is ${r.w}px wide`);
    assert.ok(offGrid(r.h, c.lh) < TOL, `static dialog is ${r.h}px tall`);
    assert.ok(offGrid(r.dx, c.ch) < TOL, `static dialog starts +${r.dx}px into the screen`);
    await ctx.close();
  });
});

describe('no-script', () => {
  // §11.1: the CSS is a whole framework on its own. The static page has to
  // render and stay on the grid with the module never loaded.
  test('the page renders on the grid with scripts disabled', async () => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1280, height: 1024 },
      javaScriptEnabled: false,
    });
    const quiet = await ctx.newPage();
    await quiet.goto(`${server.origin}/test/behavior.html`);
    await quiet.waitForTimeout(200);
    const c = await cellSize(quiet);
    const found = await rects(quiet, '.box, .statusbar, .shade, .spin, .progress, .progress-label, .ph, .ph-area, .toast');
    assert.ok(found.length > 0, 'nothing rendered without script');
    const bad = found.filter((r) => offGrid(r.w, c.ch) >= TOL || offGrid(r.h, c.lh) >= TOL);
    assert.deepEqual(bad.map((r) => `${describeRect(r)} ${r.w}x${r.h}`), []);
    await ctx.close();
  });
});
