'use strict';
// sRGB hex -> relative luminance -> WCAG contrast ratio.
//
// Terminal color schemes are published as hex triples, so hex is the only
// notation a theme file needs and the only one parsed here. Anything else is
// a lint failure (test/themes.spec.js), not a parse fallback.

function parseHex(value) {
  const s = String(value).trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2.x: (L_lighter + 0.05) / (L_darker + 0.05). 1 = identical, 21 = black
// on white.
function contrast(a, b) {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = { parseHex, luminance, contrast };
