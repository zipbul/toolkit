import type { RateLimiterStore, StoreEntry } from '../interfaces';

export interface WithFallbackOptions {
  /** Async function to check if the primary store is healthy. */
  healthCheck: () => Promise<boolean>;
  /** Interval in milliseconds to re-check primary health. @defaultValue 30000 */
  restoreInterval?: number;
}

/**
 * A store wrapper that falls back to a secondary store when the primary fails.
 * Periodically checks primary health and restores when available.
 */
export class WithFallbackStore implements RateLimiterStore {
  private usePrimary = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly primary: RateLimiterStore,
    private readonly fallback: RateLimiterStore,
    private readonly options: WithFallbackOptions,
  ) {
    const interval = options.restoreInterval ?? 30_000;
    this.timer = setInterval(() => this.tryRestore(), interval);
    // Don't keep the process alive just for health checks
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  async update(key: string, updater: (current: StoreEntry | null) => StoreEntry): Promise<StoreEntry> {
    if (this.usePrimary) {
      try {
        return await this.primary.update(key, updater);
      } catch {
        this.usePrimary = false;
      }
    }
    return this.fallback.update(key, updater);
  }

  async get(key: string): Promise<StoreEntry | null> {
    if (this.usePrimary) {
      try {
        return await this.primary.get(key);
      } catch {
        this.usePrimary = false;
      }
    }
    return this.fallback.get(key);
  }

  async delete(key: string): Promise<void> {
    if (this.usePrimary) {
      try {
        await this.primary.delete(key);
        return;
      } catch {
        this.usePrimary = false;
      }
    }
    await this.fallback.delete(key);
  }

  async clear(): Promise<void> {
    await Promise.allSettled([this.primary.clear(), this.fallback.clear()]);
  }

  /** Stop the health-check timer. */
  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tryRestore(): Promise<void> {
    if (this.usePrimary) return;
    try {
      const healthy = await this.options.healthCheck();
      if (healthy) this.usePrimary = true;
    } catch {
      // health check failed, stay on fallback
    }
  }
}

/**
 * Creates a store that falls back to a secondary store when the primary fails.
 */
export function withFallback(
  primary: RateLimiterStore,
  fallback: RateLimiterStore,
  options: WithFallbackOptions,
): WithFallbackStore {
  return new WithFallbackStore(primary, fallback, options);
}
