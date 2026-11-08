/*
 * Offcanvas (PLAN §11.10).
 *
 * The modal's dialog anchored to an edge, so this is the modal's class with
 * two hooks filled in. Escape, the focus trap, the inert page, the top layer,
 * the reference-counted scroll lock and the ░ dim are all inherited, already
 * written and already specced; what is left is the slide.
 *
 * The slide steps --wt-slide from the panel's own cell count down to zero
 * through stepPlan(), the same scheduler a placeholder settles on and a
 * collapse opens with — so the number of cells to cross changes how many move
 * per tick rather than how long the drawer takes, and every frame is a
 * whole-cell translate. components.css picks the axis and the sign per
 * variant, so nothing here knows which edge it is on.
 *
 * One thing the inheritance broke and had to be overridden: the modal puts its
 * dim inside the dialog, because a fixed child of a dialog is in the top layer
 * with it. A transform makes the dialog the containing block for its fixed
 * descendants, so a child dim would slide along with the panel it is supposed
 * to be sitting behind. A drawer's dim is a sibling in the body instead — under
 * the dialog, which is in the top layer, and over everything else.
 */

import { Modal } from './modal.js';
import { animate, motionEnabled, tickMs, stepPlan } from './lib/motion.js';
import { floorCells, floorRows } from './lib/cells.js';

const DEFAULT_DURATION = 240;

export class Offcanvas extends Modal {
  static selector = 'dialog.offcanvas';

  constructor(el) {
    super(el);
    this.handle = null;

    // Escape on a <dialog> fires `cancel` and then closes it, which would make
    // a drawer vanish rather than leave. Taking the cancel turns it into an
    // ordinary hide(), slide and all.
    el.addEventListener('cancel', (event) => {
      if (this.closing || !motionEnabled()) return;
      event.preventDefault();
      this.hide();
    });
  }

  get component() {
    return 'offcanvas';
  }

  /** Whether a slide is running. */
  get sliding() {
    return this.handle !== null;
  }

  /** Rows for a top or bottom drawer, cells for a side one. */
  get vertical() {
    return this.el.classList.contains('offcanvas-top') || this.el.classList.contains('offcanvas-bottom');
  }

  /**
   * How far off its edge the drawer starts: its own size, in whole cells or
   * rows.
   *
   * Measured rather than read off --cells, because the stylesheet clamps a
   * drawer declared wider than the terminal, and a clamped drawer has to slide
   * the distance it actually occupies. The measurement goes through
   * lib/cells.js, which keeps every pixel read in the layer in one module.
   */
  get distance() {
    const box = this.el.getBoundingClientRect();
    return this.vertical ? floorRows(box.height) : floorCells(box.width);
  }

  /* --------------------------------------------------------------- the dim */

  /*
   * A sibling rather than a child (see the note above). It is removed by the
   * modal's afterClose(), which only needs `this.shade` to be the element.
   */
  mountShade() {
    if (this.shade && this.shade.isConnected) return this.shade;
    const shade = document.createElement('span');
    shade.className = 'backdrop';
    shade.setAttribute('aria-hidden', 'true');
    document.body.append(shade);
    this.shade = shade;
    return shade;
  }

  /* --------------------------------------------------------------- sliding */

  enter(done) {
    this.slide(this.distance, 0, done);
  }

  leave(done) {
    this.slide(0, this.distance, done);
  }

  slide(from, to, done) {
    this.stop();
    if (!motionEnabled() || from === to) {
      this.clear();
      done();
      return;
    }

    this.offset(from);
    const duration = Number(this.el.getAttribute('data-wt-duration')) || DEFAULT_DURATION;
    const ticks = Math.max(1, Math.round(duration / tickMs()));
    const plan = stepPlan(Math.abs(to - from), ticks);
    const sign = to > from ? 1 : -1;
    let at = from;

    this.handle = animate({
      ticks,
      onTick: (i) => {
        at += sign * (plan[i] || 0);
        this.offset(at);
      },
      onDone: () => {
        this.handle = null;
        this.clear();
        done();
      },
    });
  }

  offset(cells) {
    this.el.style.setProperty('--wt-slide', String(Math.max(0, cells)));
  }

  /** Back to no transform at all, so a drawer at rest is a plain fixed box. */
  clear() {
    this.el.style.removeProperty('--wt-slide');
    if (!this.el.getAttribute('style')) this.el.removeAttribute('style');
  }

  stop() {
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
  }
}
