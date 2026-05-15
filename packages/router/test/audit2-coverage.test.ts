/**
 * Coverage gaps from codex 3rd-pass audit (COV-001/002/003).
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';

describe('factored walker — multi-suffix wildcard empty-tail (COV-001)', () => {
  it('multi-origin wildcard `:rest+` rejects empty tail across factored tier', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/:rest+`, `multi-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/files/a/b')?.value).toBe('multi-0');
    expect(r.match('GET', '/tenant-1499/files/x/y')?.value).toBe('multi-1499');
    // multi origin requires non-empty tail — bare /tenant-N/files must NOT match
    expect(r.match('GET', '/tenant-0/files')).toBeNull();
    expect(r.match('GET', '/tenant-1499/files')).toBeNull();
  });
});

describe('leafStoreOf depth boundary (COV-002)', () => {
  it('factor candidate with chain length within LEAF_STORE_MAX_DEPTH still factors', () => {
    // 30-segment single chain — well under the 64 cap
    const r = new Router<string>();
    const tail = Array.from({ length: 30 }, (_, i) => `s${i}`).join('/');
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/${tail}/:final`, `deep-${i}`);
    }
    r.build();
    const probe = `/tenant-0/${tail}/X`;
    expect(r.match('GET', probe)?.value).toBe('deep-0');
    const last = `/tenant-1499/${tail}/Y`;
    expect(r.match('GET', last)?.value).toBe('deep-1499');
  });
});

describe('path-policy paren-context characters (COV-003)', () => {
  it('accepts standard regex constraint with letters and digits', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'h');
    r.build();
    expect(r.match('GET', '/users/123')?.value).toBe('h');
    expect(r.match('GET', '/users/abc')).toBeNull();
  });

  it('accepts standard regex character classes', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id([a-z]+)', 'h');
    r.build();
    expect(r.match('GET', '/users/abc')?.value).toBe('h');
    expect(r.match('GET', '/users/123')).toBeNull();
  });

  it('rejects raw question mark in static segment outside paren', () => {
    const r = new Router<string>();
    r.add('GET', '/foo?bar', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      expect(err.data.errors[0]!.error.kind).toBe('path-query');
    }
  });

  it('rejects raw fragment marker', () => {
    const r = new Router<string>();
    r.add('GET', '/foo#bar', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      expect(err.data.errors[0]!.error.kind).toBe('path-fragment');
    }
  });
});

describe('route-parse error suggestions (AUDIT2-010)', () => {
  it('unclosed regex includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      const inner = err.data.errors[0]!.error;
      expect(inner.kind).toBe('route-parse');
      expect((inner as { suggestion?: string }).suggestion).toBeDefined();
    }
  });

  it('mid-position wildcard includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*tail/extra', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      const inner = err.data.errors[0]!.error;
      expect(inner.kind).toBe('route-parse');
      expect((inner as { suggestion?: string }).suggestion).toBeDefined();
    }
  });

  it('empty parameter name includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      const inner = err.data.errors[0]!.error;
      expect(inner.kind).toBe('route-parse');
      expect((inner as { suggestion?: string }).suggestion).toBeDefined();
    }
  });

  it('invalid first character in param name includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:1id', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      const inner = err.data.errors[0]!.error;
      expect(inner.kind).toBe('route-parse');
      expect((inner as { suggestion?: string }).suggestion).toBeDefined();
    }
  });

  it('invalid subsequent character in param name includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id-x', 'h');
    try { r.build(); throw new Error('expected throw'); }
    catch (e) {
      const err = e as RouterError;
      if (err.data.kind !== 'route-validation') throw e;
      const inner = err.data.errors[0]!.error;
      expect(inner.kind).toBe('route-parse');
      expect((inner as { suggestion?: string }).suggestion).toBeDefined();
    }
  });

});
