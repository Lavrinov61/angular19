/**
 * Token-bucket rate limiter.
 *
 * Bitrix24 REST limits: ~2 req/sec sustained, 50 req burst before throttling kicks in.
 * Мы разрешаем 2 токена/сек с начальным запасом в 4 токена.
 * Использование: `await limiter.take()` перед каждым HTTP вызовом.
 */

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];

  constructor(capacity = 4, tokensPerSecond = 2) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerMs = tokensPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }

  private tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async take(): Promise<void> {
    if (this.tryTake()) return;

    return new Promise<void>((resolve) => {
      const attempt = () => {
        if (this.tryTake()) {
          resolve();
        } else {
          const missing = 1 - this.tokens;
          const waitMs = Math.ceil(missing / this.refillPerMs) + 10;
          setTimeout(attempt, waitMs);
        }
      };
      this.queue.push(attempt);
      attempt();
    });
  }
}

export const bitrixRateLimiter = new TokenBucket(4, 2);
