/**
 * Minimal ambient typings for `opossum@8`.
 *
 * The upstream package ships CommonJS with JSDoc only (no bundled .d.ts).
 * We declare only the subset consumed by the Fleet SNMP client. Keep this
 * lean — extend as new call-sites need more of the API.
 */

declare module 'opossum' {
  export interface CircuitBreakerOptions {
    timeout?: number | false;
    maxFailures?: number;
    resetTimeout?: number;
    rollingCountTimeout?: number;
    rollingCountBuckets?: number;
    name?: string;
    rollingPercentilesEnabled?: boolean;
    capacity?: number;
    errorThresholdPercentage?: number;
    enabled?: boolean;
    allowWarmUp?: boolean;
    volumeThreshold?: number;
    errorFilter?: (err: Error) => boolean;
    cache?: boolean;
    cacheTTL?: number;
    cacheSize?: number;
    coalesce?: boolean;
    abortController?: AbortController;
    autoRenewAbortController?: boolean;
  }

  export type BreakerEvent =
    | 'open'
    | 'close'
    | 'halfOpen'
    | 'fire'
    | 'reject'
    | 'success'
    | 'failure'
    | 'timeout'
    | 'fallback'
    | 'semaphoreLocked'
    | 'healthCheckFailed'
    | 'cacheHit'
    | 'cacheMiss';

  export default class CircuitBreaker<
    TArgs extends unknown[] = unknown[],
    TResult = unknown,
  > {
    constructor(
      action: (...args: TArgs) => Promise<TResult> | TResult,
      options?: CircuitBreakerOptions,
    );

    readonly opened: boolean;
    readonly halfOpen: boolean;
    readonly closed: boolean;
    readonly pendingClose: boolean;
    readonly enabled: boolean;
    readonly name: string;

    fire(...args: TArgs): Promise<TResult>;
    call(thisArg: unknown, ...args: TArgs): Promise<TResult>;
    open(): void;
    close(): void;
    disable(): void;
    enable(): void;
    shutdown(): void;
    fallback(fn: (...args: TArgs) => TResult | Promise<TResult>): this;

    on(event: BreakerEvent, listener: (...args: unknown[]) => void): this;
    off(event: BreakerEvent, listener: (...args: unknown[]) => void): this;
  }
}
