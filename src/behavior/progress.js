/*
 * Loading state (PLAN §11.4).
 *
 * Almost nothing is here, and that is deliberate: the spinner and the
 * indeterminate bar animate in CSS, so they keep moving while the main thread
 * is busy — which is the one moment a loading indicator exists for. What is
 * left needs a language: turning a value into a whole number of cells, and
 * swapping an element into a loading state without resizing it.
 */

const EPS = 1e-9;

/**
 * Whole cells for `value` out of `max` on a `cells`-wide bar.
 *
 * Floor, with two exceptions that stop a bar lying in either direction: it
 * never reads empty while there is progress, and it never reads full until
 * there is none left. On a bar wide enough to say so — two cells or more —
 * both hold at once.
 */
export function fillCells(value, max, cells) {
  if (!(cells > 0)) return 0;
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  let fill = Math.floor(frac * cells + EPS);
  if (frac < 1) fill = Math.min(fill, cells - 1);
  if (frac > 0) fill = Math.max(fill, 1);
  return fill;
}

/**
 * A progress bar.
 *
 *   Webterm.getOrCreate('progress', el).set(3, 8)
 *
 * or, with no JS at all, `data-wt-progress="0.37"` on the element — which is
 * watched, so a server-rendered swap of that attribute is the whole API for
 * htmx or Shiny.
 */
export class Progress {
  static selector = '.progress';

  constructor(el) {
    this.el = el;
    this.max = Number(el.getAttribute('data-wt-max')) || 1;
    this.value = 0;
    this.indeterminate = el.classList.contains('progress-indeterminate');

    el.setAttribute('role', 'progressbar');
    if (this.indeterminate) {
      el.removeAttribute('aria-valuenow');
      el.removeAttribute('aria-valuemin');
      el.removeAttribute('aria-valuemax');
    } else {
      this.observe();
      this.readAttribute();
    }
  }

  /** Cells in the track, from --cells. */
  get cells() {
    return Number(getComputedStyle(this.el).getPropertyValue('--cells')) || 0;
  }

  /** The filled cells right now. */
  get fill() {
    return Number(getComputedStyle(this.el).getPropertyValue('--fill')) || 0;
  }

  /** Set the value, writing a whole number of cells and the aria state. */
  set(value, max = this.max) {
    if (this.indeterminate) return this;
    this.value = value;
    this.max = max;
    this.el.style.setProperty('--fill', String(fillCells(value, max, this.cells)));
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(max));
    this.el.setAttribute('aria-valuenow', String(value));
    return this;
  }

  /** A fraction of 1, for the attribute form. */
  setFraction(fraction) {
    return this.set(fraction, 1);
  }

  readAttribute() {
    const raw = this.el.getAttribute('data-wt-progress');
    if (raw === null) return this;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return this;
    const max = Number(this.el.getAttribute('data-wt-max')) || 1;
    return this.set(value, max);
  }

  observe() {
    this.observer = new MutationObserver(() => this.readAttribute());
    this.observer.observe(this.el, {
      attributes: true,
      attributeFilter: ['data-wt-progress', 'data-wt-max'],
    });
    return this;
  }

  destroy() {
    if (this.observer) this.observer.disconnect();
  }
}

/*
 * The loading state.
 *
 * The content is hidden, not removed: a button that swaps its label for a
 * spinner changes width under the cursor, and a box that empties collapses.
 * So the children move into one .loading-label wrapper that goes
 * `visibility: hidden`, and the host keeps every cell it had.
 *
 * A box's edge span and title stay outside the wrapper — the border and the
 * title are the frame, not the content, and hiding them would leave a box
 * drawing two of its four edges.
 */
const SKIP = ['box-edge', 'box-title'];

function wrapContent(el) {
  let label = el.querySelector(':scope > .loading-label');
  if (label) return label;
  label = document.createElement('span');
  label.className = 'loading-label';
  label.dataset.wtOwn = '1';
  const move = [];
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && SKIP.some((c) => node.classList.contains(c))) continue;
    move.push(node);
  }
  el.append(label);
  label.append(...move);
  return label;
}

function unwrapContent(el) {
  const label = el.querySelector(':scope > .loading-label');
  if (!label || label.dataset.wtOwn !== '1') return;
  label.replaceWith(...label.childNodes);
}

/**
 * Put `el` into, or out of, its loading state.
 *
 *   Webterm.setLoading(button, true)
 *
 * Idempotent, and it removes only the nodes it added, so an element that was
 * authored in the loading state (§11.1) keeps its own.
 */
export function setLoading(el, on = true, { frames = null } = {}) {
  if (on) {
    if (el.classList.contains('loading')) return el;
    wrapContent(el);
    if (!el.querySelector(':scope > .spin')) {
      const spin = document.createElement('span');
      const set = frames || el.getAttribute('data-wt-spin') || 'quad';
      spin.className = `spin spin-${set}`;
      spin.dataset.wtOwn = '1';
      spin.setAttribute('aria-hidden', 'true');
      el.append(spin);
    }
    el.classList.add('loading');
    el.setAttribute('aria-busy', 'true');
    // A button that can be pressed again while it works is a double submit.
    if (el.tagName === 'BUTTON' && !el.disabled) {
      el.dataset.wtReenable = '1';
      el.disabled = true;
    }
    return el;
  }

  if (!el.classList.contains('loading')) return el;
  el.classList.remove('loading');
  el.removeAttribute('aria-busy');
  const spin = el.querySelector(':scope > .spin');
  if (spin && spin.dataset.wtOwn === '1') spin.remove();
  unwrapContent(el);
  if (el.dataset.wtReenable === '1') {
    el.disabled = false;
    delete el.dataset.wtReenable;
  }
  return el;
}

/** Whether `el` is in its loading state. */
export function isLoading(el) {
  return el.classList.contains('loading');
}
