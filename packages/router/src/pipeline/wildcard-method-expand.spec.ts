import { describe, expect, it } from 'bun:test';

import { MethodRegistry } from '../method-registry';
import { WILDCARD_METHOD, expandWildcardMethodRoutes } from './wildcard-method-expand';

interface Pending {
  method: string;
  path: string;
  value: string;
}

function makeRegistry(extraMethods: string[] = []): MethodRegistry {
  const registry = new MethodRegistry();
  for (const m of extraMethods) {
    registry.getOrCreate(m);
  }
  return registry;
}

describe('WILDCARD_METHOD constant', () => {
  it('is the literal "*"', () => {
    expect(WILDCARD_METHOD).toBe('*');
  });
});

describe('expandWildcardMethodRoutes — short-circuits when no * present', () => {
  it('leaves the array untouched if no entry has method === "*"', () => {
    const routes: Pending[] = [
      { method: 'GET', path: '/a', value: 'a' },
      { method: 'POST', path: '/b', value: 'b' },
    ];
    const before = routes.slice();
    expandWildcardMethodRoutes(routes, makeRegistry());
    expect(routes).toEqual(before);
  });
});

describe('expandWildcardMethodRoutes — fans out * across registered methods', () => {
  it('replaces a single * with one entry per registered method (7 defaults)', () => {
    const routes: Pending[] = [{ method: '*', path: '/x', value: 'x' }];
    expandWildcardMethodRoutes(routes, makeRegistry());
    expect(routes.length).toBe(7);
    const methods = routes.map(r => r.method).sort();
    expect(methods).toEqual(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
    expect(routes.every(r => r.path === '/x' && r.value === 'x')).toBe(true);
  });

  it('includes custom methods already registered in the registry', () => {
    const routes: Pending[] = [{ method: '*', path: '/x', value: 'x' }];
    expandWildcardMethodRoutes(routes, makeRegistry(['PURGE']));
    expect(routes.map(r => r.method)).toContain('PURGE');
  });

  it('includes custom methods first observed via non-* pending routes', () => {
    const routes: Pending[] = [
      { method: 'PURGE', path: '/p', value: 'p' },
      { method: '*', path: '/x', value: 'x' },
    ];
    expandWildcardMethodRoutes(routes, makeRegistry());
    const xMethods = routes.filter(r => r.path === '/x').map(r => r.method);
    expect(xMethods).toContain('PURGE');
  });

  it('preserves non-* entries verbatim in their original order alongside expansions', () => {
    const routes: Pending[] = [
      { method: 'GET', path: '/a', value: 'a' },
      { method: '*', path: '/x', value: 'x' },
      { method: 'POST', path: '/b', value: 'b' },
    ];
    expandWildcardMethodRoutes(routes, makeRegistry());
    expect(routes[0]).toEqual({ method: 'GET', path: '/a', value: 'a' });
    expect(routes[routes.length - 1]).toEqual({ method: 'POST', path: '/b', value: 'b' });
  });

  it('handles multiple * entries independently', () => {
    const routes: Pending[] = [
      { method: '*', path: '/x', value: 'x' },
      { method: '*', path: '/y', value: 'y' },
    ];
    expandWildcardMethodRoutes(routes, makeRegistry());
    const xRoutes = routes.filter(r => r.path === '/x');
    const yRoutes = routes.filter(r => r.path === '/y');
    expect(xRoutes.length).toBe(7);
    expect(yRoutes.length).toBe(7);
  });
});
