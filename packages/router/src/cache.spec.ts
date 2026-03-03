import { describe, it, expect } from 'bun:test';

import { RouterCache } from './cache';

describe('RouterCache', () => {
  // ── HP ──

  it('should return stored value when key exists', () => {
    const cache = new RouterCache<string>(10);
    cache.set('/users', 'handler');

    expect(cache.get('/users')).toBe('handler');
  });

  it('should return null when value was stored as null', () => {
    const cache = new RouterCache<string>(10);
    cache.set('/not-found', null);

    expect(cache.get('/not-found')).toBeNull();
  });

  it('should return null (not undefined) for null-valued entry', () => {
    const cache = new RouterCache<string>(5);
    cache.set('/404', null);

    const result = cache.get('/404');

    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  it('should return updated value after overwriting existing key', () => {
    const cache = new RouterCache<string>(10);
    cache.set('/users', 'v1');
    cache.set('/users', 'v2');

    expect(cache.get('/users')).toBe('v2');
  });

  it('should insert new entries up to maxSize without eviction', () => {
    const cache = new RouterCache<string>(3);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');

    expect(cache.get('/a')).toBe('a');
    expect(cache.get('/b')).toBe('b');
    expect(cache.get('/c')).toBe('c');
  });

  it('should increments count on each new insert and trigger eviction only past maxSize', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c'); // triggers eviction — no error

    expect(cache.get('/c')).toBe('c');
  });

  it('should allow re-insertion after clear', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.clear();
    cache.set('/a', 'new-a');

    expect(cache.get('/a')).toBe('new-a');
  });

  // ── NE ──

  it('should return undefined when key was never set', () => {
    const cache = new RouterCache<string>(10);

    expect(cache.get('/unknown')).toBeUndefined();
  });

  it('should return undefined for empty string key that was never set', () => {
    const cache = new RouterCache<string>(5);

    expect(cache.get('')).toBeUndefined();
  });

  it('should return undefined after evicted key is accessed', () => {
    const cache = new RouterCache<string>(1);
    cache.set('/a', 'a');
    cache.set('/b', 'b'); // evicts /a

    expect(cache.get('/a')).toBeUndefined();
  });

  it('should return undefined for any key after clear', () => {
    const cache = new RouterCache<string>(5);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.clear();

    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/b')).toBeUndefined();
  });

  // ── ED ──

  it('should evict existing entry when maxSize is 1 and second entry is inserted', () => {
    const cache = new RouterCache<string>(1);
    cache.set('/first', 'first');
    cache.set('/second', 'second');

    expect(cache.get('/first')).toBeUndefined();
    expect(cache.get('/second')).toBe('second');
  });

  it('should follow alternating eviction pattern with maxSize=2', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c'); // evicts /a

    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/b')).toBe('b');
    expect(cache.get('/c')).toBe('c');
  });

  it('should store and retrieve empty string key', () => {
    const cache = new RouterCache<string>(5);
    cache.set('', 'root');

    expect(cache.get('')).toBe('root');
  });

  it('should wrap hand correctly when eviction reaches the last slot', () => {
    // maxSize=2: evict /a (slot 0) → hand=1; next evict /b (slot 1) → hand wraps to 0
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a'); // slot 0
    cache.set('/b', 'b'); // slot 1
    cache.set('/c', 'c'); // evicts /a, hand moves to 1
    cache.set('/d', 'd'); // evicts /b, hand wraps to 0

    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/b')).toBeUndefined();
    expect(cache.get('/c')).toBe('c');
    expect(cache.get('/d')).toBe('d');
  });

  // ── CO ──

  it('should complete full clock sweep and evict first entry when all entries have used=true', () => {
    // Both entries inserted with used=true.
    // evict(): hand=0 /a→false; hand=1 /b→false; wrap=0 /a→false→evict.
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.get('/a'); // used=true (already true)
    cache.get('/b'); // used=true (already true)
    cache.set('/c', 'c');

    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/c')).toBe('c');
  });

  it('should store and retrieve empty string key with null value', () => {
    const cache = new RouterCache<string>(5);
    cache.set('', null);

    expect(cache.get('')).toBeNull();
  });

  // ── ST ──

  it('should transition from empty to full to eviction overflow without error', () => {
    const cache = new RouterCache<string>(2);

    expect(cache.get('/x')).toBeUndefined(); // empty state

    cache.set('/a', 'a');
    cache.set('/b', 'b'); // full
    cache.set('/c', 'c'); // overflow → eviction

    expect(cache.get('/c')).toBe('c');
  });

  it('should reset hand, count, entries, and index after clear', () => {
    const cache = new RouterCache<string>(3);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.clear();

    // After clear: new inserts should go to slot 0 again
    cache.set('/new', 'new');

    expect(cache.get('/new')).toBe('new');
    expect(cache.get('/a')).toBeUndefined();
  });

  it('should evict entry on second clock sweep when entry was given second chance', () => {
    // clock-sweep: first encounter → used=true→false (second chance); second encounter → used=false→evict
    // maxSize=2: insert /a(s0), /b(s1). evict for /c:
    //   h=0, /a.u=T→F; h=1, /b.u=T→F; wrap h=0, /a.u=F→evict. hand=1
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c'); // /a evicted

    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/b')).toBe('b'); // /b survived
  });

  it('should remove evicted key from index so same key can be re-inserted', () => {
    const cache = new RouterCache<string>(1);
    cache.set('/a', 'a');
    cache.set('/b', 'b'); // evicts /a

    cache.set('/a', 're-a'); // /a re-inserted after eviction

    expect(cache.get('/a')).toBe('re-a');
  });

  it('should evict unreferenced entry while preserving recently-used entry (second chance)', () => {
    // maxSize=4 (power of 2) to demonstrate real second-chance benefit:
    // Fill 4 slots: /a(0), /b(1), /c(2), /d(3)
    // Insert /e → evicts /a (hand=0, u=F→evict), hand=1
    // All others get used=false after eviction sweep
    // Refresh /b: /b.used=true
    // Insert /f → hand=1, /b.u=T→false, skip; hand=2, /c.u=F→evict /c
    const cache = new RouterCache<string>(4);
    cache.set('/a', 'a'); // slot 0
    cache.set('/b', 'b'); // slot 1
    cache.set('/c', 'c'); // slot 2
    cache.set('/d', 'd'); // slot 3
    cache.set('/e', 'e'); // triggers first eviction → evicts /a, hand=1

    cache.get('/b'); // refresh /b: used=true

    cache.set('/f', 'f'); // second eviction: /b gets second chance; /c.u=F → evicted

    expect(cache.get('/c')).toBeUndefined(); // /c evicted (no second chance)
    expect(cache.get('/b')).toBe('b'); // /b survived (had second chance)
  });

  // ── ID ──

  it('should return same value on repeated get calls without modification', () => {
    const cache = new RouterCache<string>(5);
    cache.set('/stable', 'value');

    expect(cache.get('/stable')).toBe('value');
    expect(cache.get('/stable')).toBe('value');
    expect(cache.get('/stable')).toBe('value');
  });

  it('should leave cache empty after multiple sequential clear calls', () => {
    const cache = new RouterCache<string>(5);
    cache.set('/a', 'a');
    cache.clear();
    cache.clear();

    expect(cache.get('/a')).toBeUndefined();
  });

  // ── OR ──

  it('should evict entries in insertion order when none have been recently accessed', () => {
    // Both /a and /b start with used=true from insert.
    // evict inserts in order: /a(slot0) first → /a evicted first.
    const cache = new RouterCache<string>(2);
    cache.set('/first', 'first'); // slot 0
    cache.set('/second', 'second'); // slot 1
    cache.set('/third', 'third'); // /first evicted (hand starts at 0)

    expect(cache.get('/first')).toBeUndefined();
    expect(cache.get('/second')).toBe('second');
    expect(cache.get('/third')).toBe('third');
  });

  it('should evict the entry at the current hand position before entries inserted later', () => {
    // After first eviction, hand=1. Next eviction starts at slot 1 (/second).
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a'); // slot 0
    cache.set('/b', 'b'); // slot 1
    cache.set('/c', 'c'); // evicts /a, hand ends at 1

    // Now hand=1, /b.used=false; next evict starts at slot1 (/b.u=F→evict immediately)
    cache.set('/d', 'd');

    expect(cache.get('/b')).toBeUndefined(); // /b evicted next
    expect(cache.get('/c')).toBe('c');
    expect(cache.get('/d')).toBe('d');
  });
});
