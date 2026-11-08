/*
 * The clock (PLAN §11.2 rule 5).
 *
 * A terminal does not tween. It repaints a cell, and the next cell, on a
 * fixed beat. So the behavior layer has no easing curves and no per-component
 * timers: one requestAnimationFrame loop drives every animation on the page,
 * and each job advances a whole step at a time on the tick declared by
 * --wt-tick.
 *
 * One loop rather than N intervals buys three things:
 *
 *   - two components started a frame apart step together, so a toast typing
 *     itself in and a placeholder resolving next to it do not shimmer against
 *     each other;
 *   - nothing runs while the tab is in the background, because rAF does not;
 *   - the clock can be paused and stepped by hand, which is how the specs
 *     assert that a component is cell-exact *mid-animation* and not only once
 *     it settles. That assertion is the whole difference between this and a
 *     skin, and it is only possible because the clock is injectable.
 *
 * Reduced motion is not a faster animation here: animate() runs onDone and
 * returns, so the caller lands on its final state in the same frame and no job
 * is ever scheduled (PLAN §11.2 rule 6).
 */

const DEFAULT_TICK = 60;

const jobs = new Set();
let frameId = 0;
let paused = false;

/** The tick in milliseconds, from --wt-tick. */
export function tickMs() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--wt-tick').trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TICK;
  // A bare number or ms is milliseconds; s is seconds.
  return /ms$/.test(raw) || !/s$/.test(raw) ? n : n * 1000;
}

/**
 * Whether animation should run at all. `data-wt-motion="off"` on <html> is the
 * explicit switch — the demo page and the specs both use it — and the OS
 * preference is honoured without one.
 */
export function motionEnabled() {
  if (document.documentElement.dataset.wtMotion === 'off') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function complete(job) {
  if (job.finished) return;
  job.finished = true;
  jobs.delete(job);
  if (job.onDone) job.onDone();
}

function step(job) {
  if (job.finished) return;
  if (job.onTick) job.onTick(job.i, job);
  job.i += 1;
  if (job.i >= job.ticks) complete(job);
}

function frame(now) {
  frameId = 0;
  for (const job of [...jobs]) {
    if (job.last === null) job.last = now;
    // Catch up if a frame was long, but never more than a few steps, so a tab
    // returning from the background does not replay a minute of animation.
    let budget = 4;
    while (!job.finished && now - job.last >= job.interval && budget > 0) {
      job.last += job.interval;
      budget -= 1;
      step(job);
    }
    if (!job.finished && now - job.last > job.interval) job.last = now;
  }
  schedule();
}

function schedule() {
  if (paused || frameId || jobs.size === 0) return;
  frameId = requestAnimationFrame(frame);
}

function inertHandle() {
  return { cancel() {}, finish() {}, get ticked() { return 0; }, get live() { return false; } };
}

/**
 * Run `onTick(i)` once per tick for `ticks` ticks, then `onDone()`.
 *
 * Returns a handle: cancel() drops the job without finishing it, finish()
 * jumps straight to onDone, and `ticked` reports how many steps have run.
 * With motion off, onDone runs now and nothing is scheduled.
 */
export function animate({ ticks = Infinity, interval = null, onTick = null, onDone = null } = {}) {
  if (!motionEnabled() || ticks <= 0) {
    if (onDone) onDone();
    return inertHandle();
  }
  const job = {
    i: 0,
    ticks,
    interval: interval === null ? tickMs() : interval,
    last: null,
    onTick,
    onDone,
    finished: false,
  };
  jobs.add(job);
  schedule();
  return {
    cancel() {
      job.finished = true;
      jobs.delete(job);
    },
    finish() {
      complete(job);
    },
    get ticked() { return job.i; },
    get live() { return !job.finished; },
  };
}

/**
 * The clock itself. A page never needs this; a spec does, and so does any
 * caller that wants animation to stop while a dialog is open.
 */
export const clock = {
  /** Stop advancing. Live jobs stay live and only move on step(). */
  pause() {
    paused = true;
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  },

  /** Resume real time. */
  resume() {
    paused = false;
    for (const job of jobs) job.last = null;
    schedule();
  },

  /** Advance every live job by `n` steps, ignoring elapsed time. */
  step(n = 1) {
    for (let k = 0; k < n; k += 1) {
      for (const job of [...jobs]) step(job);
    }
  },

  /** Run every live job to completion. */
  drain(max = 100000) {
    let k = 0;
    while (jobs.size > 0 && k < max) {
      clock.step();
      k += 1;
    }
    return k;
  },

  get paused() { return paused; },

  /** How many jobs are live — the "left no timer running" assertion. */
  get jobs() { return jobs.size; },
};
