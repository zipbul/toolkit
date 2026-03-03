import type { RateLimiterStore, StoreEntry } from '../src/interfaces';

/**
 * Minimal Redis client interface for eval-based operations.
 *
 * Note: This does NOT match ioredis or node-redis signatures directly.
 * You may need a thin adapter. For ioredis: `{ eval: (script, numKeys, ...args) => ... }`.
 */
export interface RedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const LUA_GET = `
local key = KEYS[1]
local v = redis.call('HMGET', key, 'v', 'p', 'ws')
if v[1] == false then return nil end
return {tonumber(v[1]), tonumber(v[2]), tonumber(v[3])}
`;

const LUA_UPDATE = `
local key = KEYS[1]
local value = tonumber(ARGV[1])
local prev = tonumber(ARGV[2])
local windowStart = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
redis.call('HMSET', key, 'v', value, 'p', prev, 'ws', windowStart)
if ttl > 0 then redis.call('PEXPIRE', key, ttl) end
return {value, prev, windowStart}
`;

function parseEntry(raw: unknown): StoreEntry | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  return {
    value: Number(raw[0]),
    prev: Number(raw[1]),
    windowStart: Number(raw[2]),
  };
}

export interface RedisStoreOptions {
  /** Redis client instance (must implement the {@link RedisClient} interface). */
  client: RedisClient;
  /** Key prefix for all rate limiter keys. @defaultValue 'rl:' */
  prefix?: string;
  /** TTL in milliseconds for stored entries. @defaultValue 0 (no expiry) */
  ttl?: number;
}

/**
 * Redis-backed store for distributed rate limiting.
 *
 * **Important:** The `update()` method uses GET→compute→SET which is NOT atomic
 * under concurrent access. For high-concurrency scenarios, consider using
 * optimistic locking (WATCH/MULTI) or algorithm-specific Lua scripts.
 *
 * Import from `@zipbul/rate-limiter/redis`.
 */
export class RedisStore implements RateLimiterStore {
  private readonly client: RedisClient;
  private readonly prefix: string;
  private readonly ttl: number;

  constructor(options: RedisStoreOptions) {
    this.client = options.client;
    this.prefix = options.prefix ?? 'rl:';
    this.ttl = options.ttl ?? 0;
  }

  async update(key: string, updater: (current: StoreEntry | null) => StoreEntry): Promise<StoreEntry> {
    const fullKey = this.prefix + key;
    const raw = await this.client.eval(LUA_GET, [fullKey], []);
    const current = parseEntry(raw);
    const next = updater(current);
    await this.client.eval(
      LUA_UPDATE,
      [fullKey],
      [String(next.value), String(next.prev), String(next.windowStart), String(this.ttl)],
    );
    return next;
  }

  async get(key: string): Promise<StoreEntry | null> {
    const fullKey = this.prefix + key;
    const raw = await this.client.eval(LUA_GET, [fullKey], []);
    return parseEntry(raw);
  }

  async clear(): Promise<void> {
    throw new Error(
      'RedisStore.clear() is not supported. Use your Redis client directly (e.g., SCAN + DEL with the key prefix).',
    );
  }
}
