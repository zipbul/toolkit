import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import Redis from 'ioredis';

import { RateLimiter } from '../../src/rate-limiter';
import { RateLimitAction, Algorithm } from '../../src/enums';
import { RedisStore } from '../../src/stores/redis';
import type { RedisClient } from '../../src/stores/redis';

// ── ioredis adapter ────────────────────────────────────────────────

function createRedisClient(redis: Redis): RedisClient {
  return {
    eval: (script: string, keys: string[], args: string[]) =>
      redis.eval(script, keys.length, ...keys, ...args),
  };
}

// ── Setup ──────────────────────────────────────────────────────────

let redis: Redis;
let client: RedisClient;

beforeAll(async () => {
  redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true });
  await redis.connect();
  client = createRedisClient(redis);
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  // Clean all test keys
  const keys = await redis.keys('rl:*');
  if (keys.length > 0) await redis.del(...keys);
  const testKeys = await redis.keys('test:*');
  if (testKeys.length > 0) await redis.del(...testKeys);
});

// ── RedisStore direct tests ────────────────────────────────────────

describe('RedisStore with real Redis', () => {
  test('update creates and retrieves entry', async () => {
    const store = new RedisStore({ client });

    const entry = await store.update('key1', (current) => {
      expect(current).toBeNull();
      return { value: 42, prev: 0, windowStart: 1000 };
    });

    expect(entry).toEqual({ value: 42, prev: 0, windowStart: 1000 });

    const got = await store.get('key1');
    expect(got).toEqual({ value: 42, prev: 0, windowStart: 1000 });
  });

  test('update passes current entry to updater', async () => {
    const store = new RedisStore({ client });

    await store.update('key1', () => ({ value: 10, prev: 5, windowStart: 2000 }));

    const entry = await store.update('key1', (current) => {
      expect(current).toEqual({ value: 10, prev: 5, windowStart: 2000 });
      return { value: 20, prev: 10, windowStart: 3000 };
    });

    expect(entry).toEqual({ value: 20, prev: 10, windowStart: 3000 });
  });

  test('get returns null for missing key', async () => {
    const store = new RedisStore({ client });
    const entry = await store.get('nonexistent');
    expect(entry).toBeNull();
  });

  test('delete removes entry', async () => {
    const store = new RedisStore({ client });

    await store.update('key1', () => ({ value: 1, prev: 0, windowStart: 0 }));
    expect(await store.get('key1')).not.toBeNull();

    await store.delete('key1');
    expect(await store.get('key1')).toBeNull();
  });

  test('prefix isolates keys', async () => {
    const store1 = new RedisStore({ client, prefix: 'test:a:' });
    const store2 = new RedisStore({ client, prefix: 'test:b:' });

    await store1.update('key', () => ({ value: 1, prev: 0, windowStart: 0 }));
    await store2.update('key', () => ({ value: 2, prev: 0, windowStart: 0 }));

    expect((await store1.get('key'))!.value).toBe(1);
    expect((await store2.get('key'))!.value).toBe(2);
  });

  test('TTL expires entries', async () => {
    const store = new RedisStore({ client, ttl: 100 });

    await store.update('ttl-key', () => ({ value: 1, prev: 0, windowStart: 0 }));
    expect(await store.get('ttl-key')).not.toBeNull();

    // Wait for TTL
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await store.get('ttl-key')).toBeNull();
  });

  test('clear throws with guidance message', async () => {
    const store = new RedisStore({ client });
    expect(() => store.clear()).toThrow(/not supported/);
  });
});

// ── RateLimiter + RedisStore e2e ───────────────────────────────────

describe('RateLimiter with RedisStore', () => {
  for (const algo of [Algorithm.GCRA, Algorithm.SlidingWindow, Algorithm.TokenBucket]) {
    describe(algo, () => {
      test('allow → deny → recovery lifecycle', async () => {
        const store = new RedisStore({ client, prefix: `test:${algo}:` });
        const limiter = RateLimiter.create({
          rules: { limit: 3, window: 1000 },
          algorithm: algo,
          store,
        });

        // Allow 3
        for (let i = 0; i < 3; i++) {
          const r = await limiter.consume('user1');
          expect(r.action).toBe(RateLimitAction.Allow);
        }

        // 4th denied
        const denied = await limiter.consume('user1');
        expect(denied.action).toBe(RateLimitAction.Deny);

        // Wait for window to expire
        await new Promise(resolve => setTimeout(resolve, 1100));

        // Should recover
        const recovered = await limiter.consume('user1');
        expect(recovered.action).toBe(RateLimitAction.Allow);
      });

      test('peek does not consume', async () => {
        const store = new RedisStore({ client, prefix: `test:peek:${algo}:` });
        const limiter = RateLimiter.create({
          rules: { limit: 1, window: 5000 },
          algorithm: algo,
          store,
        });

        // Peek multiple times
        for (let i = 0; i < 5; i++) {
          const peek = await limiter.peek('user1');
          expect(peek.action).toBe(RateLimitAction.Allow);
        }

        // Still able to consume
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);
      });

      test('reset clears state', async () => {
        const store = new RedisStore({ client, prefix: `test:reset:${algo}:` });
        const limiter = RateLimiter.create({
          rules: { limit: 1, window: 60000 },
          algorithm: algo,
          store,
        });

        await limiter.consume('user1');
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Deny);

        await limiter.reset('user1');
        expect((await limiter.consume('user1')).action).toBe(RateLimitAction.Allow);
      });
    });
  }

  test('multi-tenant isolation via Redis', async () => {
    const store = new RedisStore({ client, prefix: 'test:mt:' });
    const limiter = RateLimiter.create({
      rules: { limit: 2, window: 60000 },
      algorithm: Algorithm.SlidingWindow,
      store,
    });

    await limiter.consume('tenant-a');
    await limiter.consume('tenant-a');
    await limiter.consume('tenant-b');

    expect((await limiter.consume('tenant-a')).action).toBe(RateLimitAction.Deny);
    expect((await limiter.consume('tenant-b')).action).toBe(RateLimitAction.Allow);
  });
});
