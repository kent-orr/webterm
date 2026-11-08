/*
 * webterm, layer 4 (PLAN §11).
 *
 *   <script type="module" src="src/behavior/webterm.js"></script>
 *
 * The CSS never depends on this file. Every component has a complete static
 * form in the grid layer, and what follows only drives transitions between
 * states, so a page that loads webterm.css and nothing else is a whole
 * framework and a page whose module fails to load degrades to static boxes
 * rather than invisible ones (§11.1).
 *
 * No dependencies and no build step: the imports below are relative paths,
 * which is all a browser or a CDN needs. Loading this module also sets
 * window.Webterm, so the data API works for an author who writes no JS.
 */

import * as cells from './lib/cells.js';
import * as motion from './lib/motion.js';
import { createBox, ensureEdge, boxTitle } from './lib/box.js';
import { emit } from './lib/events.js';
import { lockScroll, unlockScroll, scrollLocks } from './lib/scroll.js';
import { Progress, fillCells, setLoading, isLoading } from './progress.js';
import { Placeholder, CHARSETS } from './placeholder.js';
import { Toast, toast, toastStack, clearToasts, toastQueue, useConfig } from './toast.js';
import { Modal, confirm, prompt } from './modal.js';

export const version = '0.1.0';

/**
 * Defaults a page can change before or after load. Anything a component reads
 * at show time is read from here, so a page sets it once rather than passing
 * it at every call site.
 */
export const config = {
  /** Toasts visible at once; the rest queue. */
  toastMax: 4,
  /** Default toast width in cells, clamped to the screen. */
  toastCells: 40,
  /** Default toast lifetime in milliseconds; 0 means it stays. */
  toastTimeout: 6000,
};

export { cells, motion, createBox, ensureEdge, boxTitle, emit };
export { lockScroll, unlockScroll, scrollLocks };
export { Progress, fillCells, setLoading, isLoading };
export { Placeholder, CHARSETS };
export { Toast, toast, toastStack, clearToasts, toastQueue };
export { Modal, confirm, prompt };


/* ---------------------------------------------------------------- registry */

const components = new Map();
const instances = new WeakMap();

/**
 * Register a component class. A class with a static `selector` is mounted on
 * every match by init(); one without is only ever constructed on demand.
 */
export function register(name, Component) {
  components.set(name, Component);
  return Component;
}

/** The instance of `name` on `el`, or null. */
export function get(name, el) {
  const byName = instances.get(el);
  return (byName && byName.get(name)) || null;
}

/**
 * The instance of `name` on `el`, constructing it the first time. One instance
 * per element per component, cached on the element, so init() is idempotent
 * and a page can call it again after inserting markup (§11.2 rule 2).
 */
export function getOrCreate(name, el) {
  const existing = get(name, el);
  if (existing) return existing;
  const Component = components.get(name);
  if (!Component) throw new Error(`webterm: no component registered as "${name}"`);
  const instance = new Component(el);
  let byName = instances.get(el);
  if (!byName) {
    byName = new Map();
    instances.set(el, byName);
  }
  byName.set(name, instance);
  return instance;
}

/** Mount every registered component found under `root`. Safe to repeat. */
export function init(root = document) {
  for (const [name, Component] of components) {
    if (!Component.selector) continue;
    for (const el of root.querySelectorAll(Component.selector)) getOrCreate(name, el);
  }
  document.documentElement.dataset.wtReady = '1';
  return root;
}

/* ---------------------------------------------------------------- data API */

/*
 * One delegated listener for the whole page, so markup inserted later works
 * without re-binding:
 *
 *   <button data-wt-toggle="modal" data-wt-target="#confirm">open</button>
 *   <button data-wt-dismiss="modal">cancel</button>
 *
 * A toggle names the component and its target; a dismiss names the component
 * and closes the nearest one above it. The component supplies toggle()/hide().
 */
function resolveTarget(trigger, name) {
  const selector = trigger.getAttribute('data-wt-target');
  if (selector) return document.querySelector(selector);
  const Component = components.get(name);
  return Component && Component.selector ? trigger.closest(Component.selector) : null;
}

function onClick(event) {
  const toggle = event.target.closest ? event.target.closest('[data-wt-toggle]') : null;
  if (toggle) {
    const name = toggle.getAttribute('data-wt-toggle');
    const target = resolveTarget(toggle, name);
    if (target && components.has(name)) {
      const instance = getOrCreate(name, target);
      if (typeof instance.toggle === 'function') {
        event.preventDefault();
        instance.toggle(toggle);
        return;
      }
    }
  }

  const dismiss = event.target.closest ? event.target.closest('[data-wt-dismiss]') : null;
  if (dismiss) {
    const name = dismiss.getAttribute('data-wt-dismiss');
    const Component = components.get(name);
    const host = Component && Component.selector ? dismiss.closest(Component.selector) : null;
    if (host) {
      const instance = get(name, host) || getOrCreate(name, host);
      if (typeof instance.hide === 'function') {
        event.preventDefault();
        instance.hide(dismiss);
      }
    }
  }
}

/* -------------------------------------------------------------------- boot */

/* ------------------------------------------------------------- components */

// The toast module reads the same config object the page can edit.
useConfig(config);

register('progress', Progress);
register('placeholder', Placeholder);
register('toast', Toast);
register('modal', Modal);

/** The placeholder on `el`, mounting it if it has none. */
export function ph(el) {
  return getOrCreate('placeholder', el);
}

const api = {
  version,
  config,
  cells,
  motion,
  createBox,
  ensureEdge,
  boxTitle,
  emit,
  register,
  get,
  getOrCreate,
  init,
  lockScroll,
  unlockScroll,
  scrollLocks,
  Progress,
  fillCells,
  setLoading,
  isLoading,
  Placeholder,
  CHARSETS,
  ph,
  Toast,
  toast,
  toastStack,
  clearToasts,
  toastQueue,
  Modal,
  confirm,
  prompt,
};

if (typeof window !== 'undefined') {
  window.Webterm = api;
  document.addEventListener('click', onClick);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
}

export default api;
