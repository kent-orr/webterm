'use strict';
// Milestone 9 (PLAN §13): the docs site is the framework's largest test case.
//
// Every page in docs/ faces the same sweep grid.spec.js runs over the kitchen
// sink — integer ch widths, integer lh heights, every element starting on a
// cell boundary, continuous box borders — because a docs site is the first
// thing in the repo that has to be *read*: long prose, a nav, code listings.
// If the grid cannot survive that, §2 is a stunt.
//
// The suite discovers pages by reading the directory, so a page added later
// cannot opt out. The rest of it holds the three structural decisions of §13.1
// that have no build step to enforce them:
//
//   - the chrome is literal HTML repeated per page, so it is checked for
//     byte-identity instead of being generated;
//   - an example's listing is generated from its own live markup, so it is
//     checked for a round trip instead of being trusted;
//   - the site must read with the script blocked, because the framework's
//     rule is that the CSS never depends on the JS (§11.1).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('./lib/server');
const { TOL, cellSize, rects, offGrid, describeRect, hideFixed, showFixed, shoot } = require('./lib/grid');
const borders = require('./lib/borders');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SRC = path.join(ROOT, 'src');

// The chrome — everything from the header through the nav — is repeated
// verbatim in every page (§13.1). These sentinels are what makes "verbatim"
// checkable.
const CHROME_OPEN = '<!-- docs:chrome -->';
const CHROME_CLOSE = '<!-- /docs:chrome -->';

const PAGES = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html')).sort();

function read(file) {
  return fs.readFileSync(path.join(DOCS, file), 'utf8');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripJsComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// The chrome block, with the one attribute that is allowed to differ between
// copies removed. aria-current marks the page you are on; everything else in
// the block has to match to the byte.
function chrome(file) {
  const html = read(file);
  const a = html.indexOf(CHROME_OPEN);
  const b = html.indexOf(CHROME_CLOSE);
  assert.ok(a >= 0 && b > a, `${file}: no ${CHROME_OPEN} ... ${CHROME_CLOSE} block`);
  return html.slice(a + CHROME_OPEN.length, b).replace(/ aria-current="page"/g, '');
}

function navLinks(file) {
  const block = chrome(file);
  return [...block.matchAll(/<a\b[^>]*href="([^"#]+)"/g)].map((m) => m[1]);
}

// Every class the framework's own CSS defines, from all four layers.
function frameworkClasses() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.css')) {
        for (const m of stripComments(fs.readFileSync(p, 'utf8')).matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
          found.add(m[1]);
        }
      }
    }
  };
  walk(SRC);
  return found;
}

// Classes the docs page is allowed to use without the framework defining
// them: the site's own chrome, and the example scaffolding.
const DOCS_OWN = /^(docs-|ex$|ex-)/;

/*
 * Markup normalizer, as source text, because it runs inside the page in two
 * different evaluate calls.
 *
 * It compares markup rather than bytes: whitespace between tags collapses,
 * comments go, and an empty style attribute goes with them — Playwright's
 * screenshot hides the caret by setting an inline caret-color and clearing it
 * again, which leaves style="" on every control that has one.
 */
const NORM = `
  const norm = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const text = child.nodeValue.replace(/\\s+/g, ' ');
          if (text.trim() === '') child.remove();
          else child.nodeValue = text.trim();
        } else if (child.nodeType === 8) {
          child.remove();
        } else {
          if (child.getAttribute('style') === '') child.removeAttribute('style');
          walk(child);
        }
      }
    };
    walk(t.content);
    return t.innerHTML;
  };
  const authored = async () => {
    const src = await (await fetch(location.href, { cache: 'no-store' })).text();
    const doc = new DOMParser().parseFromString(src, 'text/html');
    return [...doc.querySelectorAll('.ex')];
  };
`;

let server;
let browser;
let ctx;
let noJsCtx;

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  const opts = { deviceScaleFactor: 1, viewport: { width: 1280, height: 1024 } };
  ctx = await browser.newContext(opts);
  noJsCtx = await browser.newContext({ ...opts, javaScriptEnabled: false });
});

after(async () => {
  await browser.close();
  await server.close();
});

describe('the site exists', () => {
  test('docs/ holds at least an index', () => {
    assert.ok(PAGES.includes('index.html'), `pages: ${PAGES.join(', ')}`);
  });

  test('every page is a whole document with the framework linked', () => {
    const bad = [];
    for (const file of PAGES) {
      const html = read(file);
      if (!/^<!doctype html>/i.test(html)) bad.push(`${file}: no doctype`);
      // Exactly one font class, and the skin page also carries its skin
      // classes there — which is where crt.css says to put them.
      if (!/<html lang="en" class="[^"]*\bfont-[a-z-]+\b[^"]*">/.test(html)) {
        bad.push(`${file}: no font class on <html>`);
      }
      if (!html.includes('../src/webterm.css')) bad.push(`${file}: does not link webterm.css`);
      if (!html.includes('../fonts/webterm-fonts.css')) bad.push(`${file}: does not link the fonts`);
      if (!/<title>[^<]+<\/title>/.test(html)) bad.push(`${file}: no title`);
    }
    assert.deepEqual(bad, []);
  });

  test('no page carries a style attribute or an inline length', () => {
    // §13.1: the docs get no privileges the framework does not grant. A
    // one-off inline px is exactly how a grid rots.
    const bad = [];
    for (const file of PAGES) {
      const html = read(file);
      for (const m of html.matchAll(/ style="([^"]*)"/g)) {
        if (/\d\s*(px|rem|em)\b/.test(m[1])) bad.push(`${file}: style="${m[1]}"`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe('the chrome is one chrome', () => {
  test('every page carries the sentinel block', () => {
    for (const file of PAGES) chrome(file);
  });

  test('the block is byte-identical across pages but for aria-current', () => {
    const base = chrome(PAGES[0]);
    const bad = PAGES.filter((f) => chrome(f) !== base);
    assert.deepEqual(bad, [], `these differ from ${PAGES[0]}`);
  });

  test('the nav links every page, and only pages that exist', () => {
    const links = navLinks(PAGES[0]);
    assert.deepEqual([...links].sort(), PAGES, 'nav links vs files on disk');
  });

  test('each page marks itself current, and nothing else', () => {
    const bad = [];
    for (const file of PAGES) {
      const block = read(file).slice(
        read(file).indexOf(CHROME_OPEN), read(file).indexOf(CHROME_CLOSE),
      );
      const marked = [...block.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)];
      if (marked.length !== 1) {
        bad.push(`${file}: ${marked.length} links marked current`);
        continue;
      }
      const href = /href="([^"]+)"/.exec(marked[0][0])[1];
      if (href !== file) bad.push(`${file}: marks ${href} current`);
    }
    assert.deepEqual(bad, []);
  });
});

describe('the border exception is one exception', () => {
  // .docs-partial opts a box out of the PNG border sweep. It exists for a
  // single demo; left unchecked it would be the hole the whole suite leaks
  // through, so the suite counts it.
  test('.docs-partial appears exactly once, on boxes.html', () => {
    const uses = [];
    for (const file of PAGES) {
      for (const m of read(file).matchAll(/class="[^"]*\bdocs-partial\b[^"]*"/g)) {
        uses.push(`${file}: ${m[0]}`);
      }
    }
    assert.deepEqual(uses, ['boxes.html: class="box docs-partial"']);
  });

  // A page that documents how to use the framework shows it working. The
  // about page documents the project rather than the framework, so it has no
  // examples — and that is a decision, not an omission, so it is pinned here
  // rather than left to a page-level check that quietly passes on an empty
  // page.
  test('only the about page has no live examples', () => {
    const without = PAGES.filter((f) => !read(f).includes('class="ex"'));
    assert.deepEqual(without, PAGES.includes('about.html') ? ['about.html'] : []);
  });

  // data-docs-mounts says "layer 4 rewrites this example's DOM", which is the
  // other way out of a listing check. Only the behavior page may say it.
  test('data-docs-mounts appears only on behavior.html', () => {
    const pages = PAGES.filter((f) => read(f).includes('data-docs-mounts'));
    assert.deepEqual(pages, PAGES.includes('behavior.html') ? ['behavior.html'] : []);
  });
});

// Code samples contain href= and src= as text. They are not links, and a
// sample that names a path relative to the repo root rather than to docs/ is
// correct for its reader and wrong for fs.existsSync.
function withoutCode(html) {
  return html.replace(/<pre\b[\s\S]*?<\/pre>/g, '').replace(/<code\b[\s\S]*?<\/code>/g, '');
}

describe('links resolve', () => {
  test('every relative href and src is a file on disk', () => {
    const bad = [];
    for (const file of PAGES) {
      const html = withoutCode(read(file));
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const ref = m[1];
        if (/^(https?:|mailto:|#|\/\/)/.test(ref)) continue;
        const target = path.resolve(DOCS, ref.split('#')[0]);
        if (!fs.existsSync(target)) bad.push(`${file} -> ${ref}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every in-page anchor has a target on that page', () => {
    const bad = [];
    for (const file of PAGES) {
      const html = withoutCode(read(file));
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      for (const m of html.matchAll(/href="#([^"]+)"/g)) {
        if (!ids.has(m[1])) bad.push(`${file} -> #${m[1]}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe('source lint', () => {
  test('docs.css declares no px, rem or em length', () => {
    const css = stripComments(fs.readFileSync(path.join(DOCS, 'docs.css'), 'utf8'));
    const found = [...css.matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g)].map((m) => m[0]);
    assert.deepEqual(found, []);
  });

  test('docs.css names no literal color', () => {
    const css = stripComments(fs.readFileSync(path.join(DOCS, 'docs.css'), 'utf8'));
    const found = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g)].map((m) => m[0]);
    assert.deepEqual(found, []);
  });

  test('docs.js declares no px, rem or em length and no literal color', () => {
    const js = stripJsComments(fs.readFileSync(path.join(DOCS, 'docs.js'), 'utf8'));
    const bad = [
      ...[...js.matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g)].map((m) => m[0]),
      ...[...js.matchAll(/#[0-9a-fA-F]{3,6}\b|\b(?:rgba?|hsla?|oklch)\(/g)].map((m) => m[0]),
    ];
    assert.deepEqual(bad, []);
  });

  test('every framework class the docs use is one the framework defines', () => {
    const defined = frameworkClasses();
    const bad = [];
    for (const file of PAGES) {
      for (const m of read(file).matchAll(/class="([^"]+)"/g)) {
        for (const cls of m[1].trim().split(/\s+/)) {
          if (DOCS_OWN.test(cls) || defined.has(cls)) continue;
          bad.push(`${file}: .${cls}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
});

// The milestone itself: every page, measured.
for (const file of PAGES) {
  describe(`docs/${file}`, () => {
    let page;
    let cell;

    before(async () => {
      page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${server.origin}/docs/${file}`);
      await page.waitForSelector('html[data-docs-ready="1"]');
      assert.deepEqual(errors, [], 'page script errors');
      cell = await cellSize(page);
    });

    after(async () => {
      await page.close();
    });

    test('the screen is a whole number of columns', async () => {
      const [screen] = await rects(page, '.screen');
      assert.ok(offGrid(screen.w, cell.ch) < TOL, `screen width ${screen.w} is ${screen.w / cell.ch} ch`);
    });

    test('the page does not overflow horizontally', async () => {
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(over <= 0, `overflows by ${over}px`);
    });

    // The kitchen sink's selectors, plus the three the docs site adds.
    const SELECTORS = [
      '.box', '.col', '[class*="col-"]', '.statusbar', 'th', 'td', 'hr',
      '.docs-nav', '.docs-main', '.ex-live', 'h1', 'h2', 'p', 'pre',
      'table', 'blockquote', '.btn', '.field', '.select', '.badge',
      '.progress', '.alert', '.menu', '.kv', '.box-divide',
    ];

    for (const sel of SELECTORS) {
      test(`${sel}: on the cell grid`, async () => {
        const found = await rects(page, sel);
        if (found.length === 0) return; // not every page has every element
        const [screen] = await rects(page, '.screen');
        const bad = [];
        for (const r of found) {
          // A closed <dialog> is display:none. It has no box, so it has no
          // box to be off the grid, and it gets one the moment it opens.
          if (r.w === 0 && r.h === 0) continue;
          if (offGrid(r.w, cell.ch) >= TOL) {
            bad.push(`${describeRect(r)} w=${r.w} (${(r.w / cell.ch).toFixed(3)}ch)`);
          }
          if (offGrid(r.h, cell.lh) >= TOL) {
            bad.push(`${describeRect(r)} h=${r.h} (${(r.h / cell.lh).toFixed(3)}lh)`);
          }
          // Fixed elements are positioned against the viewport, whose height
          // is not a whole number of rows, so only their size is on the grid.
          if (!r.fixed && (offGrid(r.x - screen.x, cell.ch) >= TOL || offGrid(r.y - screen.y, cell.lh) >= TOL)) {
            bad.push(`${describeRect(r)} at +${(r.x - screen.x).toFixed(2)},+${(r.y - screen.y).toFixed(2)}`);
          }
        }
        assert.deepEqual(bad, []);
      });
    }

    test('box borders survive the prose', async () => {
      // .docs-partial is the one deliberate exception: boxes.html shows what
      // a box without its .box-edge span looks like, and the point of that
      // demo is the two edges it is missing.
      // A box inside a closed <details> still reports a rect, because the
      // menu is absolutely positioned and only the paint is skipped. Ask the
      // browser what it is painting rather than inferring it from geometry —
      // and ask without marking the DOM, because the next test compares this
      // page's markup against the file it came from.
      const painted = await page.$$eval('.box', (els) => els.map((el) => el.checkVisibility()));
      const boxes = (await borders.boxGeometry(page, '.box'))
        .filter((b, i) => painted[i])
        .filter((b) => !/\bdocs-partial\b/.test(b.cls))
        .filter((b) => b.w > 0 && b.h > 0);
      if (boxes.length === 0) return;
      await hideFixed(page);
      const png = borders.readShot(await shoot(page, { fullPage: true }));
      await showFixed(page);
      assert.deepEqual(borders.missingCorners(png, boxes, cell), []);
      const drawn = boxes.filter((b) => !/\bbox-ascii\b/.test(b.cls));
      assert.deepEqual(borders.brokenEdges(png, drawn, cell), []);
    });

    test('every example renders something', async () => {
      const live = await page.$$eval('.ex-live', (els) => els.map((el) => ({
        html: el.innerHTML.trim().length,
        h: el.getBoundingClientRect().height,
      })));
      assert.deepEqual(live.filter((e) => e.html === 0 || e.h === 0), []);
    });

    test('every example has exactly one generated listing', async () => {
      const counts = await page.$$eval('.ex', (els) => els.map((el) => ({
        live: el.querySelectorAll('.ex-live').length,
        src: el.querySelectorAll('.ex-src').length,
      })));
      assert.deepEqual(counts.filter((c) => c.live !== 1 || c.src !== 1), []);
    });

    /*
     * The one that keeps a listing from drifting from the thing it documents.
     *
     * The listing is compared against the page's own source file, parsed —
     * not against the live DOM — because on behavior.html the live DOM is no
     * longer the authored markup by the time this runs: layer 4 has mounted
     * into it. Anchoring to the file is the stronger check anyway. It is what
     * the reader would have typed.
     */
    test('each listing is the markup the file holds', async () => {
      const bad = await page.evaluate(`(async () => {
        ${NORM}
        const src = await authored();
        const out = [];
        document.querySelectorAll('.ex').forEach((ex, i) => {
          const listing = ex.querySelector('.ex-src');
          const live = src[i] && src[i].querySelector('.ex-live');
          if (!listing || !live) { out.push({ i, missing: true }); return; }
          const a = norm(live.innerHTML);
          const b = norm(listing.textContent);
          if (a !== b) out.push({ i, file: a, listed: b });
        });
        return out;
      })()`);
      assert.deepEqual(bad, []);
    });

    /*
     * And the other half: the page is not doing DOM surgery behind the
     * listing's back. Where the behavior layer mounts it legitimately is, so
     * those examples say so on the figure and are counted elsewhere.
     */
    test('the live markup is the file\'s, except where layer 4 mounts', async () => {
      const bad = await page.evaluate(`(async () => {
        ${NORM}
        const src = await authored();
        const out = [];
        document.querySelectorAll('.ex').forEach((ex, i) => {
          if (ex.hasAttribute('data-docs-mounts')) return;
          const live = ex.querySelector('.ex-live');
          const file = src[i] && src[i].querySelector('.ex-live');
          if (!live || !file) { out.push({ i, missing: true }); return; }
          const a = norm(file.innerHTML);
          const b = norm(live.innerHTML);
          if (a !== b) out.push({ i, file: a, live: b });
        });
        return out;
      })()`);
      assert.deepEqual(bad, []);
    });

    // Every code block, not only the generated listings: a block that
    // overflows gets a px-tall scrollbar inside it, which is how a code
    // listing takes a whole page off the row grid.
    test('no code line is wider than the block it sits in', async () => {
      const bad = await page.$$eval('pre', (els) => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:100ch';
        document.body.append(probe);
        const ch = probe.getBoundingClientRect().width / 100;
        probe.remove();
        const out = [];
        for (const el of els) {
          const cols = Math.round(el.getBoundingClientRect().width / ch) - 2; // 1ch padding each side
          for (const line of el.textContent.split('\n')) {
            if (line.length > cols) out.push(`${line.length} > ${cols}: ${line.trim().slice(0, 40)}`);
          }
        }
        return out;
      });
      assert.deepEqual(bad, []);
    });
  });

  // §11.1, applied to the docs: the page is readable with the script blocked.
  describe(`docs/${file} with no script`, () => {
    let page;
    let cell;

    before(async () => {
      page = await noJsCtx.newPage();
      await page.goto(`${server.origin}/docs/${file}`);
      await page.waitForLoadState('load');
      // The page's own scripts are blocked, but the spec's evaluate still
      // runs, so the cell probe can wait for the real font rather than
      // measuring the fallback.
      await page.evaluate(() => document.fonts.ready);
      cell = await cellSize(page);
    });

    after(async () => {
      await page.close();
    });

    test('every example still renders', async () => {
      const live = await page.$$eval('.ex-live', (els) => els.map((el) => ({
        html: el.innerHTML.trim().length,
        h: el.getBoundingClientRect().height,
      })));
      assert.deepEqual(live.filter((e) => e.html === 0 || e.h === 0), []);
    });

    test('the page carries no empty listing shell', async () => {
      // The listing is generated, so with the script blocked there must be no
      // .ex-src in the markup at all — not an empty one waiting to be filled.
      assert.equal(await page.$$eval('.ex-src', (els) => els.length), 0);
    });

    test('the grid still holds', async () => {
      const [screen] = await rects(page, '.screen');
      assert.ok(offGrid(screen.w, cell.ch) < TOL, `screen width ${screen.w}`);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(over <= 0, `overflows by ${over}px`);
      const bad = [];
      for (const sel of ['.box', '.ex-live', '.docs-main', 'pre', 'p']) {
        for (const r of await rects(page, sel)) {
          if (offGrid(r.w, cell.ch) >= TOL) bad.push(`${describeRect(r)} w=${r.w}`);
          if (offGrid(r.h, cell.lh) >= TOL) bad.push(`${describeRect(r)} h=${r.h}`);
        }
      }
      assert.deepEqual(bad, []);
    });
  });
}
