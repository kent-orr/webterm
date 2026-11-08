/*
 * Tooltip (PLAN §11.10).
 *
 * The static form is a pseudo-element and is a complete tooltip (§11.1). This
 * module replaces it with a real element for two reasons, both of which a
 * ::after cannot do: be the target of aria-describedby, and be flipped away
 * from a viewport edge. components.css stands the pseudo-element down once
 * the registry has set the ready flag, so only ever one bubble shows.
 *
 * The bubble is a child of the trigger because that is what makes it
 * positionable against the trigger's own edges — the dropdown's trick, and the
 * reason nothing here computes a coordinate. The cost is that a child is part
 * of the trigger's name-from-contents, so the bubble is aria-hidden: a node
 * referenced directly by aria-describedby is read even when it is hidden,
 * which is measured in behavior.spec.js against Chromium's own accessibility
 * tree rather than assumed.
 *
 * The open delay is time rather than motion, so it runs through delay() and
 * happens whatever the motion preference is — a tooltip that appears the
 * instant the pointer crosses it is noise, and reduced motion did not ask for
 * noise. It is also the only timer a tooltip owns, on the one clock.
 */

import { overflow } from './lib/cells.js';
import { delay } from './lib/motion.js';
import { emit } from './lib/events.js';

const OPEN = 'tip-open';
const BELOW = 'tip-below';
const END = 'tip-end';
const DEFAULT_DELAY = 120;

let seq = 0;

export class Tooltip {
  static selector = '[data-wt-tip]';

  constructor(el) {
    this.el = el;
    this.timer = null;
    el.classList.add('tip');

    // The side the author asked for; a flip measures from here (see Dropdown).
    this.preferBelow = el.classList.contains(BELOW);
    this.preferEnd = el.classList.contains(END);

    this.bubble = this.build();

    this.onEscape = (event) => {
      if (event.key !== 'Escape') return;
      this.hide();
    };

    el.addEventListener('pointerenter', () => this.wait());
    el.addEventListener('pointerleave', () => this.hide());
    // Keyboard focus opens at once: the reader arrived deliberately and has
    // already waited for the key press.
    el.addEventListener('focus', () => this.show());
    el.addEventListener('blur', () => this.hide());
  }

  build() {
    const el = this.el;
    const existing = el.querySelector(':scope > .tip-bubble');
    const bubble = existing || document.createElement('span');
    if (!existing) {
      bubble.className = 'tip-bubble';
      el.append(bubble);
    }
    seq += 1;
    if (!bubble.id) bubble.id = `wt-tip-${seq}`;
    bubble.setAttribute('role', 'tooltip');
    bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = el.getAttribute('data-wt-tip') || '';
    // Set once and kept: a referenced element is read even while it is not
    // rendered, so the description does not come and go with the pointer.
    el.setAttribute('aria-describedby', bubble.id);
    return bubble;
  }

  /** Update the text, from the attribute or from `text`. */
  text(value = null) {
    if (value !== null) this.el.setAttribute('data-wt-tip', value);
    this.bubble.textContent = this.el.getAttribute('data-wt-tip') || '';
    return this;
  }

  get open() {
    return this.el.classList.contains(OPEN);
  }

  /* ------------------------------------------------------------- placement */

  place() {
    this.el.classList.toggle(BELOW, this.preferBelow);
    this.el.classList.toggle(END, this.preferEnd);
    this.flip(BELOW, this.preferBelow, this.preferBelow ? 'bottom' : 'top', this.preferBelow ? 'top' : 'bottom');
    this.flip(END, this.preferEnd, this.preferEnd ? 'left' : 'right', this.preferEnd ? 'right' : 'left');
  }

  flip(klass, preferred, side, otherSide) {
    const before = overflow(this.bubble)[side];
    if (before === 0) return;
    this.el.classList.toggle(klass, !preferred);
    if (overflow(this.bubble)[otherSide] >= before) this.el.classList.toggle(klass, preferred);
  }

  /* ---------------------------------------------------------------- states */

  /** Open after the delay, unless the pointer leaves first. */
  wait() {
    if (this.open || this.timer) return this;
    const ms = Number(this.el.getAttribute('data-wt-delay'));
    this.timer = delay({
      ms: Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_DELAY,
      onDone: () => {
        this.timer = null;
        this.show();
      },
    });
    return this;
  }

  show(trigger = null) {
    this.cancel();
    if (this.open) return false;
    if (!emit(this.el, 'tooltip:show', { trigger })) return false;
    this.text();
    this.el.classList.add(OPEN);
    // Rendered, then measured, then flipped — all before the frame paints.
    this.place();
    document.addEventListener('keydown', this.onEscape, true);
    emit(this.el, 'tooltip:shown', { trigger });
    return true;
  }

  hide(trigger = null) {
    this.cancel();
    if (!this.open) return false;
    if (!emit(this.el, 'tooltip:hide', { trigger })) return false;
    this.el.classList.remove(OPEN);
    this.el.classList.toggle(BELOW, this.preferBelow);
    this.el.classList.toggle(END, this.preferEnd);
    document.removeEventListener('keydown', this.onEscape, true);
    emit(this.el, 'tooltip:hidden', { trigger });
    return true;
  }

  toggle(trigger = null) {
    return this.open ? this.hide(trigger) : this.show(trigger);
  }

  /** Drop a pending delay, so a tip that was never shown leaves no timer. */
  cancel() {
    if (this.timer) {
      this.timer.cancel();
      this.timer = null;
    }
    return this;
  }

  destroy() {
    this.hide();
    this.el.removeAttribute('aria-describedby');
    this.bubble.remove();
  }
}
