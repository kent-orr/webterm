'use strict';
// Milestone 7, layer 3 (PLAN §6, §12): the skin.
//
// The skin's defining rule is that it declares nothing that can move an
// element, and the whole point of putting it in a spec is that the rule is
// measurable rather than aspirational. It is measured three ways here, from
// the weakest to the strongest:
//
//   1. by lint — the only properties the skin sets on a real element are
//      text-shadow, animation and custom properties, and everything else it
//      sets is on a `position: fixed` pseudo-element. A skin that cannot name
//      a layout property cannot move anything;
//   2. by screenshot — crt.css linked but not applied leaves the page
//      pixel-identical, which is what lets a page ship the skin
//      unconditionally and switch it on at runtime;
//   3. by measurement — with `.crt` applied, every rect on the kitchen-sink
//      page is identical to the pixel and .screen keeps its column count.
//
// Everything runs against test/components.html with the skin injected, so the
// skin faces every component in the framework rather than a page built to
// flatter it. test/skin.html is the demo; it is where the blink and the
// vignette are exercised, because they need markup the kitchen sink has no
// reason to carry.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');
const { startServer } = require('./lib/server');
const { TOL, cellSize, offGrid, hideFixed, showFixed, shoot } = require('./lib/grid');

const SKIN = path.resolve(__dirname, '..', 'src', 'skin');

// The classes the skin is allowed to key on. A selector naming none of them
// could reach a page that never asked for a skin.
const SKIN_CLASSES = ['crt', 'crt-vignette', 'cursor-blink'];

// What a rule may set on a real element. Nothing here can change a box.
const FLOW_PROPS = new Set([
  'text-shadow',
  'animation', 'animation-name', 'animation-duration',
  'animation-timing-function', 'animation-iteration-count',
  'animation-fill-mode', 'animation-direction', 'animation-play-state',
  'opacity',
]);

// What an overlay pseudo-element may set in addition. Every one of these is
// paint or positioning-out-of-flow; none of them is readable by a sibling.
const OVERLAY_PROPS = new Set([
  ...FLOW_PROPS,
  'content', 'position', 'inset', 'top', 'right', 'bottom', 'left',
  'z-index', 'background-color', 'background-image',
  'mask-image', 'mask-size', 'mask-repeat', 'mask-position',
  'pointer-events', 'user-select',
]);

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function skinFiles() {
  return fs.readdirSync(SKIN)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [f, fs.readFileSync(path.join(SKIN, f), 'utf8')]);
}

/*
 * Every style rule in a stylesheet, flattened.
 *
 * Written here rather than pulled in as a dependency because what it has to
 * understand is small and fixed: @media and @supports wrap rules and are
 * recursed into, @keyframes wraps frames and is skipped (a frame prelude is
 * `from`/`to`/a percentage, which is not a selector and must not be held to
 * the scoping rule), and everything else is a style rule.
 */
function parseRules(css, out = []) {
  const src = stripComments(css);
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    const body = src.slice(open + 1, j - 1);
    if (/^@(media|supports|layer)\b/.test(prelude)) parseRules(body, out);
    else if (/^@keyframes\b/.test(prelude)) { /* frames are not selectors */ }
    else if (prelude.startsWith('@')) { /* @import and friends have no body here */ }
    else out.push({ prelude, body });
    i = j;
  }
  return out;
}

function declarations(body) {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !d.includes('{'))
    .map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase())
    .filter(Boolean);
}

function selectors(prelude) {
  return prelude.split(',').map((s) => s.trim()).filter(Boolean);
}

// Pixel-for-pixel comparison of two screenshots; returns the differing count
// and where the first difference is, because "they differ" is not a useful
// failure message when the question is which effect leaked.
function diffShots(a, b) {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { differing: Infinity, at: `size ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}` };
  }
  let differing = 0;
  let at = null;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (pa.data[i] !== pb.data[i] || pa.data[i + 1] !== pb.data[i + 1]
      || pa.data[i + 2] !== pb.data[i + 2] || pa.data[i + 3] !== pb.data[i + 3]) {
      differing += 1;
      if (!at) {
        const px = (i / 4) % pa.width;
        at = `${px},${Math.floor((i / 4) / pa.width)}`;
      }
    }
  }
  return { differing, at };
}

// Every element's box, in document coordinates, in document order. The
// comparison the "nothing moves" test makes is over this whole array, so an
// element the skin nudges by a pixel fails wherever it is on the page.
async function allRects(page) {
  return page.$$eval('body *', (els) => els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const name = el.tagName.toLowerCase()
      + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    return `${i} ${name.slice(0, 48)} ${r.x + scrollX},${r.y + scrollY} ${r.width}x${r.height}`;
  }));
}

async function linkSkin(page, origin) {
  await page.evaluate(async (href) => {
    await new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'skin';
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error('crt.css did not load'));
      document.head.append(link);
    });
  }, `${origin}/src/skin/crt.css`);
}

let server;
let browser;
let page;
let cell;
let base;

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

  // The baseline: the kitchen sink with no skin at all.
  //
  // The geometry is read first, with the page intact. Only the screenshot
  // needs a fixed element hidden, and for the same reason grid.spec.js hides
  // one — a fullPage shot keeps it at its viewport position, over whatever is
  // behind it — but a hidden status bar has no box, so reading rects while it
  // is hidden would compare a baseline the page never actually has.
  base = {
    rects: await allRects(page),
    columns: await page.$$eval('.screen', (els) => els[0].getBoundingClientRect().width),
  };
  await hideFixed(page);
  base.shot = await shoot(page, { fullPage: true });
  await showFixed(page);
});

after(async () => {
  await browser.close();
  await server.close();
});

describe('source', () => {
  test('the skin ships crt.css and nothing else', () => {
    assert.deepEqual(skinFiles().map(([n]) => n), ['crt.css']);
  });

  // Same lint as the grid layer (grid.spec.js), unexempted: the grid layer
  // allows tokens.css its one px, and the skin has no equivalent. A scanline
  // is a sub-cell shape expressed as a fraction of 1lh, so the period is a
  // character row by construction (PLAN §12.1).
  test('the skin declares no px, rem or em length', () => {
    const bad = [];
    for (const [name, css] of skinFiles()) {
      for (const m of stripComments(css).matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g)) {
        bad.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('the skin names no literal color', () => {
    const bad = [];
    for (const [name, css] of skinFiles()) {
      for (const m of stripComments(css).matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/g)) {
        bad.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  // The structural half of "nothing moves" (PLAN §12.7). A rule whose subject
  // is a real element may set text-shadow, an animation and custom properties.
  // None of those is a layout property, so a conforming skin cannot move an
  // element whatever its values are.
  test('on a real element the skin sets only paint and animation', () => {
    const bad = [];
    for (const [name, css] of skinFiles()) {
      for (const rule of parseRules(css)) {
        const pseudo = selectors(rule.prelude).every((s) => /::(before|after)\b/.test(s));
        const allowed = pseudo ? OVERLAY_PROPS : FLOW_PROPS;
        for (const prop of declarations(rule.body)) {
          if (prop.startsWith('--')) continue;
          if (!allowed.has(prop)) bad.push(`${name}: ${rule.prelude} { ${prop} }`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every overlay pseudo-element is out of flow', () => {
    const bad = [];
    for (const [name, css] of skinFiles()) {
      for (const rule of parseRules(css)) {
        if (!declarations(rule.body).includes('content')) continue;
        if (!/position\s*:\s*fixed/.test(rule.body)) bad.push(`${name}: ${rule.prelude}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  // What makes the inertness structural rather than lucky: a selector that
  // names no skin class could reach a page that never opted in. :root is
  // allowed to carry the tokens, and nothing else.
  test('every selector is scoped to a skin class', () => {
    const bad = [];
    const scoped = new RegExp(`\\.(${SKIN_CLASSES.join('|')})(?![\\w-])`);
    for (const [name, css] of skinFiles()) {
      for (const rule of parseRules(css)) {
        for (const sel of selectors(rule.prelude)) {
          if (scoped.test(sel)) continue;
          const tokensOnly = sel === ':root'
            && declarations(rule.body).every((p) => p.startsWith('--'));
          if (!tokensOnly) bad.push(`${name}: ${sel}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('the stacking order declares the skin rung', () => {
    const overlay = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'grid', 'overlay.css'), 'utf8',
    );
    const value = (name) => Number(new RegExp(`${name}\\s*:\\s*(\\d+)`).exec(overlay)?.[1]);
    assert.ok(Number.isInteger(value('--wt-z-skin')), '--wt-z-skin is not in overlay.css');
    assert.ok(value('--wt-z-skin') > value('--wt-z-modal'), 'the glass is below the modal rung');
  });
});

describe('linked but not applied', () => {
  before(async () => {
    await linkSkin(page, server.origin);
  });

  test('crt.css is loaded', async () => {
    const loaded = await page.evaluate(() => [...document.styleSheets]
      .some((s) => s.href && s.href.endsWith('/src/skin/crt.css')));
    assert.ok(loaded);
  });

  test('the page is pixel-identical without the class', async () => {
    await hideFixed(page);
    const shot = await shoot(page, { fullPage: true });
    await showFixed(page);
    const { differing, at } = diffShots(base.shot, shot);
    assert.equal(differing, 0, `${differing} pixels differ, first at ${at}`);
  });
});

describe('applied', () => {
  before(async () => {
    // Both overlays, so the sweeps below cover ::before and ::after. The
    // vignette's own behavior is exercised on the demo page.
    await page.evaluate(() => document.documentElement.classList.add('crt', 'crt-vignette'));
  });

  test('every element keeps its exact box', async () => {
    const after = await allRects(page);
    assert.equal(after.length, base.rects.length);
    const moved = after
      .map((r, i) => (r === base.rects[i] ? null : `${r}  was  ${base.rects[i]}`))
      .filter(Boolean);
    assert.deepEqual(moved.slice(0, 10), []);
  });

  test('the screen keeps its column count', async () => {
    const width = await page.$$eval('.screen', (els) => els[0].getBoundingClientRect().width);
    assert.equal(width, base.columns);
  });

  test('the page still does not overflow horizontally', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `overflows by ${over}px`);
  });

  test('the glass is painted and above every grid rung', async () => {
    const z = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement, '::before');
      const root = getComputedStyle(document.documentElement);
      return {
        content: cs.content,
        position: cs.position,
        zIndex: Number(cs.zIndex),
        modal: Number(root.getPropertyValue('--wt-z-modal')),
      };
    });
    assert.notEqual(z.content, 'none');
    assert.equal(z.position, 'fixed');
    assert.ok(z.zIndex > z.modal, `glass at ${z.zIndex}, modal rung at ${z.modal}`);
  });

  test('the glass takes no pointer events and no selection', async () => {
    const styles = await page.evaluate(() => ['::before', '::after'].map((p) => {
      const cs = getComputedStyle(document.documentElement, p);
      return { p, pointer: cs.pointerEvents, select: cs.userSelect };
    }));
    for (const s of styles) {
      assert.equal(s.pointer, 'none', `${s.p} intercepts pointer events`);
      assert.equal(s.select, 'none', `${s.p} is selectable`);
    }
  });

  test('the element under the cursor is unchanged', async () => {
    const hit = await page.evaluate(() => {
      const probe = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.tagName.toLowerCase() + '.' + String(el.className || '') : 'none';
      };
      return [probe(40, 40), probe(innerWidth / 2, innerHeight / 2), probe(innerWidth - 40, innerHeight - 40)];
    });
    assert.ok(!hit.some((h) => h.startsWith('html')), `the glass is in the hit path: ${hit.join(' | ')}`);
  });

  test('the glow radius is a fraction of a cell, in the text color', async () => {
    const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('.screen')).textShadow);
    const px = Number(/(\d*\.?\d+)px\s*$/.exec(shadow.trim())?.[1]);
    assert.ok(px > 0, `no glow: ${shadow}`);
    assert.ok(px < cell.ch, `glow ${px}px is wider than a cell`);
    const color = await page.evaluate(() => {
      const el = document.querySelector('.screen');
      return { shadow: getComputedStyle(el).textShadow, color: getComputedStyle(el).color };
    });
    assert.ok(color.shadow.includes(color.color.replace(/\s/g, '')) || color.shadow.startsWith(color.color),
      `glow is not currentColor: ${color.shadow} vs ${color.color}`);
  });
});

describe('scanlines', () => {
  // Read back out of the computed mask rather than inferred: Chromium resolves
  // the lh arithmetic to px there, so this is the period the compositor will
  // actually paint.
  async function bands(page) {
    return page.evaluate(() => {
      const mask = getComputedStyle(document.documentElement, '::before').maskImage;
      return [...mask.matchAll(/(\d*\.?\d+)px/g)].map((m) => Number(m[1]));
    });
  }

  test('the period is exactly one row and the ink is half of it', async () => {
    const stops = await bands(page);
    assert.ok(stops.length >= 4, `mask has no px stops: ${stops.join()}`);
    const thickness = await page.evaluate(() => Number(
      getComputedStyle(document.documentElement).getPropertyValue('--wt-crt-scan-thickness'),
    ));
    const rows = await page.evaluate(() => Number(
      getComputedStyle(document.documentElement).getPropertyValue('--wt-crt-scan-rows'),
    ));
    const period = stops[stops.length - 1];
    const ink = stops[1];
    assert.ok(Math.abs(period - rows * cell.lh) < TOL, `period ${period}px, expected ${rows * cell.lh}`);
    assert.ok(Math.abs(ink - thickness * cell.lh) < TOL, `ink band ${ink}px, expected ${thickness * cell.lh}`);
  });

  // In pixels, with the ink turned all the way up so a scanline row is
  // exactly the ink color whatever is underneath it.
  //
  // Only the inked rows are asserted, at several columns. A clear row shows
  // the page, and the page has elements painted in --c0 of its own (a .field
  // is one), so "this clear pixel is not the ink color" is not a claim that
  // holds at an arbitrary x. That the clear rows are clear *somewhere* is a
  // separate assertion, and it is the one that would catch a solid overlay.
  const COLUMNS = [60, 300, 640, 900, 1200];

  // The default ink is --bg, which is also what is behind it, so a pixel
  // cannot say which band it is in. These two tests ink in --fg instead — the
  // documented knob — and the geometry they check is the same either way.

  async function sample(page) {
    const shot = await shoot(page, {});
    const png = PNG.sync.read(shot);
    const ink = await page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--fg').trim());
    const rgb = ink.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
    const isInk = (x, y) => {
      const i = (y * png.width + x) * 4;
      return Math.abs(png.data[i] - rgb[0]) <= 2
        && Math.abs(png.data[i + 1] - rgb[1]) <= 2
        && Math.abs(png.data[i + 2] - rgb[2]) <= 2;
    };
    const lh = Math.round(cell.lh);
    // The first band edge inside the first two rows. y=0 is already inked, so
    // the transition this finds is the start of a later band — which is the
    // same thing modulo the period, and is what the row grid is compared to.
    let start = -1;
    for (let y = 1; y < 2 * lh && start < 0; y += 1) {
      if (isInk(640, y) && !isInk(640, y - 1)) start = y;
    }
    return { png, isInk, lh, start };
  }

  test('a scanline lands on the text rows', async () => {
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--wt-crt-ink', 'var(--fg)');
      root.style.setProperty('--wt-crt-scan-ink', '1');
      window.scrollTo(0, 0);
    });
    const { png, isInk, lh, start } = await sample(page);
    assert.ok(start >= 0, 'no scanline edge found in the first two rows');

    const thick = Math.round(0.5 * cell.lh);
    const wrong = [];
    let clearSeen = 0;
    for (let y = start; y < png.height - 1; y += 1) {
      const into = (y - start) % lh;
      // A hard stop on a whole px still antialiases at the seam, so the pixel
      // on each side of a band edge is not asserted either way.
      if (into === 0 || into === thick || into === thick - 1 || into === lh - 1) continue;
      if (into < thick) {
        for (const x of COLUMNS) {
          if (!isInk(x, y)) wrong.push(`x=${x} y=${y} (${into} into the row) is not inked`);
        }
      } else if (COLUMNS.some((x) => !isInk(x, y))) {
        clearSeen += 1;
      }
    }
    assert.deepEqual(wrong.slice(0, 8), []);
    assert.ok(clearSeen > 10, `the overlay is solid: only ${clearSeen} clear rows`);

    // And the bands are on the document's rows, not merely regular.
    const screenY = await page.evaluate(() => document.querySelector('.screen').getBoundingClientRect().y);
    assert.ok(offGrid(screenY - start, cell.lh) < TOL,
      `the first band edge is at y=${start}, .screen at y=${screenY}: `
      + `${offGrid(screenY - start, cell.lh).toFixed(2)}px off the row grid`);
  });

  test('a whole-row scroll keeps them there', async () => {
    const rows = 3;
    await page.evaluate((dy) => window.scrollTo(0, dy), rows * Math.round(cell.lh));
    const { start } = await sample(page);
    assert.ok(start >= 0, 'no scanline edge found after scrolling');
    const screenY = await page.evaluate(() => document.querySelector('.screen').getBoundingClientRect().y);
    assert.ok(offGrid(screenY - start, cell.lh) < TOL,
      `after a ${rows}-row scroll the bands are `
      + `${offGrid(screenY - start, cell.lh).toFixed(2)}px off the row grid`);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.style.removeProperty('--wt-crt-scan-ink');
      document.documentElement.style.removeProperty('--wt-crt-ink');
    });
  });
});

describe('the cursor', () => {
  let demo;

  before(async () => {
    const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 } });
    demo = await ctx.newPage();
    await demo.goto(`${server.origin}/test/skin.html`);
    await demo.waitForSelector('html[data-ready="1"]');
  });

  test('the demo page carries a blinking cursor', async () => {
    assert.ok(await demo.$('.cursor-blink'), 'no .cursor-blink on skin.html');
  });

  // The lit cell is .inverse from the grid layer; the skin only animates it,
  // so a page with the skin omitted keeps a steady cursor (PLAN §12.5).
  test('the skin paints no part of the cell itself', async () => {
    const styles = await demo.$eval('.cursor-blink', (el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, w: el.getBoundingClientRect().width, anim: cs.animationName };
    });
    assert.notEqual(styles.anim, 'none', 'the cursor does not blink');
    const inverse = await demo.$eval('.inverse:not(.cursor-blink)', (el) => getComputedStyle(el).backgroundColor);
    assert.equal(styles.bg, inverse, 'the cursor cell is painted by the skin, not by .inverse');
  });

  test('a blink is a whole number of ticks, and hard', async () => {
    const t = await demo.evaluate(() => {
      const el = document.querySelector('.cursor-blink');
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      return {
        duration: cs.animationDuration,
        timing: cs.animationTimingFunction,
        ticks: Number(root.getPropertyValue('--wt-blink-ticks')),
        tick: root.getPropertyValue('--wt-tick').trim(),
      };
    });
    const tickMs = Number(t.tick.replace('ms', ''));
    assert.ok(Number.isInteger(t.ticks) && t.ticks > 0, `--wt-blink-ticks is ${t.ticks}`);
    const ms = Number(t.duration.replace('s', '')) * 1000;
    assert.ok(Math.abs(ms - 2 * t.ticks * tickMs) < 1,
      `a blink is ${ms}ms, expected ${2 * t.ticks * tickMs}ms`);
    assert.match(t.timing, /steps\(2,\s*jump-none\)/, `a blink fades: ${t.timing}`);
  });

  test('reduced motion parks it lit', async () => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 }, reducedMotion: 'reduce',
    });
    const still = await ctx.newPage();
    await still.goto(`${server.origin}/test/skin.html`);
    await still.waitForSelector('html[data-ready="1"]');
    const cs = await still.$eval('.cursor-blink', (el) => {
      const s = getComputedStyle(el);
      return { anim: s.animationName, opacity: s.opacity };
    });
    assert.equal(cs.anim, 'none');
    assert.equal(cs.opacity, '1');
    await ctx.close();
  });

  test('the motion switch parks it lit too', async () => {
    await demo.evaluate(() => document.documentElement.setAttribute('data-wt-motion', 'off'));
    const cs = await demo.$eval('.cursor-blink', (el) => {
      const s = getComputedStyle(el);
      return { anim: s.animationName, opacity: s.opacity };
    });
    assert.equal(cs.anim, 'none');
    assert.equal(cs.opacity, '1');
    await demo.evaluate(() => document.documentElement.removeAttribute('data-wt-motion'));
  });
});

describe('the vignette', () => {
  let demo;

  before(async () => {
    const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 } });
    demo = await ctx.newPage();
    await demo.goto(`${server.origin}/test/skin.html`);
    await demo.waitForSelector('html[data-ready="1"]');
    await demo.evaluate(() => document.documentElement.classList.add('crt', 'crt-vignette'));
  });

  test('it is opt-in', async () => {
    const off = await demo.evaluate(() => {
      document.documentElement.classList.remove('crt-vignette');
      const v = getComputedStyle(document.documentElement, '::after').content;
      document.documentElement.classList.add('crt-vignette');
      return v;
    });
    assert.equal(off, 'none', '.crt alone already paints a vignette');
  });

  test('it is a mask over a solid fill, so it names no color', async () => {
    const cs = await demo.evaluate(() => {
      const s = getComputedStyle(document.documentElement, '::after');
      return { mask: s.maskImage, bg: s.backgroundColor, position: s.position, pointer: s.pointerEvents };
    });
    assert.match(cs.mask, /radial-gradient/);
    assert.equal(cs.position, 'fixed');
    assert.equal(cs.pointer, 'none');
    const bg = await demo.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    const n = bg.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
    assert.equal(cs.bg, `rgb(${n.join(', ')})`, 'the fill is not the default ink');
  });

  test('the corners darken and the middle does not', async () => {
    // Inked in --fg, for the reason the scanline pixel tests are: the default
    // ink is --bg, and a vignette that inks the corners in the color already
    // behind them is invisible to a pixel by construction. What is under test
    // is the shape — the corners reach the ink and the middle is untouched.
    await demo.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--wt-crt-ink', 'var(--fg)');
      root.style.setProperty('--wt-crt-vignette-ink', '1');
    });

    const corner = [4, 4, 24, 24];
    const middle = [634, 506, 654, 526];

    const measure = async () => {
      const shot = await shoot(demo, {});
      const png = PNG.sync.read(shot);
      const mean = ([x0, y0, x1, y1]) => {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * png.width + x) * 4;
            sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
            n += 1;
          }
        }
        return sum / n;
      };
      return { corner: mean(corner), middle: mean(middle) };
    };

    await demo.evaluate(() => document.documentElement.classList.remove('crt-vignette'));
    const off = await measure();
    await demo.evaluate(() => document.documentElement.classList.add('crt-vignette'));
    const on = await measure();

    const fg = await demo.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--fg').trim());
    const n = fg.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
    const inkLum = 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];

    assert.ok(Math.abs(off.corner - inkLum) > 50,
      `the corner is at the ink without the vignette: ${off.corner.toFixed(1)} vs ${inkLum.toFixed(1)}`);
    // Most of the way, not all of it: the sampled block is a few px inside the
    // corner and the mask's 100% stop is at the corner itself, so the alpha
    // there is a little under 1.
    const covered = (on.corner - off.corner) / (inkLum - off.corner);
    assert.ok(covered > 0.9,
      `the corner covered ${(covered * 100).toFixed(0)}% of the way to the ink: `
      + `${off.corner.toFixed(1)} -> ${on.corner.toFixed(1)}, ink ${inkLum.toFixed(1)}`);
    assert.ok(Math.abs(on.middle - off.middle) < 2,
      `the middle changed by ${(on.middle - off.middle).toFixed(1)}`);
  });
});
