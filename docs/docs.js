'use strict';
/*
 * The docs site's script (PLAN §13.1, §13.3).
 *
 * Two jobs, and both are optional by design. It generates each example's
 * listing from that example's own live markup, and it puts the page's column
 * count in the status bar. With this file blocked the site still reads: every
 * example renders, and only the listings are missing — the same rule layer 4
 * follows (§11.1), applied to the documentation.
 *
 * Generating the listing rather than typing it twice means a snippet can never
 * drift from the thing it sits under. What the reader is shown is the markup
 * the browser actually built, which is why attribute order and implied tags in
 * a listing may differ from the file: that is the parsed truth, and it is the
 * more useful of the two.
 */
(() => {
  // innerHTML arrives indented to wherever the example sits in the page.
  // Strip the common indent so the listing reads as a snippet.
  const dedent = (html) => {
    const lines = html.replace(/\t/g, '    ').split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) return '';
    const indent = Math.min(...lines
      .filter((line) => line.trim() !== '')
      .map((line) => line.match(/^ */)[0].length));
    return lines.map((line) => line.slice(indent)).join('\n');
  };

  for (const ex of document.querySelectorAll('.ex')) {
    const live = ex.querySelector('.ex-live');
    if (!live) continue;
    const pre = document.createElement('pre');
    pre.className = 'ex-src';
    const code = document.createElement('code');
    code.textContent = dedent(live.innerHTML);
    pre.append(code);
    live.after(pre);
  }

  // The readout is the status bar's right-hand field: the page's own size in
  // cells. On a docs site that doubles as the demo.
  const geom = document.getElementById('docs-geom');
  const screen = document.querySelector('.screen');

  const readout = () => {
    if (!geom || !screen) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:100ch;height:100lh';
    document.body.append(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    const cols = Math.round(screen.getBoundingClientRect().width / (r.width / 100));
    const rows = Math.floor(window.innerHeight / (r.height / 100));
    geom.textContent = `${cols}×${rows}`;
  };

  /*
   * Live controls, where a page has them. Each one is a plain form control
   * that does nothing until this file runs, so a page with no script shows
   * the control in its default position and the default it describes.
   */
  const FONTS = ['font-jetbrains-mono', 'font-iosevka', 'font-dejavu-sans-mono'];

  const themePicker = document.getElementById('docs-theme');
  const themeLink = document.getElementById('docs-theme-link');
  if (themePicker && themeLink) {
    themePicker.addEventListener('change', () => {
      themeLink.href = `../src/themes/${themePicker.value}.css`;
    });
  }

  const fontPicker = document.getElementById('docs-font');
  if (fontPicker) {
    fontPicker.addEventListener('change', async () => {
      // Add and remove the font classes by name: the skin page keeps its own
      // classes on the same element, and a wholesale className swap would
      // take them with it.
      document.documentElement.classList.remove(...FONTS);
      document.documentElement.classList.add(fontPicker.value);
      await document.fonts.ready;
      readout();
    });
  }

  // A switch named in data-docs-skin toggles that class on <html>, which is
  // where crt.css says the skin classes go.
  for (const control of document.querySelectorAll('[data-docs-skin]')) {
    control.addEventListener('change', () => {
      document.documentElement.classList.toggle(
        control.getAttribute('data-docs-skin'), control.checked,
      );
    });
  }

  addEventListener('resize', readout);
  document.fonts.ready.then(() => {
    readout();
    document.documentElement.dataset.docsReady = '1';
  });
})();
