'use strict';
// Reads a theme file (and the alias defaults in grid/tokens.css) into one
// resolved variable -> hex map, the way the cascade would.
//
// Declarations are applied in source order so a theme's trailing override
// block wins, exactly as it does in the browser. var() references are
// followed; a theme is only allowed to point at another contract variable.
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const THEME_DIR = path.join(SRC, 'themes');

const ANSI = Array.from({ length: 16 }, (_, i) => `--c${i}`);
// PLAN §5.1: the complete set of values every terminal color scheme encodes.
const REQUIRED = [
  '--bg', '--fg', '--cursor', '--cursor-fg', '--sel', '--sel-fg', ...ANSI,
];
// PLAN §5.1: semantic aliases. tokens.css points each at an ANSI slot; a theme
// may override one when the slot it points at does not work in that scheme.
const ALIASES = [
  '--border', '--muted', '--error', '--ok', '--warn', '--info', '--accent', '--link',
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function declarations(css) {
  return [...stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)]
    .map((m) => [m[1], m[2].trim()]);
}

function themeFiles() {
  return fs.readdirSync(THEME_DIR).filter((f) => f.endsWith('.css')).sort();
}

function readTheme(file) {
  const css = fs.readFileSync(path.join(THEME_DIR, file), 'utf8');
  const decls = declarations(css);
  const raw = new Map();
  for (const [name, value] of decls) raw.set(name, value); // later wins
  return { file, css, decls, raw };
}

// Alias defaults from tokens.css, e.g. --muted: var(--c8).
function aliasDefaults() {
  const css = fs.readFileSync(path.join(SRC, 'grid', 'tokens.css'), 'utf8');
  const out = new Map();
  for (const [name, value] of declarations(css)) {
    if (ALIASES.includes(name)) out.set(name, value);
  }
  return out;
}

// Theme declarations over the alias defaults, with var() chains followed.
function resolve(theme) {
  const merged = new Map([...aliasDefaults(), ...theme.raw]);
  const out = new Map();
  for (const name of merged.keys()) {
    let value = merged.get(name);
    const seen = new Set();
    while (/^var\(/.test(value)) {
      const ref = /^var\(\s*(--[\w-]+)/.exec(value);
      if (!ref || seen.has(ref[1]) || !merged.has(ref[1])) { value = null; break; }
      seen.add(ref[1]);
      value = merged.get(ref[1]);
    }
    out.set(name, value);
  }
  return out;
}


// Top-level rules as { selector, body } pairs. Themes are flat (no nesting,
// no at-rules), so one pass over the braces is enough.
function rules(css) {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

// Every declaration inside a rule body, custom property or not. Used to prove
// a theme sets colors only (PLAN §3: the theme layer alters no layout metric).
function allDeclarations(css) {
  const out = [];
  for (const { selector, body } of rules(css)) {
    for (const part of body.split(';')) {
      const m = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/s.exec(part);
      if (m) out.push({ selector, name: m[1], value: m[2] });
    }
  }
  return out;
}

module.exports = { ANSI, REQUIRED, ALIASES, THEME_DIR, themeFiles, readTheme, resolve, declarations, allDeclarations, rules, stripComments };
