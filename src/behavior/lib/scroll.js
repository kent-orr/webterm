/*
 * The scroll lock (PLAN §11.3).
 *
 * Locking page scroll is ordinary everywhere else and is not ordinary here.
 * .screen rounds its width down to a whole column, so a scrollbar that comes
 * and goes changes the column count and reflows the entire page — behind the
 * dialog that caused it. Two things together stop that:
 *
 *   - reset.css reserves the scrollbar gutter permanently, and
 *   - the lock is `overflow: hidden` rather than `clip`, because hidden keeps
 *     <html> a scroll container and so keeps that gutter reserved.
 *
 * It is reference counted: two dialogs can be open at once (.modal-stack) and
 * the inner one closing must not unlock the page under the outer one.
 */

const LOCKED = 'wt-locked';

let locks = 0;

export function lockScroll() {
  locks += 1;
  if (locks === 1) document.documentElement.classList.add(LOCKED);
  return locks;
}

export function unlockScroll() {
  if (locks === 0) return 0;
  locks -= 1;
  if (locks === 0) document.documentElement.classList.remove(LOCKED);
  return locks;
}

/** How many locks are held. Mostly for a spec. */
export function scrollLocks() {
  return locks;
}
