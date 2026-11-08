/*
 * Placeholders (PLAN §11.5).
 *
 * A skeleton loader exists because content arrives late and the page must not
 * jump when it lands. Everywhere else that is approximate: a grey rounded box
 * stands in for a line of text, the text arrives at a different size, and the
 * layout shifts anyway.
 *
 * On a character grid it can be exact. The placeholder is locked to the cell
 * count of the real string, so it occupies precisely the cells the value will
 * occupy, and the value arrives by *settling into them* — every cell shows a
 * random character until its own turn comes, then takes its real one and keeps
 * it. Piece by piece out of noise, with the width constant from the first
 * frame. behavior.spec.js samples the width after every single tick, across
 * every charset and every order, and requires one distinct value.
 *
 * Two shapes:
 *
 *   .ph       a run of text that resolves character by character
 *   .ph-area  a --cells by --rows rectangle of noise that erodes to reveal
 *             whatever is behind it (a table, a chart, an ascii graphic)
 *
 * and three states, which is what makes this useful rather than decorative:
 * hold() while a fetch is in flight, resolve(text) when it lands — on a value
 * that may differ from the one the element was authored with — and fail().
 */

import { animate, motionEnabled, tickMs } from './lib/motion.js';
import { emit } from './lib/events.js';

/*
 * Only ASCII and U+2500-259F, the same rule as the spinner frames and for the
 * same measured reason: those are the ranges that occupy one cell in all three
 * bundled fonts. Katakana is what a scramble effect reaches for first and is
 * double-width, so it would break the grid it is standing in for.
 */
export const CHARSETS = {
  alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  hex: '0123456789abcdef',
  binary: '01',
  symbols: '!@#$%^&*()[]{}<>/\\|+=-_~:;.,?',
  blocks: '░▒▓█▀▄▌▐',
  mixed: 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*<>/\\|+=-_~:;.,?',
};

const DEFAULT_CHARSET = 'mixed';
const DEFAULT_DURATION = 600;
const DEFAULT_CYCLE = 2;
const FAIL_CHAR = '?';

function pick(chars) {
  return chars[Math.floor(Math.random() * chars.length)];
}

/*
 * Which cell settles first. A terminal decrypt reads left to right; 'random'
 * is the familiar scramble; 'center' and 'ends' are for a value that should
 * feel like it is snapping into place rather than being typed.
 */
function settleOrder(n, order) {
  const indices = [...Array(n).keys()];
  switch (order) {
    case 'rtl':
      return indices.reverse();
    case 'random': {
      for (let i = indices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      return indices;
    }
    case 'center': {
      const out = [];
      const mid = (n - 1) / 2;
      for (let step = 0; out.length < n; step += 1) {
        const lo = Math.floor(mid - step / 2);
        const hi = Math.ceil(mid + step / 2);
        for (const k of step % 2 === 0 ? [lo, hi] : [hi, lo]) {
          if (k >= 0 && k < n && !out.includes(k)) out.push(k);
        }
      }
      return out;
    }
    case 'ends': {
      const out = [];
      for (let k = 0; out.length < n; k += 1) {
        if (!out.includes(k)) out.push(k);
        const mirror = n - 1 - k;
        if (mirror >= 0 && !out.includes(mirror)) out.push(mirror);
      }
      return out.slice(0, n);
    }
    case 'ltr':
    default:
      return indices;
  }
}

/*
 * How many cells settle on each tick. The total number of ticks comes from the
 * duration rather than the string length, so a 60-character value resolves in
 * the same time as a 4-character one — several cells per tick instead of one.
 * A long string that settled one cell per tick would take half a minute.
 */
function settleSchedule(n, ticks) {
  const plan = new Array(ticks).fill(0);
  if (ticks <= 0) return plan;
  for (let i = 0; i < n; i += 1) {
    plan[Math.floor((i * ticks) / n)] += 1;
  }
  return plan;
}

export class Placeholder {
  static selector = '[data-wt-ph]';

  constructor(el) {
    this.el = el;
    this.area = el.classList.contains('ph-area');
    this.real = this.area ? this.readArea() : el.textContent;
    this.handle = null;
    this.mask = null;
    this.order = el.getAttribute('data-wt-order') || 'ltr';
    this.charset = CHARSETS[el.getAttribute('data-wt-charset')] || CHARSETS[DEFAULT_CHARSET];
    this.cycle = Number(el.getAttribute('data-wt-cycle')) || DEFAULT_CYCLE;
    this.holding = false;
    this.failed = false;
    this.settledSet = new Set();
    this.frame = [];

    if (el.getAttribute('data-wt-ph') === 'hold') this.hold();
    else if (el.hasAttribute('data-wt-ph')) this.start();
  }

  /*
   * An area's real content, read off the grid it is already on.
   *
   * The mask is opaque, so eroding a cell to a blank would reveal the
   * background rather than the content — the reveal has to be the *same*
   * settle as the text case: each cell takes the character that belongs to it.
   * That is only possible if the content is itself on the grid, which on a
   * character-cell framework it is: a <pre> block, an ascii table, a plot. So
   * an area reads its content as rows of cells, pads each to --cells and
   * settles into it. Content that is not text on the grid is out of scope,
   * and that is a smaller restriction here than it sounds.
   */
  readArea() {
    const source = this.el.querySelector(':scope > pre') || this.el;
    const raw = [...this.el.childNodes]
      .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && n.classList.contains('ph-mask')))
      .map((n) => n.textContent)
      .join('');
    const text = source === this.el ? raw : source.textContent;
    const cells = Number(getComputedStyle(this.el).getPropertyValue('--cells')) || 0;
    const rows = Number(getComputedStyle(this.el).getPropertyValue('--rows')) || 0;
    const lines = text.replace(/\n$/, '').split('\n');
    const out = [];
    for (let r = 0; r < rows; r += 1) {
      const line = [...(lines[r] ?? '')].slice(0, cells);
      out.push(line.join('').padEnd(cells, ' '));
    }
    return out.join('\n');
  }

  /** Cells across: the real string's length, or --cells for an area. */
  get cells() {
    if (this.area) return Number(getComputedStyle(this.el).getPropertyValue('--cells')) || 0;
    return [...(this.real ?? '')].length;
  }

  /** Rows down. One, unless this is an area. */
  get rows() {
    if (!this.area) return 1;
    return Number(getComputedStyle(this.el).getPropertyValue('--rows')) || 0;
  }

  /** What is on screen right now — the thing the specs sample. */
  get shown() {
    return this.mask ? this.mask.textContent : (this.el.textContent || '');
  }

  /** How many cells have taken their real character. */
  get settled() {
    return this.settledSet.size;
  }

  /** Whether an animation is running. */
  get live() {
    return this.handle !== null;
  }

  /* ------------------------------------------------------------ scaffolding */

  /*
   * Two children while animating: the real text, clipped out of sight but
   * present for assistive technology, and the noise, hidden from it. The
   * element's width comes from --cells, which is written once here, so the
   * scramble cannot change it and neither can a resolve onto longer text.
   */
  mount() {
    if (this.mask) return this.mask;
    const el = this.el;

    // An area's static skeleton is itself a .ph-mask (components.css paints it
    // while the mask is :empty), so take that one over rather than adding a
    // second — otherwise the skeleton outlives the reveal.
    const existing = el.querySelector(':scope > .ph-mask');
    if (existing) {
      existing.setAttribute('aria-hidden', 'true');
      this.mask = existing;
      if (!this.area) {
        el.style.setProperty('--cells', String(this.cells));
        el.classList.add('ph-fixed');
      }
      return existing;
    }

    if (!this.area) {
      el.style.setProperty('--cells', String(this.cells));
      el.classList.add('ph-fixed');
      el.textContent = '';
      const real = document.createElement('span');
      real.className = 'ph-real';
      real.textContent = this.real;
      el.append(real);
    }

    const mask = document.createElement('span');
    mask.className = 'ph-mask';
    mask.setAttribute('aria-hidden', 'true');
    el.append(mask);
    this.mask = mask;
    return mask;
  }

  /*
   * Back to plain text (or plain content), with none of the scaffolding left.
   *
   * The width lock stays. The cell count the placeholder declared is the
   * contract — it is what makes a resolve onto longer text clip instead of
   * moving the page, and what lets the value change again later without the
   * line reflowing. Only destroy() gives it back.
   */
  unmount({ keepWidth = true } = {}) {
    const el = this.el;
    if (this.mask) {
      this.mask.remove();
      this.mask = null;
    }
    if (!this.area) {
      const real = el.querySelector(':scope > .ph-real');
      if (real) real.remove();
      el.textContent = this.real;
      if (!keepWidth) {
        el.classList.remove('ph-fixed');
        el.style.removeProperty('--cells');
      }
    }
  }

  /* ---------------------------------------------------------------- drawing */

  /*
   * The real content as one flat array of cells, newlines dropped: index
   * r * cells + c. One representation for both shapes, so there is one settle
   * and one paint rather than a branch at every step.
   */
  get grid() {
    const cells = this.cells;
    const out = [];
    for (const line of (this.real ?? '').split('\n')) {
      const row = [...line].slice(0, cells);
      while (row.length < cells) row.push(' ');
      out.push(...row);
    }
    return out;
  }

  paint() {
    if (!this.mask) return;
    const cells = this.cells;
    const rows = this.rows;
    const real = this.grid;
    const lines = [];
    for (let r = 0; r < rows; r += 1) {
      let line = '';
      for (let c = 0; c < cells; c += 1) {
        const i = r * cells + c;
        line += this.settledSet.has(i) ? (real[i] ?? ' ') : pick(this.charset);
      }
      lines.push(line);
    }
    this.mask.textContent = lines.join('\n');
  }

  /*
   * Whitespace never scrambles. "alpha bravo" with its space scrambled is one
   * unreadable run, and the shape of the value — how many words, how long — is
   * most of what a reader is waiting to see. On an area it is more than that:
   * the gaps are the table's columns, so the layout appears first and the
   * values arrive into it.
   */
  presettleWhitespace() {
    const real = this.grid;
    for (let i = 0; i < real.length; i += 1) {
      if (/\s/.test(real[i])) this.settledSet.add(i);
    }
  }

  /* ----------------------------------------------------------------- states */

  /** Scramble, then settle onto the real content. */
  start() {
    return this.run(true);
  }

  /** Scramble until resolve() or fail(). */
  hold() {
    return this.run(false);
  }

  run(settle) {
    this.stop();
    this.failed = false;
    this.el.classList.remove('ph-failed');
    this.settledSet = new Set();
    this.holding = !settle;

    const total = this.cells * this.rows;
    if (total === 0) return this;

    if (!emit(this.el, 'ph:start', { text: this.real })) return this;

    // Rule 6: with motion off this is not a faster animation, it is the end
    // state now. A hold with no motion shows the content rather than noise,
    // because indefinite noise is exactly what reduced motion asks to avoid.
    if (!motionEnabled()) {
      if (settle || this.holding) return this.finish();
      return this;
    }

    this.mount();
    this.presettleWhitespace();
    this.paint();

    const order = settleOrder(total, this.order).filter((i) => !this.settledSet.has(i));
    const duration = Number(this.el.getAttribute('data-wt-duration')) || DEFAULT_DURATION;
    const ticks = Math.max(this.cycle + 1, Math.round(duration / tickMs()));
    const plan = settle ? settleSchedule(order.length, ticks - this.cycle) : [];
    let cursor = 0;

    this.handle = animate({
      ticks: settle ? ticks : Infinity,
      onTick: (i) => {
        if (settle && i >= this.cycle) {
          const due = plan[i - this.cycle] || 0;
          for (let k = 0; k < due && cursor < order.length; k += 1) {
            this.settledSet.add(order[cursor]);
            cursor += 1;
          }
        }
        this.paint();
      },
      onDone: () => {
        this.handle = null;
        if (settle) this.finish();
      },
    });
    return this;
  }

  /**
   * Settle onto `text` (or onto what the element was authored with). Text
   * longer than the placeholder is clipped rather than allowed to reflow: the
   * cell count is the contract, so a value that does not fit is a bug in the
   * placeholder's declared width, not a reason to move the page.
   */
  resolve(text = null) {
    if (text !== null && !this.area) this.real = text;
    this.stop();
    return this.finish();
  }

  /** Settle on an error marker, for a fetch that did not arrive. */
  fail() {
    this.stop();
    this.failed = true;
    if (!this.area) this.real = FAIL_CHAR.repeat(this.cells || 1);
    this.el.classList.add('ph-failed');
    return this.finish();
  }

  finish() {
    this.holding = false;
    this.unmount();
    emit(this.el, 'ph:resolved', { text: this.area ? null : this.real, failed: this.failed });
    return this;
  }

  stop() {
    if (this.handle) {
      this.handle.cancel();
      this.handle = null;
    }
    return this;
  }

  destroy() {
    this.stop();
    this.unmount({ keepWidth: false });
  }
}
