/*
 * Toasts (PLAN §11.6).
 *
 * A toast is a .box in a stack pinned to a corner, so its border, its title
 * and its tint are all things the grid layer already draws. What this module
 * adds is the part that is actually behavior: a lifetime, a queue, and a
 * reveal that does not move the box while it runs.
 *
 * Two details are worth reading before the code:
 *
 *   - The message types in by moving characters from a hidden tail into a
 *     shown head, rather than by appending to a string. Appending changes the
 *     glyph sequence, which changes the wrapping, which changes the height —
 *     a toast that grew a row halfway through typing would undo the one thing
 *     this framework exists for. Hiding the tail keeps the layout identical
 *     at every frame.
 *
 *   - The lifetime is a delay(), not an animate(). A reader who asks for
 *     reduced motion wants less movement, not less time to read; routing the
 *     timeout through animate() would dismiss every toast in the frame it
 *     appeared. The typing is the part that stops.
 */

import { animate, delay, motionEnabled, tickMs } from './lib/motion.js';
import { createBox, ensureEdge, boxTitle } from './lib/box.js';
import { emit } from './lib/events.js';
import { screenCols } from './lib/cells.js';
import { attach } from './lib/registry.js';

const POSITIONS = ['tl', 'tr', 'bl', 'br'];
const DEFAULT_POSITION = 'br';
const TYPE_CELLS_PER_TICK = 3;

/** Visible toasts, oldest first, and the ones waiting for room. */
const visible = [];
const queue = [];

let config = { toastMax: 4, toastCells: 40, toastTimeout: 6000 };

/** Called by the entry so the two share one config object. */
export function useConfig(shared) {
  config = shared;
}

/**
 * The stack for a corner, created on first use. It is a live region: a toast
 * that appears without being announced is a toast a screen reader user never
 * receives.
 */
export function toastStack(position = DEFAULT_POSITION) {
  const pos = POSITIONS.includes(position) ? position : DEFAULT_POSITION;
  const selector = `.toast-stack.toast-stack-${pos}`;
  let stack = document.querySelector(selector);
  if (stack) return stack;
  stack = document.createElement('div');
  stack.className = `toast-stack toast-stack-${pos}`;
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  document.body.append(stack);
  return stack;
}

export class Toast {
  static selector = '.toast';

  constructor(el, options = {}) {
    this.el = el;
    this.level = options.level || readLevel(el);
    this.count = 1;
    this.timer = null;
    this.typing = null;
    this.message = options.message ?? el.querySelector('.toast-body')?.textContent ?? '';

    // A toast in the initial HTML has no options, so its lifetime comes from
    // the markup: data-wt-timeout, or the configured default.
    const declared = Number(el.getAttribute('data-wt-timeout'));
    this.timeout = options.timeout !== undefined ? options.timeout
      : (Number.isFinite(declared) && el.hasAttribute('data-wt-timeout') ? declared : config.toastTimeout);

    ensureEdge(el);
    this.adopt();

    // §11.1: a server-rendered toast is adopted, not rebuilt. It is already on
    // screen, so it does not type itself in — but it joins the stack's
    // bookkeeping and starts its clock, or it would be the one toast on the
    // page that never leaves.
    if (options.message === undefined && el.closest('.toast-stack')) {
      visible.push(this);
      this.startTimer();
    }
  }

  /*
   * Everything a toast needs that the markup may not have brought: a dismiss
   * control, the countdown strip, hover handling, and — for an error — a role
   * that interrupts rather than waiting its turn in the polite queue.
   */
  adopt() {
    const el = this.el;
    if (!el.querySelector(':scope > .toast-close')) {
      const close = document.createElement('button');
      close.className = 'btn toast-close';
      close.setAttribute('data-wt-dismiss', 'toast');
      close.setAttribute('aria-label', 'dismiss');
      // It sits in the top border row and is opaque, so it interrupts the run
      // the way a title does. The border spec reads this marker.
      close.setAttribute('data-wt-gap', '');
      close.textContent = 'x';
      el.append(close);
    }
    if (!el.querySelector(':scope > .toast-timer')) {
      const timer = document.createElement('span');
      timer.className = 'toast-timer';
      timer.setAttribute('aria-hidden', 'true');
      el.append(timer);
    }
    if (this.level === 'error') el.setAttribute('role', 'alert');
    el.addEventListener('mouseenter', () => this.hold());
    el.addEventListener('mouseleave', () => this.release());
    el.addEventListener('focusin', () => this.hold());
    el.addEventListener('focusout', () => this.release());
  }

  get body() {
    return this.el.querySelector(':scope > .toast-body');
  }

  /* ------------------------------------------------------------- the reveal */

  /*
   * Split the message into a shown head and a hidden tail, then move
   * characters across. Under reduced motion there is no split at all.
   */
  type() {
    const body = this.body;
    if (!body) return;
    const message = this.message;
    if (!motionEnabled()) {
      body.textContent = message;
      return;
    }
    body.textContent = '';
    const shown = document.createElement('span');
    shown.className = 'toast-shown';
    const rest = document.createElement('span');
    rest.className = 'toast-rest';
    rest.textContent = message;
    body.append(shown, rest);

    const chars = [...message];
    const ticks = Math.ceil(chars.length / TYPE_CELLS_PER_TICK);
    let at = 0;
    this.typing = animate({
      ticks,
      onTick: () => {
        at = Math.min(chars.length, at + TYPE_CELLS_PER_TICK);
        shown.textContent = chars.slice(0, at).join('');
        rest.textContent = chars.slice(at).join('');
      },
      onDone: () => {
        this.typing = null;
        body.textContent = message;
      },
    });
  }

  /* ------------------------------------------------------------ the lifetime */

  startTimer() {
    if (!(this.timeout > 0)) return;
    const strip = this.el.querySelector(':scope > .toast-timer');
    const cells = Number(getComputedStyle(this.el).getPropertyValue('--cells')) || 0;
    // The strip covers the border between the two corner cells.
    const span = Math.max(0, cells - 2);
    const ticks = Math.max(1, Math.round(this.timeout / tickMs()));
    this.timer = delay({
      ms: this.timeout,
      onTick: (i) => {
        if (strip) strip.style.setProperty('--wt-timer-cells', String(Math.round(((i + 1) / ticks) * span)));
      },
      onDone: () => {
        this.timer = null;
        this.hide();
      },
    });
  }

  /** Hold the countdown: a toast under the cursor must not time out. */
  hold() {
    if (this.timer) this.timer.pause();
    return this;
  }

  release() {
    if (this.timer) this.timer.resume();
    return this;
  }

  /** Another copy of the same message: count it rather than stack it. */
  repeat() {
    this.count += 1;
    boxTitle(this.el).textContent = `${this.level} ×${this.count}`;
    if (this.timer) {
      this.timer.cancel();
      this.timer = null;
    }
    this.startTimer();
    return this;
  }

  show() {
    if (!emit(this.el, 'toast:show', { message: this.message, level: this.level })) return false;
    this.type();
    this.startTimer();
    emit(this.el, 'toast:shown', { message: this.message, level: this.level });
    return true;
  }

  hide() {
    if (!emit(this.el, 'toast:hide', { message: this.message, level: this.level })) return false;
    if (this.timer) this.timer.cancel();
    if (this.typing) this.typing.cancel();
    this.timer = null;
    this.typing = null;
    const index = visible.indexOf(this);
    if (index >= 0) visible.splice(index, 1);
    this.el.remove();
    emit(document.documentElement, 'toast:hidden', { message: this.message, level: this.level });
    pump();
    return true;
  }
}

function readLevel(el) {
  for (const level of ['error', 'warn', 'ok', 'info']) {
    if (el.classList.contains(`toast-${level}`)) return level;
  }
  return 'info';
}

/* Show whatever the cap has room for. */
function pump() {
  while (visible.length < config.toastMax && queue.length > 0) {
    const next = queue.shift();
    place(next);
  }
}

function place({ toast, stack }) {
  stack.append(toast.el);
  visible.push(toast);
  if (!toast.show()) {
    const index = visible.indexOf(toast);
    if (index >= 0) visible.splice(index, 1);
    toast.el.remove();
  }
}

/**
 * Show a toast.
 *
 *   Webterm.toast('replica charlie is behind', { level: 'warn' })
 *
 * Returns the Toast, or null if a listener prevented wt:toast:show. An
 * identical consecutive message is counted on the existing toast rather than
 * stacked, because five copies of "disk is full" is noise and "disk is full
 * ×5" is information.
 */
export function toast(message, options = {}) {
  const level = options.level || 'info';
  const position = options.stack || DEFAULT_POSITION;
  const stack = toastStack(position);

  const newest = visible[visible.length - 1];
  if (newest && newest.message === message && newest.level === level) {
    return newest.repeat();
  }

  // Clamp to the screen: a toast wider than the terminal is a toast with a
  // border off the edge of it.
  const wanted = options.cells || config.toastCells;
  const cells = Math.max(8, Math.min(wanted, screenCols() - 2));

  const el = createBox({
    classes: ['toast', `toast-${level}`],
    title: level,
    cells,
  });
  const body = document.createElement('p');
  body.className = 'toast-body';
  body.textContent = message;
  el.append(body);

  // In the registry, so a later init() adopts it rather than mounting a
  // second instance on the same element.
  const instance = attach('toast', el, new Toast(el, { ...options, level, message }));

  if (visible.length >= config.toastMax) {
    queue.push({ toast: instance, stack });
    return instance;
  }

  place({ toast: instance, stack });
  return document.body.contains(el) ? instance : null;
}

/** Dismiss everything, visible and queued. Mostly for a spec or a route change. */
export function clearToasts() {
  queue.length = 0;
  for (const instance of [...visible]) {
    if (instance.timer) instance.timer.cancel();
    if (instance.typing) instance.typing.cancel();
    instance.el.remove();
  }
  visible.length = 0;
}

/** How many toasts are waiting for room. */
export function toastQueue() {
  return queue.length;
}
