'use strict';
// The docs site is published by GitHub Pages from the repository root, which
// makes the published tree the repository tree: docs/index.html is served at
// /webterm/docs/ and its ../src/webterm.css at /webterm/src/webterm.css. That
// is the same layout test/lib/server.js serves, so `npm run serve` and the
// live site differ in hostname and nothing else.
//
// Publishing from the root rather than from docs/ is not a preference. Every
// page reaches up out of docs/ for the framework it is documenting, so a
// publish root of docs/ would 404 every stylesheet, font and module on the
// site. Nothing in the repo can enforce that choice — it lives in the repo's
// Pages setting — so what is checked here is everything the choice implies:
//
//   - the root of the published site is a page, not a 404;
//   - Jekyll is off, so the tree is published byte for byte;
//   - every file the site asks the server for is a file the server will have,
//     which on Pages means a file git tracks. On disk is not enough: an
//     untracked font is present for the author and absent for every reader,
//     and the fallback is a proportional face on a cell grid.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

// What git tracks, as absolute paths. This is the set of files that exist for
// a reader of the published site.
const tracked = new Set(
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((p) => path.join(ROOT, p)),
);

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Code samples contain href= and src= as text, and name paths relative to the
// reader's own site rather than to docs/ (the same exclusion docs.spec.js
// makes, for the same reason).
const withoutCode = (html) =>
  html.replace(/<pre\b[\s\S]*?<\/pre>/g, '').replace(/<code\b[\s\S]*?<\/code>/g, '');

const PAGES = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html')).sort();

describe('the published root', () => {
  test('the repository root holds an index, so / is not a 404', () => {
    assert.ok(tracked.has(path.join(ROOT, 'index.html')), 'index.html is not tracked');
  });

  test('it sends the reader to the docs', () => {
    const html = read('index.html');
    const refresh = html.match(/<meta\s+http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/i);
    assert.ok(refresh, 'no <meta http-equiv="refresh"> on the root page');
    assert.equal(refresh[1], 'docs/');
    // A meta refresh is a request, not a guarantee; a reader who lands with it
    // suppressed needs something to click.
    assert.match(html, /<a\s+href="docs\/"/);
  });

  test('it needs nothing to render', () => {
    // The redirect cannot depend on the thing it redirects to: a stylesheet or
    // a module here is one more file between the reader and the site.
    const html = withoutCode(read('index.html'));
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(refs.filter((r) => r !== 'docs/'), []);
  });

  test('Jekyll is off, so the tree publishes verbatim', () => {
    assert.ok(tracked.has(path.join(ROOT, '.nojekyll')), '.nojekyll is not tracked');
  });
});

describe('every asset the site asks for is published', () => {
  test('each relative href and src from a docs page is tracked', () => {
    const bad = [];
    for (const file of PAGES) {
      const html = withoutCode(read('docs', file));
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const ref = m[1];
        if (/^(https?:|mailto:|#|\/\/)/.test(ref)) continue;
        const target = path.resolve(DOCS, ref.split('#')[0]);
        if (!tracked.has(target)) bad.push(`docs/${file} -> ${ref}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('each module a published module imports is tracked', () => {
    // An import is a request the browser makes, and the graph is reached from
    // the two entry points the docs load. A module missing from the deployment
    // is a page whose behavior layer never starts.
    const bad = [];
    const seen = new Set();
    const walk = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (!tracked.has(file)) return;
      const js = fs.readFileSync(file, 'utf8');
      for (const m of js.matchAll(/(?:^|[\s;])(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (!tracked.has(target)) bad.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
        else walk(target);
      }
    };
    walk(path.join(ROOT, 'src', 'behavior', 'webterm.js'));
    walk(path.join(DOCS, 'docs-behavior.js'));
    assert.deepEqual(bad, []);
  });

  test('each url() in a published stylesheet is tracked', () => {
    // The fonts are the case that bit: a family added to webterm-fonts.css is
    // the default for a theme, and its woff2 has to ship with it.
    const bad = [];
    const sheets = [...tracked].filter(
      (f) => f.endsWith('.css') && (f.startsWith(path.join(ROOT, 'src')) || f.startsWith(path.join(ROOT, 'fonts')) || f.startsWith(DOCS)),
    );
    for (const sheet of sheets) {
      const css = fs.readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const ref = m[1];
        if (/^(https?:|data:|\/\/)/.test(ref)) continue;
        const target = path.resolve(path.dirname(sheet), ref);
        if (!tracked.has(target)) bad.push(`${path.relative(ROOT, sheet)} -> ${ref}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('no published asset sits outside the publish root', () => {
    const bad = [];
    for (const file of PAGES) {
      const html = withoutCode(read('docs', file));
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const ref = m[1];
        if (/^(https?:|mailto:|#|\/\/)/.test(ref)) continue;
        const target = path.resolve(DOCS, ref.split('#')[0]);
        if (!target.startsWith(ROOT + path.sep)) bad.push(`docs/${file} -> ${ref}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
