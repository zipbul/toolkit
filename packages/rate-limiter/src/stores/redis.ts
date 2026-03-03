import type { RateLimiterStore, StoreEntry } from '../interfaces';

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
return v
`;

/**
 * Atomic compare-and-swap: only writes if the current state matches expected.
 *
 * ARGV[1..3] = expected (value, prev, windowStart)
 * ARGV[4..6] = new (value, prev, windowStart)
 * ARGV[7]    = TTL in ms (0 = no expiry)
 * ARGV[8]    = 1 if key was null (insert), 0 if key existed (update)
 *
 * Returns 1 on success, 0 on conflict (state changed between GET and CAS).
 */
const LUA_CAS = `
local key = KEYS[1]
local ttl = tonumber(ARGV[7])
local is_new = tonumber(ARGV[8])

local v = redis.call('HMGET', key, 'v', 'p', 'ws')
if is_new == 1 then
  if v[1] ~= false then return 0 end
else
  if v[1] == false then return 0 end
  if v[1] ~= ARGV[1] or v[2] ~= ARGV[2] or v[3] ~= ARGV[3] then
    return 0
  end
end

redis.call('HMSET', key, 'v', ARGV[4], 'p', ARGV[5], 'ws', ARGV[6])
if ttl > 0 then redis.call('PEXPIRE', key, ttl) end
return 1
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
  /** Maximum CAS retry attempts before throwing. @defaultValue 5 */
  maxRetries?: number;
}

/**
 * Redis-backed store for distributed rate limiting.
 *
 * Uses optimistic locking (compare-and-swap via Lua) for atomic updates.
 * Under contention, operations are retried up to `maxRetries` times.
 */
export class RedisStore implements RateLimiterStore {
  private readonly client: RedisClient;
  private readonly prefix: string;
  private readonly ttl: number;
  private readonly maxRetries: number;

  constructor(options: RedisStoreOptions) {
    this.client = options.client;
    this.prefix = options.prefix ?? 'rl:';
    this.ttl = options.ttl ?? 0;
    this.maxRetries = options.maxRetries ?? 5;
  }

  async update(key: string, updater: (current: StoreEntry | null) => StoreEntry): Promise<StoreEntry> {
    const fullKey = this.prefix + key;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const raw = await this.client.eval(LUA_GET, [fullKey], []);
      const current = parseEntry(raw);
      const next = updater(current);
      const isNew = current === null ? '1' : '0';

      const args = current === null
        ? ['0', '0', '0', String(next.value), String(next.prev), String(next.windowStart), String(this.ttl), isNew]
        : [String(current.value), String(current.prev), String(current.windowStart), String(next.value), String(next.prev), String(next.windowStart), String(this.ttl), isNew];

      const result = await this.client.eval(LUA_CAS, [fullKey], args);
      if (Number(result) === 1) return next;
    }

    throw new Error(`RedisStore CAS failed after ${this.maxRetries} retries (key: ${key})`);
  }

  async get(key: string): Promise<StoreEntry | null> {
    const fullKey = this.prefix + key;
    const raw = await this.client.eval(LUA_GET, [fullKey], []);
    return parseEntry(raw);
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    await this.client.eval('redis.call("DEL", KEYS[1])', [fullKey], []);
  }

  async clear(): Promise<void> {
    throw new Error(
      'RedisStore.clear() is not supported. Use your Redis client directly (e.g., SCAN + DEL with the key prefix).',
    );
  }
}
