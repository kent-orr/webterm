'use strict';
// The README is the usage documentation, and documentation drifts silently.
// Every claim it makes that is mechanically checkable is checked here, with no
// browser: the classes its examples use, the fixed sets it enumerates (themes,
// fonts, column widths), and which theme it calls the default.
//
// The point is not to lint prose. It is that a class renamed in src/ or a
// theme added to src/themes/ should fail a test rather than quietly leave the
// README describing a framework that no longer exists.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const srcFiles = () => {
  const out = [path.join(root, 'src', 'webterm.css')];
  for (const dir of ['grid', 'themes']) {
    const d = path.join(root, 'src', dir);
    for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.css'))) {
      out.push(path.join(d, f));
    }
  }
  return out;
};

// Every class name that appears anywhere in a selector across the framework.
// Deliberately over-permissive — it also catches the class-shaped tail of a
// url("…css") — because a false positive here can only hide a missing class
// nobody would name, while a false negative would fail an honest README.
const definedClasses = () => {
  const found = new Set();
  for (const file of srcFiles()) {
    const css = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) found.add(m[1]);
  }
  return found;
};

// class="…" out of the README's HTML examples: unambiguous, so every token is
// required to exist.
const exampleClasses = () => {
  const found = new Map();
  for (const block of readme.matchAll(/```html\n([\s\S]*?)```/g)) {
    for (const attr of block[1].matchAll(/class="([^"]+)"/g)) {
      for (const name of attr[1].trim().split(/\s+/)) {
        if (!found.has(name)) found.set(name, attr[1]);
      }
    }
  }
  return found;
};

// Inline code spans that are nothing but a class selector: `.box-fill`. The
// anchored match is what keeps `tokens.css`, `-ok` and `.col-N` out — a
// filename does not start with a dot, a modifier suffix is not a selector, and
// `.col-N` is a template whose instances are checked separately.
const documentedClasses = () => {
  const found = new Set();
  for (const span of readme.matchAll(/`([^`\n]+)`/g)) {
    const m = /^\.([a-z][a-z0-9-]*)$/.exec(span[1]);
    if (m) found.add(m[1]);
  }
  return found;
};

describe('the README documents classes that exist', () => {
  const defined = definedClasses();

  test('every class used in an HTML example is defined in src/', () => {
    const used = exampleClasses();
    assert.ok(used.size > 20, `only ${used.size} example classes found; did the examples move?`);
    const missing = [...used.keys()].filter((c) => !defined.has(c));
    assert.deepEqual(missing, [], `README examples use undefined classes: ${missing.join(', ')}`);
  });

  test('every class named in prose is defined in src/', () => {
    const named = documentedClasses();
    assert.ok(named.size > 40, `only ${named.size} documented classes found; did the reference move?`);
    const missing = [...named].filter((c) => !defined.has(c));
    assert.deepEqual(missing, [], `README documents undefined classes: ${missing.join(', ')}`);
  });
});

describe('the README enumerates the shipped sets', () => {
  // "Nine themes ship: `pawpaw` (the default), `tomorrow-night`, …"
  test('the theme list matches src/themes/', () => {
    const sentence = /themes ship:([\s\S]*?)\n\n/.exec(readme);
    assert.ok(sentence, 'no theme list in the README');
    const listed = [...sentence[1].matchAll(/`([a-z-]+)`/g)].map((m) => `${m[1]}.css`).sort();
    const shipped = fs
      .readdirSync(path.join(root, 'src', 'themes'))
      .filter((n) => n.endsWith('.css'))
      .sort();
    assert.deepEqual(listed, shipped);
  });

  test('the README names the theme that src/webterm.css imports', () => {
    const css = fs.readFileSync(path.join(root, 'src', 'webterm.css'), 'utf8');
    const imported = /@import url\("themes\/([a-z-]+)\.css"\)/.exec(css);
    assert.ok(imported, 'src/webterm.css imports no default theme');
    assert.match(readme, new RegExp(`\`${imported[1]}\` \\(the default\\)`));
  });

  // The font table carries each font's row height at the default size, which
  // is derived from the calibrated ratio in tokens.css (PLAN §4.7). If a
  // recalibration changes a ratio, the table is wrong.
  test('the font table matches the calibrated ratios', () => {
    const tokens = stripComments(fs.readFileSync(path.join(root, 'src', 'grid', 'tokens.css'), 'utf8'));
    const size = Number(/--wt-font-size:\s*(\d+)px/.exec(tokens)[1]);

    const calibrated = new Map();
    for (const m of tokens.matchAll(/:root\.(font-[a-z-]+)\s*{([^}]*)}/g)) {
      calibrated.set(m[1], Number(/--wt-lh-ratio:\s*([\d.]+)/.exec(m[2])[1]));
    }
    assert.ok(calibrated.size >= 3, 'tokens.css defines fewer than three font classes');

    const rows = new Map();
    for (const m of readme.matchAll(/\|\s*`(font-[a-z-]+)`\s*\|[^|]*\|\s*(\d+)px\s*\|/g)) {
      rows.set(m[1], Number(m[2]));
    }
    assert.deepEqual([...rows.keys()].sort(), [...calibrated.keys()].sort());

    for (const [name, ratio] of calibrated) {
      assert.equal(
        rows.get(name),
        Math.floor(size * ratio),
        `${name}: README says ${rows.get(name)}px at ${size}px, ratio ${ratio} gives ${Math.floor(size * ratio)}px`,
      );
    }
  });

  // ".col-N — exactly N cells, for N in 4, 8, 12, …"
  test('the documented column widths match layout.css', () => {
    const sentence = /`\.col-N`[^\n]*for N in ([\d, ]+)\./.exec(readme);
    assert.ok(sentence, 'the README does not enumerate the .col-N widths');
    const listed = sentence[1].split(',').map((n) => Number(n.trim()));

    const layout = stripComments(fs.readFileSync(path.join(root, 'src', 'grid', 'layout.css'), 'utf8'));
    const defined = [...layout.matchAll(/\.col-(\d+)\s*{/g)].map((m) => Number(m[1]));

    assert.deepEqual(
      [...listed].sort((a, b) => a - b),
      [...defined].sort((a, b) => a - b),
    );
  });

  // Three files state the license and they are edited at different times:
  // package.json, the README, and LICENSE itself. A repo that redistributes
  // fonts under three other licenses cannot afford them to disagree.
  test('the license is MIT in every place that names one', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.license, 'MIT');

    const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
    assert.match(license, /^MIT License\n/);
    assert.match(license, /Permission is hereby granted, free of charge/);
    assert.match(license, /Copyright \(c\) \d{4}/);

    assert.match(readme, /## License\n\nMIT — see `LICENSE`\./);

    // The bundled fonts are not ours to relicense, so the README has to say
    // the MIT grant stops at the framework.
    assert.match(readme, /`LICENSE` does not cover them/);
    for (const dir of ['jetbrains-mono', 'iosevka', 'dejavu-sans-mono']) {
      assert.ok(
        fs.existsSync(path.join(root, 'fonts', dir, 'LICENSE')),
        `fonts/${dir}/LICENSE is missing but the README points at it`,
      );
    }
  });

  // Rule 2 and PLAN §4.7: the framework has exactly one px value, and the
  // README tells the reader which custom property it is.
  test('the README names the only px knob, and it is the only one', () => {
    assert.match(readme, /`--wt-font-size` is the only px value/);

    const pxDecls = [];
    for (const file of srcFiles()) {
      // `round(down, …, 1px)` is a rounding step, not a length: it is how the
      // line-height is snapped to whole px (PLAN §4.7), and it introduces no
      // px value of its own.
      const css = stripComments(fs.readFileSync(file, 'utf8')).replace(/,\s*1px\)/g, ')');
      for (const m of css.matchAll(/^\s*(--[\w-]+|[\w-]+)\s*:[^;]*\d+px/gm)) {
        pxDecls.push(`${path.basename(file)}: ${m[1]}`);
      }
    }
    assert.deepEqual(
      pxDecls,
      ['tokens.css: --wt-font-size'],
      `px declared outside the one knob: ${pxDecls.join(', ')}`,
    );
  });
});
