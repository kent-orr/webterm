/*
 * Building a box.
 *
 * CSS gives an element two pseudo-elements and a glyph border needs four
 * strips, so a .box carries one empty <span class="box-edge"> that supplies
 * the other two (box.css). Leave it out and the box draws its top and left
 * edges and nothing else.
 *
 * In hand-written markup that is a visible reminder. In generated markup it is
 * a bug that reaches production, because the author never typed the box and
 * has nothing to forget. So every box the behavior layer creates comes from
 * here, and behavior.spec.js puts the result through the same pixel sweep as a
 * box typed into the page: four corners, continuous runs.
 */

/**
 * Give `el` a .box-edge if it has none. Used on adoption too: a toast or a
 * dialog in the initial HTML is owned by the behavior layer once it is
 * mounted, so a missing edge is repaired rather than left as a reminder.
 */
export function ensureEdge(el) {
  if (!el.querySelector(':scope > .box-edge')) {
    const edge = document.createElement('span');
    edge.className = 'box-edge';
    el.prepend(edge);
  }
  return el;
}

/**
 * A .box, assembled.
 *
 *   createBox({ classes: ['box-round'], title: 'hosts', text: 'alpha' })
 *
 * `text` is escaped; `html` is not, and is there for callers that need markup
 * inside the box. `cells` sets --cells, which the component's own CSS turns
 * into a width — the width itself is never written here, because appearance
 * belongs to the grid layer (PLAN §11.1).
 */
export function createBox({
  tag = 'div',
  classes = [],
  title = null,
  titleRight = false,
  text = null,
  html = null,
  cells = null,
  attrs = null,
} = {}) {
  const el = document.createElement(tag);
  el.classList.add('box');
  for (const c of classes) if (c) el.classList.add(c);

  // The edge first, so later children paint over the border runs it owns.
  ensureEdge(el);

  if (title !== null) {
    const label = document.createElement('span');
    label.className = titleRight ? 'box-title box-title-right' : 'box-title';
    label.textContent = title;
    el.append(label);
  }

  if (html !== null) el.insertAdjacentHTML('beforeend', html);
  else if (text !== null) {
    const p = document.createElement('p');
    p.textContent = text;
    el.append(p);
  }

  if (cells !== null) el.style.setProperty('--cells', String(cells));

  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);

  return el;
}

/** The title element of a box, creating it if the box has none. */
export function boxTitle(el, titleRight = false) {
  let label = el.querySelector(':scope > .box-title');
  if (!label) {
    label = document.createElement('span');
    label.className = titleRight ? 'box-title box-title-right' : 'box-title';
    const edge = el.querySelector(':scope > .box-edge');
    if (edge) edge.after(label);
    else el.prepend(label);
  }
  return label;
}
