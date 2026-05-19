import { describe, it, expect } from 'bun:test';

import { RouterCache } from './cache';

describe('RouterCache', () => {
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

  it('should increment count on each insert and only evict the oldest entry once capacity is exceeded', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');
    expect(cache.get('/c')).toBe('c');
    const survivors = [cache.get('/a'), cache.get('/b')].filter(v => v !== undefined);
    expect(survivors).toHaveLength(1);
  });

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
    cache.set('/b', 'b');
    expect(cache.get('/a')).toBeUndefined();
  });

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
    cache.set('/c', 'c');
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
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');
    cache.set('/d', 'd');
    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/b')).toBeUndefined();
    expect(cache.get('/c')).toBe('c');
    expect(cache.get('/d')).toBe('d');
  });

  it('should complete full clock sweep and evict first entry when all entries have used=true', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.get('/a');
    cache.get('/b');
    cache.set('/c', 'c');

    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/c')).toBe('c');
  });

  it('should store and retrieve empty string key with null value', () => {
    const cache = new RouterCache<string>(5);
    cache.set('', null);

    expect(cache.get('')).toBeNull();
  });

  it('should transition from empty to full to eviction overflow without error', () => {
    const cache = new RouterCache<string>(2);

    expect(cache.get('/x')).toBeUndefined();
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');
    expect(cache.get('/c')).toBe('c');
  });

  it('should evict entry on second clock sweep when entry was given second chance', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');
    expect(cache.get('/a')).toBeUndefined();
    expect(cache.get('/b')).toBe('b');
  });

  it('should remove evicted key from index so same key can be re-inserted', () => {
    const cache = new RouterCache<string>(1);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/a', 're-a');
    expect(cache.get('/a')).toBe('re-a');
  });

  it('should evict unreferenced entry while preserving recently-used entry (second chance)', () => {
    const cache = new RouterCache<string>(4);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');
    cache.set('/d', 'd');
    cache.set('/e', 'e');
    cache.get('/b');
    cache.set('/f', 'f');
    expect(cache.get('/c')).toBeUndefined();
    expect(cache.get('/b')).toBe('b');
  });

  it('should return same value on repeated get calls without modification', () => {
    const cache = new RouterCache<string>(5);
    cache.set('/stable', 'value');

    expect(cache.get('/stable')).toBe('value');
    expect(cache.get('/stable')).toBe('value');
    expect(cache.get('/stable')).toBe('value');
  });

  it('should evict entries in insertion order when none have been recently accessed', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/first', 'first');
    cache.set('/second', 'second');
    cache.set('/third', 'third');
    expect(cache.get('/first')).toBeUndefined();
    expect(cache.get('/second')).toBe('second');
    expect(cache.get('/third')).toBe('third');
  });

  it('should evict the entry at the current hand position before entries inserted later', () => {
    const cache = new RouterCache<string>(2);
    cache.set('/a', 'a');
    cache.set('/b', 'b');
    cache.set('/c', 'c');
    cache.set('/d', 'd');

    expect(cache.get('/b')).toBeUndefined();
    expect(cache.get('/c')).toBe('c');
    expect(cache.get('/d')).toBe('d');
  });
});
