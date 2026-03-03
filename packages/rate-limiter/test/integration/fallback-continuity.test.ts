import { describe, test, expect, afterEach } from 'bun:test';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { MemoryStore } from '../../src/stores/memory';
import { withFallback, WithFallbackStore } from '../../src/stores/with-fallback';
import { createClock } from '../helpers';

describe('WithFallback store continuity', () => {
  let store: WithFallbackStore;

  afterEach(() => { store?.dispose(); });

  test('fallback starts fresh after primary failure — counter resets', async () => {
    const clock = createClock(1000);
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    let primaryDown = false;

    store = withFallback(
      {
        update: (key, updater) => {
          if (primaryDown) throw new Error('down');
          return primary.update(key, updater);
        },
        get: (key) => {
          if (primaryDown) throw new Error('down');
          return primary.get(key);
        },
        delete: (key) => {
          if (primaryDown) throw new Error('down');
          return primary.delete(key);
        },
        clear: () => primary.clear(),
      },
      fallback,
      {
        healthCheck: async () => !primaryDown,
        restoreInterval: 60_000,
      },
    );

    const limiter = RateLimiter.create({
      rules: { limit: 3, window: 5000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      store,
    });

    // Consume 2 on primary
    await limiter.consume('user1');
    await limiter.consume('user1');
    // 2 consumed, peek with cost=1 → remaining = 3-2-1 = 0
    expect((await limiter.peek('user1')).remaining).toBe(0);

    // Primary goes down
    primaryDown = true;

    // Next consume hits fallback — counter restarts from 0
    const afterFailover = await limiter.consume('user1');
    expect(afterFailover.action).toBe(RateLimitAction.Allow);
    // Fallback has no history, so remaining = limit - 1
    expect(afterFailover.remaining).toBe(2);
  });

  test('primary restore resumes primary state', async () => {
    const clock = createClock(1000);
    const primary = new MemoryStore();
    const fallback = new MemoryStore();
    let primaryDown = false;

    store = withFallback(
      {
        update: (key, updater) => {
          if (primaryDown) throw new Error('down');
          return primary.update(key, updater);
        },
        get: (key) => {
          if (primaryDown) throw new Error('down');
          return primary.get(key);
        },
        delete: (key) => {
          if (primaryDown) throw new Error('down');
          return primary.delete(key);
        },
        clear: () => primary.clear(),
      },
      fallback,
      {
        healthCheck: async () => !primaryDown,
        restoreInterval: 50,
      },
    );

    const limiter = RateLimiter.create({
      rules: { limit: 5, window: 10000 },
      algorithm: Algorithm.SlidingWindow,
      clock: clock.now,
      store,
    });

    // Consume 3 on primary
    await limiter.consume('user1');
    await limiter.consume('user1');
    await limiter.consume('user1');

    // Primary down, consume 1 on fallback
    primaryDown = true;
    await limiter.consume('user1');

    // Restore primary
    primaryDown = false;
    await new Promise(resolve => setTimeout(resolve, 80));

    // Now back on primary — should see the original 3 consumed (not fallback's 1)
    const peek = await limiter.peek('user1');
    expect(peek.action).toBe(RateLimitAction.Allow);
    // Primary had 3 consumed, so remaining = 5-3-1 = 1 (peek cost=1)
    expect(peek.remaining).toBe(1);
  });
});
