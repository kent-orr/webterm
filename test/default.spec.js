'use strict';
// PLAN §5.2: the default theme.
//
// test/themes.spec.js proves the default theme file keeps the §5.1 contract
// and that src/webterm.css imports it last. What that lint cannot see is
// whether the import chain actually reaches the browser, so this suite loads
// the one page that links nothing but the framework and reads the painted
// colors back:
//
//   1. every contract variable resolves, and to the default theme's values —
//      not to the empty string tokens.css alone would leave behind;
//   2. the page paints them (body background and color), so a page with one
//      <link> is a finished page;
//   3. a theme <link> after webterm.css still wins, which is the whole
//      swap-one-link mechanism and the thing an imported default could break.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('./lib/server');
const theme = require('./lib/theme');

const DEFAULT = 'pawpaw.css';
const OVERRIDE = 'tomorrow-night.css';

const expected = theme.resolve(theme.readTheme(DEFAULT));
const override = theme.resolve(theme.readTheme(OVERRIDE));
const CONTRACT = [...theme.REQUIRED, ...theme.ALIASES];

// Chromium reports colors as rgb()/rgba(); the themes are hex.
function rgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `rgb(${n.map((p) => parseInt(p, 16)).join(', ')})`;
}

async function vars(page) {
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }, CONTRACT);
}

let server;
let browser;
let page;

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 } });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.origin}/test/default-theme.html`);
  await page.waitForSelector('html[data-ready="1"]');
  assert.deepEqual(errors, [], 'page script errors');
});

after(async () => {
  await browser.close();
  await server.close();
});

describe('a page that links only webterm.css', () => {
  test('resolves every variable in the color contract', async () => {
    const got = await vars(page);
    const unset = CONTRACT.filter((n) => got[n] === '');
    assert.deepEqual(unset, [], 'these came back empty, so nothing is painting them');
  });

  test(`resolves them to ${DEFAULT}`, async () => {
    const got = await vars(page);
    const wrong = CONTRACT
      .filter((n) => got[n].toLowerCase() !== String(expected.get(n)).toLowerCase())
      .map((n) => `${n}: ${got[n]} (theme says ${expected.get(n)})`);
    assert.deepEqual(wrong, []);
  });

  test('paints the background and the text', async () => {
    const painted = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return { bg: body.backgroundColor, fg: body.color };
    });
    assert.equal(painted.bg, rgb(expected.get('--bg')));
    assert.equal(painted.fg, rgb(expected.get('--fg')));
  });

  // The faint attribute and the box edges are the two pairs a missing alias
  // default would silently blank out; grid/tokens.css points both at --c8.
  test('dim text and box edges have a color of their own', async () => {
    const got = await page.evaluate(() => ({
      dim: getComputedStyle(document.querySelector('.dim')).color,
      // The border glyph runs live on the box's pseudo-elements (box.css).
      edge: getComputedStyle(document.querySelector('.box'), '::before').color,
      body: getComputedStyle(document.body).color,
    }));
    assert.equal(got.dim, rgb(expected.get('--muted')));
    assert.equal(got.edge, rgb(expected.get('--border')));
    assert.notEqual(got.dim, got.body, 'dim is indistinguishable from body text');
  });
});

describe('the default theme does not block a theme swap', () => {
  test(`a <link> to ${OVERRIDE} after webterm.css wins`, async () => {
    await page.evaluate((href) => new Promise((done, fail) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.id = 'swapped';
      link.onload = done;
      link.onerror = () => fail(new Error(`could not load ${href}`));
      document.head.append(link);
    }), `../src/themes/${OVERRIDE}`);

    const got = await vars(page);
    const wrong = CONTRACT
      .filter((n) => got[n].toLowerCase() !== String(override.get(n)).toLowerCase())
      .map((n) => `${n}: ${got[n]} (${OVERRIDE} says ${override.get(n)})`);
    assert.deepEqual(wrong, []);

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, rgb(override.get('--bg')));

    await page.evaluate(() => document.querySelector('#swapped').remove());
  });
});
