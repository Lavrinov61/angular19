export function deferMicrotask(fn: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
  } else {
    Promise.resolve().then(fn);
  }
}

type RIC = (cb: () => void, opts?: { timeout: number }) => number;
const ric: RIC | null =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { requestIdleCallback?: RIC }).requestIdleCallback === 'function'
    ? ((globalThis as { requestIdleCallback: RIC }).requestIdleCallback.bind(globalThis) as RIC)
    : null;

export function deferIdle(fn: () => void, timeout = 200): void {
  if (ric) {
    ric(() => fn(), { timeout });
  } else {
    setTimeout(fn, 0);
  }
}
