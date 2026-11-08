/*
 * The event convention (PLAN §11.2 rule 3).
 *
 * Every component announces what it is about to do and what it has done, on
 * the component's own element, bubbling, namespaced `wt:`. The before-event is
 * cancelable, so "may I show?" is one call and one convention rather than a
 * per-component option:
 *
 *   if (!emit(el, 'modal:show')) return;
 *
 * It lives in its own module because the entry imports the components and the
 * components need this — importing it from the entry would make that circular,
 * and a circular import that happens to work is a thing a later reader has to
 * verify rather than read.
 */

/**
 * Dispatch `wt:<type>` on `el` with `detail`. Returns false when a listener
 * called preventDefault(), which means the caller must not proceed.
 */
export function emit(el, type, detail = null) {
  return el.dispatchEvent(new CustomEvent(`wt:${type}`, {
    bubbles: true,
    cancelable: true,
    detail,
  }));
}
