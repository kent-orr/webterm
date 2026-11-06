'use strict';
const { chromium } = require('playwright');
const { startServer } = require('./server');
const { decode, analyze } = require('./seams');

// Opens test/metrics.html once per device pixel ratio and lets callers
// re-render with new settings without reloading.
async function openMetrics({ dprs = [1, 2] } = {}) {
  const server = await startServer();
  const browser = await chromium.launch();
  const pages = new Map();
  for (const dpr of dprs) {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 1600 } });
    const page = await ctx.newPage();
    await page.goto(`${server.origin}/test/metrics.html?auto`);
    await page.waitForSelector('html[data-ready="1"]');
    pages.set(dpr, page);
  }

  async function render(dpr, settings) {
    const page = pages.get(dpr);
    const m = await page.evaluate((s) => window.wtApply(s), settings);
    // Clip to the two analyzed specimens; this keeps sweeps fast.
    const bottom = m.horiz.rect.y + m.horiz.rect.height;
    const clip = { x: 0, y: 0, width: Math.ceil(m.horiz.rect.x + m.horiz.run * (m.ch80 / 80)) + 4, height: Math.ceil(bottom) + 4 };
    const shot = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    return { m, seams: analyze(decode(shot), m, dpr) };
  }

  async function measure(dpr, settings) {
    return pages.get(dpr).evaluate((s) => window.wtApply(s), settings);
  }

  async function close() {
    await browser.close();
    await server.close();
  }

  const version = async () => browser.version();

  return { render, measure, close, version };
}

module.exports = { openMetrics };
