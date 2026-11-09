/*
 * The two buttons on the behavior page that need a line of JavaScript.
 *
 * Everything else there is driven by data-wt-* attributes, which is the point
 * of the data API — a page can use the whole behavior layer without writing
 * any script at all. Toasts are the exception: a toast has no markup to point
 * at until it exists, so firing one is a call.
 */
import Webterm from '../src/behavior/webterm.js';

const MESSAGES = {
  warn: 'Replica charlie is 3.9 seconds behind.',
  error: 'Backup failed after 3 seconds.',
  ok: 'Reindex finished in 12 seconds.',
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-docs-toast]');
  if (!button) return;
  const level = button.getAttribute('data-docs-toast');
  Webterm.toast(MESSAGES[level], { level });
});
