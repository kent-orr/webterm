/*
 * Collapse (PLAN §11.10).
 *
 * A disclosure is a <details>, and that decision is most of this module. The
 * trigger semantics, the keyboard, the `open` state, the accessible name and
 * the exclusive-accordion grouping are the browser's, which leaves one job
 * here: the body's height steps in *whole rows on the tick*, so the page below
 * an opening region never sits mid-row. Every other framework tweens a pixel
 * height, which is correct on two frames out of forty.
 *
 * Two consequences of letting the browser own the state, both of which cost a
 * few lines each and would be bugs if they were left out:
 *
 *   - a click on the summary has to be intercepted, because the browser would
 *     otherwise set `open` itself and there would be nothing to animate; and
 *     the close has to hold `open` until the last row is gone, since a closed
 *     <details> does not render its content at all;
 *   - `open` can change with no click to intercept. <details name="x"> is an
 *     exclusive accordion, so opening one closes its sibling directly. The
 *     `toggle` listener is what notices, the same way the modal's `close`
 *     listener notices Escape.
 */

import { animate, motionEnabled, tickMs, stepPlan } from './lib/motion.js';
import { roundRows } from './lib/cells.js';
import { emit } from './lib/events.js';

const STEPPING = 'collapse-stepping';
const DEFAULT_DURATION = 240;

export class Collapse {
  static selector = 'details.collapse';

  constructor(el) {
    this.el = el;
    this.handle = null;
    // 1 opening, -1 closing, 0 at rest. A toggle mid-animation reverses
    // rather than restarting the direction it is already going.
    this.dir = 0;
    this.ensureBody();

    el.addEventListener('click', (event) => this.onClick(event));
    el.addEventListener('toggle', () => this.onToggle());
  }

  /*
   * The clamp needs one element to clamp, so content that was written without
   * a wrapper gets one. The same repair as ensureEdge() in lib/box.js and for
   * the same reason: in hand-written markup a missing wrapper is a visible
   * reminder, and in generated markup it is a bug nobody can see.
   */
  ensureBody() {
    const el = this.el;
    const existing = el.querySelector(':scope > .collapse-body');
    if (existing) return existing;
    const body = document.createElement('div');
    body.className = 'collapse-body';
    const summary = el.querySelector(':scope > summary');
    body.append(...[...el.childNodes].filter((n) => n !== summary));
    el.append(body);
    return body;
  }

  get body() {
    return this.el.querySelector(':scope > .collapse-body');
  }

  get open() {
    return this.el.open;
  }

  /** Whether a step animation is running. */
  get animating() {
    return this.handle !== null;
  }

  /** The body's height in whole rows, as it stands right now. */
  get rows() {
    const body = this.body;
    return body ? roundRows(body.getBoundingClientRect().height) : 0;
  }

  /* --------------------------------------------------------------- stepping */

  clamp(rows) {
    this.el.classList.add(STEPPING);
    this.el.style.setProperty('--rows', String(Math.max(0, rows)));
  }

  /** Back to a natural height, with none of the animation's scaffolding. */
  reset() {
    this.el.classList.remove(STEPPING);
    this.el.style.removeProperty('--rows');
    if (!this.el.getAttribute('style')) this.el.removeAttribute('style');
  }

  stop() {
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
    this.dir = 0;
    return this;
  }

  /*
   * Step `--rows` from `from` to `to`.
   *
   * The tick count comes from the duration, not from the row count, so a
   * twenty-row region opens in the same time as a two-row one — several rows
   * per tick instead of one. stepPlan() is the same scheduler the placeholder
   * settles on (§11.5).
   */
  run(from, to, onDone) {
    if (!motionEnabled()) {
      onDone();
      return;
    }
    const duration = Number(this.el.getAttribute('data-wt-duration')) || DEFAULT_DURATION;
    const ticks = Math.max(1, Math.round(duration / tickMs()));
    const plan = stepPlan(Math.abs(to - from), ticks);
    const sign = to > from ? 1 : -1;
    let rows = from;

    this.handle = animate({
      ticks,
      onTick: (i) => {
        rows += sign * (plan[i] || 0);
        this.clamp(rows);
      },
      onDone: () => {
        this.handle = null;
        onDone();
      },
    });
  }

  /* ----------------------------------------------------------------- states */

  show(trigger = null) {
    if (this.el.open && this.dir !== -1) return false;
    if (!emit(this.el, 'collapse:show', { trigger })) return false;
    this.stop();

    // A closed <details> renders nothing, so there is nothing to measure
    // until `open` is set. Set it, read the natural height with the clamp
    // off, then clamp to zero and step — all in this turn, before the frame
    // paints, so the full height never flashes.
    this.reset();
    this.el.open = true;
    const rows = this.rows;

    this.dir = 1;
    this.clamp(0);
    this.run(0, rows, () => this.settleOpen());
    return true;
  }

  hide(trigger = null) {
    if (!this.el.open || this.dir === -1) return false;
    if (!emit(this.el, 'collapse:hide', { trigger })) return false;
    this.stop();

    // Whatever is on screen is where the close starts, which is also correct
    // when this reverses an open that is still part way up.
    const rows = this.rows;
    this.dir = -1;
    this.clamp(rows);
    this.run(rows, 0, () => this.settleClosed());
    return true;
  }

  toggle(trigger = null) {
    const opening = this.dir === 1 || (this.dir === 0 && this.el.open);
    return opening ? this.hide(trigger) : this.show(trigger);
  }

  settleOpen() {
    this.dir = 0;
    this.reset();
    emit(this.el, 'collapse:shown', { rows: this.rows });
  }

  settleClosed() {
    this.dir = 0;
    this.reset();
    this.el.open = false;
    emit(this.el, 'collapse:hidden', null);
  }

  /* ---------------------------------------------------------------- browser */

  /*
   * The native summary click would set `open` itself, leaving nothing to
   * animate, so it is taken here instead — including with motion off, where
   * run() lands on the end state in this frame and the lifecycle events still
   * fire (§11.2 rule 6).
   */
  onClick(event) {
    const summary = event.target.closest ? event.target.closest('summary') : null;
    if (!summary || summary.parentElement !== this.el) return;
    event.preventDefault();
    this.toggle(summary);
  }

  /*
   * `open` changed. Either we did it, or <details name="x"> grouping did, and
   * in the second case a clamp would otherwise outlive the body it clamps.
   */
  onToggle() {
    if (this.animating) {
      if (!this.el.open) {
        this.stop();
        this.reset();
      }
      return;
    }
    this.reset();
  }

  destroy() {
    this.stop();
    this.reset();
  }
}
