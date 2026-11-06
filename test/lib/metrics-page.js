'use strict';
const { chromium } = require('playwright');
const { startServer } = require('./server');
const { decode, analyze } = require('./seams');

// Opens test/metrics.html once per device pixel ratio and lets callers
// re-render with new settings without reloading.
//
// One page per DPR is shared by every caller, and a caller's work is "change
// the page's font/size/offset, then measure or screenshot it". node:test runs
// the subtests of a describe() block concurrently, so those steps interleave
// and a test reads a page another test has just re-rendered. Every entry
// point therefore runs inside a queue: apply and read are one atomic unit.
async function openMetrics({ dprs = [1, 2] } = {}) {
  const server = await startServer();
  const browser = await chromium.launch();
  const pages = new Map();
  // Serializes apply+read against the shared pages.
  let queue = Promise.resolve();
  const atomic = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  for (const dpr of dprs) {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 1600 } });
    const page = await ctx.newPage();
    await page.goto(`${server.origin}/test/metrics.html?auto`);
    await page.waitForSelector('html[data-ready="1"]');
    pages.set(dpr, page);
  }

  function render(dpr, settings) {
    return atomic(() => renderNow(dpr, settings));
  }

  async function renderNow(dpr, settings) {
    const page = pages.get(dpr);
    const m = await page.evaluate((s) => window.wtApply(s), settings);
    // Clip to the two analyzed specimens; this keeps sweeps fast.
    const bottom = m.horiz.rect.y + m.horiz.rect.height;
    const clip = { x: 0, y: 0, width: Math.ceil(m.horiz.rect.x + m.horiz.run * (m.ch80 / 80)) + 4, height: Math.ceil(bottom) + 4 };
    const shot = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    return { m, seams: analyze(decode(shot), m, dpr) };
  }

  function measure(dpr, settings) {
    return atomic(() => pages.get(dpr).evaluate((s) => window.wtApply(s), settings));
  }

  async function close() {
    await browser.close();
    await server.close();
  }

  const version = async () => browser.version();

  return { render, measure, close, version };
}

module.exports = { openMetrics };
