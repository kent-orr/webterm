/*
 * Modals (PLAN §11.7).
 *
 * Native <dialog> with showModal(), which is why this module is short: the
 * focus trap, Escape, the inert background and the top-layer stacking are all
 * the browser's work. What is left is the part a character grid makes
 * peculiar.
 *
 * The backdrop, for instance. A dim overlay here is a run of block-shade
 * glyphs painted in --bg (overlay.css), and ::backdrop cannot hold one — it
 * takes no generated content. But a position: fixed child of a dialog *is* in
 * the top layer with it, and it covers the viewport. So the shade goes inside
 * the dialog, first in paint order, and the dialog's own --bg background hides
 * the part of it that falls within the dialog's own rect. The glyphs are the
 * same colour as what is behind them there, so there is nothing to hide.
 */

import { createBox, ensureEdge } from './lib/box.js';
import { emit } from './lib/events.js';
import { lockScroll, unlockScroll } from './lib/scroll.js';

export class Modal {
  static selector = 'dialog.modal';

  constructor(el) {
    this.el = el;
    this.opener = null;
    this.shade = null;
    this.static = el.hasAttribute('data-wt-static');
    this.cleaned = true;
    ensureEdge(el);

    // A <dialog> closed by Escape or by a form never passes through hide(),
    // so the bookkeeping also hangs off the element's own close event. That
    // event is asynchronous, though, which is why afterClose() is idempotent
    // and hide() calls it directly: a scroll lock released a task later is a
    // scroll lock that is still held when the next dialog opens.
    el.addEventListener('close', () => this.afterClose());
    el.addEventListener('click', (event) => this.onBackdropClick(event));
  }

  get open() {
    return this.el.open;
  }

  /*
   * A click on a modal <dialog> that lands on the dialog element itself —
   * rather than on anything inside it — is a click on the backdrop: the
   * dialog's box fills its own rect, so there is nothing else it can be.
   */
  onBackdropClick(event) {
    if (this.static || event.target !== this.el) return;
    const r = this.el.getBoundingClientRect();
    const inside = event.clientX >= r.left && event.clientX <= r.right
      && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) this.hide();
  }

  show(opener = null) {
    if (this.el.open) return false;
    if (!emit(this.el, 'modal:show', { opener })) return false;
    this.opener = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    if (!this.el.querySelector(':scope > .backdrop')) {
      const shade = document.createElement('span');
      shade.className = 'backdrop';
      shade.setAttribute('aria-hidden', 'true');
      // First child: it paints under everything else the dialog draws, and
      // over the dialog's own background, where it is invisible anyway.
      this.el.prepend(shade);
      this.shade = shade;
    }

    this.cleaned = false;
    lockScroll();
    this.el.showModal();
    emit(this.el, 'modal:shown', { opener: this.opener });
    return true;
  }

  hide(trigger = null) {
    if (!this.el.open) return false;
    if (!emit(this.el, 'modal:hide', { trigger })) return false;
    // A dismiss control may carry the value the caller is waiting for.
    if (trigger && trigger.value) this.el.returnValue = trigger.value;
    this.el.close(this.el.returnValue || '');
    this.afterClose();
    return true;
  }

  /*
   * Runs however the dialog closed: hide(), Escape, or a form submit. Once
   * only — the close event arrives after hide() has already done this.
   */
  afterClose() {
    if (this.cleaned) return;
    this.cleaned = true;
    unlockScroll();
    if (this.shade) {
      this.shade.remove();
      this.shade = null;
    }
    const opener = this.opener;
    this.opener = null;
    if (opener && document.body.contains(opener)) opener.focus();
    emit(this.el, 'modal:hidden', { returnValue: this.el.returnValue });
  }

  toggle(opener = null) {
    return this.el.open ? this.hide(opener) : this.show(opener);
  }
}

/*
 * A dialog built on the spot, used by confirm() and prompt(). It is removed
 * from the document once it closes, because a question asked twice should be
 * asked with a fresh dialog rather than a reused one.
 */
function buildDialog({ title, cells, body, actions }) {
  const el = createBox({
    tag: 'dialog',
    classes: ['modal'],
    title,
    cells,
  });
  el.append(body);
  const row = document.createElement('div');
  row.className = 'modal-actions';
  row.append(...actions);
  el.append(row);
  document.body.append(el);
  return el;
}

function actionButton(label, { value = '', level = null, autofocus = false } = {}) {
  const btn = document.createElement('button');
  btn.className = level ? `btn btn-${level}` : 'btn';
  btn.setAttribute('data-wt-dismiss', 'modal');
  btn.value = value;
  btn.textContent = label;
  if (autofocus) btn.autofocus = true;
  return btn;
}

/**
 * Ask a yes/no question.
 *
 *   if (await Webterm.confirm('Drop replica charlie?')) …
 *
 * A terminal interface asks small questions constantly, and writing a
 * <dialog> for each one is not worth it.
 */
export function confirm(message, { title = 'confirm', cells = 48, yes = 'Yes', no = 'Cancel', level = 'error' } = {}) {
  const body = document.createElement('p');
  body.className = 'modal-body';
  body.textContent = message;

  const el = buildDialog({
    title,
    cells,
    body,
    actions: [
      actionButton(yes, { value: 'yes', level }),
      actionButton(no, { value: 'no', autofocus: true }),
    ],
  });

  const modal = new Modal(el);
  return new Promise((resolve) => {
    el.addEventListener('close', () => {
      const answer = el.returnValue === 'yes';
      el.remove();
      resolve(answer);
    }, { once: true });
    modal.show();
  });
}

/**
 * Ask for one value. Resolves to the string, or to null if dismissed.
 *
 *   const host = await Webterm.prompt({ label: 'host', cells: 24 })
 */
export function prompt({
  message = null, label = '', value = '', cells = 48, fieldCells = 24, title = 'input', ok = 'OK', cancel = 'Cancel',
} = {}) {
  const body = document.createElement('div');
  if (message) {
    const p = document.createElement('p');
    p.className = 'modal-body';
    p.textContent = message;
    body.append(p);
  }
  const row = document.createElement('div');
  row.className = 'form-row';
  const name = document.createElement('span');
  name.className = 'form-label';
  name.textContent = label;
  const field = document.createElement('input');
  field.className = `field field-${fieldCells}`;
  field.value = value;
  field.autofocus = true;
  row.append(name, field);
  body.append(row);

  const el = buildDialog({
    title,
    cells,
    body,
    actions: [
      actionButton(ok, { value: 'ok' }),
      actionButton(cancel, { value: 'cancel' }),
    ],
  });

  const modal = new Modal(el);
  return new Promise((resolve) => {
    el.addEventListener('close', () => {
      const answer = el.returnValue === 'ok' ? field.value : null;
      el.remove();
      resolve(answer);
    }, { once: true });
    // Enter in the field is the same as pressing OK.
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        el.returnValue = 'ok';
        modal.hide();
      }
    });
    modal.show();
  });
}
