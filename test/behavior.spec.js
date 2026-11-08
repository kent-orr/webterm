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
const { TOL, cellSize, rects, offGrid, describeRect, screenColumns } = require('./lib/grid');
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
      return { beforeStep, after, done, jobs: clock.jobs };
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
      const out = { ticks: ticks.slice(), done, jobs: clock.jobs };
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
      const out = { finished, cancelled, jobs: clock.jobs };
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
      const out = { enabled, ticks: ticks.length, done, jobs: clock.jobs };
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
      return { enabled: motionEnabled(), done, jobs: clock.jobs };
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
    await page.addStyleTag({ id: 'no-fixed-built', content: '.statusbar-fixed { display: none !important; }' });
    const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    await page.evaluate(() => document.getElementById('no-fixed-built')?.remove());
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
    const found = await rects(quiet, '.box, .statusbar, .shade, .spin, .progress, .progress-label');
    assert.ok(found.length > 0, 'nothing rendered without script');
    const bad = found.filter((r) => offGrid(r.w, c.ch) >= TOL || offGrid(r.h, c.lh) >= TOL);
    assert.deepEqual(bad.map((r) => `${describeRect(r)} ${r.w}x${r.h}`), []);
    await ctx.close();
  });
});
