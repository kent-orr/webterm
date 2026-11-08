/*
 * The component registry (PLAN §11.2 rule 2).
 *
 * One instance per element per component, cached on the element, which is what
 * makes init() idempotent — and init() has to be idempotent, because a page
 * that inserts markup will call it again.
 *
 * It lives here rather than in the entry because the components need it too. A
 * toast built by Webterm.toast() or a dialog built by Webterm.confirm() is
 * constructed directly, not through getOrCreate, and if it is not put in the
 * registry then the next init() finds an unmounted .toast or dialog.modal and
 * mounts a second instance on it. Two instances means two close listeners,
 * which means one dialog closing releases two scroll locks.
 */

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

export function componentFor(name) {
  return components.get(name) || null;
}

export function registered() {
  return [...components.entries()];
}

/** The instance of `name` on `el`, or null. */
export function get(name, el) {
  const byName = instances.get(el);
  return (byName && byName.get(name)) || null;
}

/** Put an already-constructed instance in the registry. */
export function attach(name, el, instance) {
  let byName = instances.get(el);
  if (!byName) {
    byName = new Map();
    instances.set(el, byName);
  }
  byName.set(name, instance);
  return instance;
}

/** Forget the instance of `name` on `el`. */
export function detach(name, el) {
  const byName = instances.get(el);
  if (byName) byName.delete(name);
}

/** The instance of `name` on `el`, constructing it the first time. */
export function getOrCreate(name, el) {
  const existing = get(name, el);
  if (existing) return existing;
  const Component = componentFor(name);
  if (!Component) throw new Error(`webterm: no component registered as "${name}"`);
  return attach(name, el, new Component(el));
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
