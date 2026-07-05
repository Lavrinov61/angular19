export class BatchedUpdater<K, V> {
  private pending = new Map<K, V>();
  private rafId: number | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly onFlush: (pending: Map<K, V>) => void) {}

  schedule(key: K, value: V): void {
    if (this.destroyed) return;
    this.pending.set(key, value);
    if (this.rafId !== null || this.timerId !== null) return;

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.timerId = setTimeout(() => this.flush(), 0);
      });
    } else {
      this.timerId = setTimeout(() => this.flush(), 16);
    }
  }

  flushNow(): void {
    if (this.destroyed) return;
    this.cancelPendingTick();
    this.flush();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelPendingTick();
    this.pending.clear();
  }

  private flush(): void {
    if (this.destroyed || this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    this.rafId = null;
    this.timerId = null;
    try {
      this.onFlush(batch);
    } catch (e) {
      console.error('[BatchedUpdater] onFlush threw:', e);
    }
  }

  private cancelPendingTick(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }
    this.timerId = null;
  }
}
