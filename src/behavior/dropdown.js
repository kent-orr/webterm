/*
 * Dropdown (PLAN §11.10).
 *
 * The same disclosure as a collapse, floating instead of in flow, so it is a
 * <details> for the same reasons: the browser owns the trigger, the state and
 * the keyboard basics, and the thing still opens with no script.
 *
 * What makes it a grid component rather than a popup is the flip. Everywhere
 * else a popup that would leave the viewport is nudged back by a measured
 * distance, which on a character grid puts it mid-cell. Here the menu is
 * anchored to an edge of its trigger (components.css) and flipping means
 * anchoring to the opposite edge, so every position it can take is on the grid
 * by construction and the JS computes no offsets at all — it only decides
 * *whether* to flip, which it asks lib/cells.js in whole cells.
 *
 * The rest is what a native <details> has no opinion about: Escape, a click
 * outside, one open at a time, and roving focus through the items.
 */

import { overflow } from './lib/cells.js';
import { emit } from './lib/events.js';

const UP = 'dropdown-up';
const END = 'dropdown-end';

/* Every open dropdown on the page, so opening one can close the rest. */
const live = new Set();

export class Dropdown {
  static selector = 'details.dropdown';

  constructor(el) {
    this.el = el;

    // The direction the author asked for. A flip is measured from here and
    // reverts to it on close, so an authored .dropdown-up stays up.
    this.preferUp = el.classList.contains(UP);
    this.preferEnd = el.classList.contains(END);

    this.onOutside = (event) => {
      if (!this.el.contains(event.target)) this.hide();
    };
    this.onEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.hide();
    };

    const summary = this.summary;
    if (summary) summary.setAttribute('aria-haspopup', 'menu');
    const menu = this.menu;
    if (menu) {
      menu.setAttribute('role', 'menu');
      for (const item of this.items) item.setAttribute('role', 'menuitem');
    }

    el.addEventListener('click', (event) => this.onClick(event));
    el.addEventListener('keydown', (event) => this.onKey(event));
    el.addEventListener('toggle', () => this.onToggle());

    // Open in the initial markup: adopted, not rebuilt (§11.1).
    if (el.open) this.afterOpen();
  }

  /* ----------------------------------------------------------------- parts */

  get summary() {
    return this.el.querySelector(':scope > summary');
  }

  /** The positioned panel — a .box, usually, so it has a border. */
  get panel() {
    return this.el.querySelector(':scope > .dropdown-menu');
  }

  /** The list of items inside it, which may be the panel itself. */
  get menu() {
    const panel = this.panel;
    if (!panel) return null;
    if (panel.classList.contains('menu')) return panel;
    return panel.querySelector('.menu');
  }

  get items() {
    const menu = this.menu;
    if (!menu) return [];
    return [...menu.children].filter((i) => !i.hasAttribute('disabled') && i.getAttribute('aria-disabled') !== 'true');
  }

  get open() {
    return this.el.open;
  }

  /* ------------------------------------------------------------- placement */

  /*
   * Choose an anchor for each axis: the authored one, or the opposite if the
   * authored one runs off the viewport — and only if the opposite is actually
   * better. A menu taller than the room above *and* below should stay where
   * the author put it rather than flap to the worse side.
   */
  place() {
    const panel = this.panel;
    if (!panel) return;

    this.el.classList.toggle(UP, this.preferUp);
    this.el.classList.toggle(END, this.preferEnd);

    this.flip(UP, this.preferUp, this.preferUp ? 'top' : 'bottom', this.preferUp ? 'bottom' : 'top');
    this.flip(END, this.preferEnd, this.preferEnd ? 'left' : 'right', this.preferEnd ? 'right' : 'left');
  }

  flip(klass, preferred, side, otherSide) {
    const panel = this.panel;
    const before = overflow(panel)[side];
    if (before === 0) return;
    this.el.classList.toggle(klass, !preferred);
    if (overflow(panel)[otherSide] >= before) this.el.classList.toggle(klass, preferred);
  }

  /* ---------------------------------------------------------------- states */

  show(trigger = null) {
    if (this.el.open) return false;
    if (!emit(this.el, 'dropdown:show', { trigger })) return false;
    for (const other of [...live]) if (other !== this) other.hide();
    this.el.open = true;
    this.afterOpen();
    emit(this.el, 'dropdown:shown', { trigger });
    return true;
  }

  hide(trigger = null) {
    if (!this.el.open) return false;
    if (!emit(this.el, 'dropdown:hide', { trigger })) return false;

    // Focus cannot be left on an element that is about to stop rendering.
    const panel = this.panel;
    const held = panel && panel.contains(document.activeElement);

    this.el.open = false;
    this.afterClose();
    if (held && this.summary) this.summary.focus({ preventScroll: true });
    emit(this.el, 'dropdown:hidden', { trigger });
    return true;
  }

  toggle(trigger = null) {
    return this.el.open ? this.hide(trigger) : this.show(trigger);
  }

  /*
   * The document listeners exist only while the menu is open. A page with
   * forty dropdowns otherwise has forty pointer listeners for the one that is
   * open, and they are in the capture phase so a click on a menu item is seen
   * before the item acts on it.
   */
  afterOpen() {
    live.add(this);
    this.place();
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onEscape, true);
  }

  afterClose() {
    live.delete(this);
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onEscape, true);
    this.el.classList.toggle(UP, this.preferUp);
    this.el.classList.toggle(END, this.preferEnd);
  }

  /* -------------------------------------------------------------- the user */

  onClick(event) {
    const summary = this.summary;
    if (summary && (event.target === summary || summary.contains(event.target))) {
      // Taken from the browser so that `show` is cancelable and so that the
      // menu is placed before it is painted rather than after.
      event.preventDefault();
      this.toggle(summary);
      return;
    }
    // A chosen item closes the menu and keeps its own default — a link still
    // follows, a button still submits.
    const item = this.items.find((i) => i === event.target || i.contains(event.target));
    if (item) this.hide(item);
  }

  onKey(event) {
    const summary = this.summary;
    const items = this.items;

    if (summary && (event.target === summary || summary.contains(event.target))) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (!this.el.open) this.show(summary);
      const first = event.key === 'ArrowDown' ? items[0] : items[items.length - 1];
      if (first) first.focus({ preventScroll: true });
      return;
    }

    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    let next;
    switch (event.key) {
      case 'ArrowDown': next = (at + 1) % items.length; break;
      case 'ArrowUp': next = (at - 1 + items.length) % items.length; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  }

  /* `open` changed without going through show()/hide(). Keep up. */
  onToggle() {
    if (this.el.open && !live.has(this)) this.afterOpen();
    else if (!this.el.open && live.has(this)) this.afterClose();
  }

  destroy() {
    this.afterClose();
  }
}
