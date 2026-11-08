/*
 * Tabs (PLAN §11.10).
 *
 * The static form is a document: sections with ids and a .nav of in-page
 * links to them. Nothing is hidden, so with no script every panel is readable
 * and the strip still navigates (§11.1). The module upgrades that markup in
 * place rather than replacing it — roles, roving focus, arrow keys, and one
 * panel visible at a time.
 *
 * The part that earns its keep is the height lock. Panels are different
 * heights; switching them moves every row below the component, which is
 * exactly the layout shift §11.5 exists to prevent one axis over. So the
 * region is measured across all panels and pinned to the tallest in whole
 * rows, and a tab change then moves nothing at all.
 *
 * No transition between panels. A terminal repaints a pane; a cross-fade is
 * not available to us and a slide between two panels that both have to stay on
 * the grid would be a wipe at best. The switch is immediate, which is also
 * what reduced motion would have forced.
 */

import { roundRows } from './lib/cells.js';
import { emit } from './lib/events.js';

const LOCK = 'tabs-fixed';

/*
 * Text rewraps when the window changes, so a lock measured at one width is
 * wrong at the next one and would clip the panel it was meant to fit. One
 * listener over the live instances, coalesced into a frame, rather than one
 * listener per tab strip: a resize is a storm of events and each remeasure
 * forces layout.
 */
const live = new Set();
let frame = 0;

function remeasureAll() {
  frame = 0;
  for (const tabs of live) tabs.remeasure();
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (frame) return;
    frame = requestAnimationFrame(remeasureAll);
  }, { passive: true });
}

let seq = 0;

export class Tabs {
  static selector = '.tabs';

  constructor(el) {
    this.el = el;
    this.fit = el.getAttribute('data-wt-fit') === 'content';
    this.wire();

    // Measured before anything is hidden, which is the whole reason the
    // static form shows every panel.
    this.remeasure();

    const first = this.tabs.find((t) => t.classList.contains('active')
      || t.getAttribute('aria-selected') === 'true') || this.tabs[0];
    if (first) this.activate(first, { silent: true });
    live.add(this);
  }

  /* ---------------------------------------------------------------- parts */

  get list() {
    return this.el.querySelector(':scope > .tabs-list');
  }

  get tabs() {
    return this.list ? [...this.list.children] : [];
  }

  get host() {
    return this.el.querySelector(':scope > .tabs-panels');
  }

  get panels() {
    return this.host ? [...this.host.querySelectorAll(':scope > .tab-panel')] : [];
  }

  /** The panel a tab points at, by `data-wt-target` or by its own href. */
  panelFor(tab) {
    const selector = tab.getAttribute('data-wt-target') || tab.getAttribute('href') || '';
    if (!selector.startsWith('#') || selector.length < 2) return null;
    return this.host ? this.host.querySelector(selector) : null;
  }

  /** The tab for `target`: a selector, a panel, a tab, or an index. */
  tabFor(target) {
    const tabs = this.tabs;
    if (typeof target === 'number') return tabs[target] || null;
    if (typeof target === 'string') return tabs.find((t) => this.panelFor(t) === this.host.querySelector(target)) || null;
    if (tabs.includes(target)) return target;
    return tabs.find((t) => this.panelFor(t) === target) || null;
  }

  /** The panel on show. */
  get active() {
    return this.panels.find((p) => !p.hidden) || null;
  }

  /* ----------------------------------------------------------------- aria */

  /*
   * The ARIA the tab pattern needs, applied to markup that did not have it,
   * because the static form is a nav and a nav is what it should be when
   * there is no script to make it a tablist.
   */
  wire() {
    const list = this.list;
    if (!list) return;
    list.setAttribute('role', 'tablist');

    for (const tab of this.tabs) {
      tab.setAttribute('role', 'tab');
      const panel = this.panelFor(tab);
      if (!panel) continue;
      seq += 1;
      if (!panel.id) panel.id = `wt-panel-${seq}`;
      if (!tab.id) tab.id = `${panel.id}-tab`;
      tab.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
    }

    list.addEventListener('click', (event) => this.onClick(event));
    list.addEventListener('keydown', (event) => this.onKey(event));
  }

  /* --------------------------------------------------------------- the lock */

  lock(rows) {
    const host = this.host;
    if (!host) return;
    host.style.setProperty('--rows', String(Math.max(0, rows)));
    host.classList.add(LOCK);
  }

  /** Let the region follow its content again. */
  unlock() {
    const host = this.host;
    if (!host) return;
    host.classList.remove(LOCK);
    host.style.removeProperty('--rows');
    if (!host.getAttribute('style')) host.removeAttribute('style');
  }

  /**
   * Pin the region to the tallest panel, in whole rows.
   *
   * A hidden panel has no height, so measuring means showing every panel with
   * the lock off — and that happens inside this one turn, so the half-measured
   * state never reaches a frame. Same trick as the collapse measuring a closed
   * body before it opens.
   */
  remeasure() {
    if (this.fit || !this.host) return 0;
    this.unlock();
    const hidden = this.panels.filter((p) => p.hidden);
    for (const p of hidden) p.hidden = false;

    let rows = 0;
    for (const p of this.panels) rows = Math.max(rows, roundRows(p.getBoundingClientRect().height));

    for (const p of hidden) p.hidden = true;
    this.lock(rows);
    return rows;
  }

  /* --------------------------------------------------------------- states */

  /** Show the panel for `target`. */
  select(target) {
    const tab = this.tabFor(target);
    return tab ? this.activate(tab) : false;
  }

  activate(tab, { silent = false } = {}) {
    const panel = this.panelFor(tab);
    if (!panel) return false;
    if (!silent && !emit(this.el, 'tabs:show', { tab, panel })) return false;

    for (const other of this.tabs) {
      const on = other === tab;
      const its = this.panelFor(other);
      other.classList.toggle('active', on);
      other.setAttribute('aria-selected', on ? 'true' : 'false');
      other.setAttribute('tabindex', on ? '0' : '-1');
      if (its) its.hidden = !on;
    }

    if (!silent) emit(this.el, 'tabs:shown', { tab, panel });
    return true;
  }

  /* -------------------------------------------------------------- keyboard */

  /*
   * The tab is an in-page link, and following it would scroll the page to the
   * panel and push a hash. preventScroll on the focus call for the same
   * reason: focusing a strip that is below the fold would move the page the
   * click was not asking to move.
   */
  onClick(event) {
    const tab = this.tabs.find((t) => t === event.target || t.contains(event.target));
    if (!tab) return;
    event.preventDefault();
    if (this.activate(tab)) tab.focus({ preventScroll: true });
  }

  onKey(event) {
    const tabs = this.tabs;
    if (!tabs.length) return;
    const current = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    let next;
    switch (event.key) {
      case 'ArrowRight': next = (current + 1) % tabs.length; break;
      case 'ArrowLeft': next = (current - 1 + tabs.length) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    if (this.activate(tabs[next])) tabs[next].focus({ preventScroll: true });
  }

  destroy() {
    live.delete(this);
    this.unlock();
  }
}
