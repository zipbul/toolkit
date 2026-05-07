import { describe, test, expect } from 'bun:test';
import { Router } from '../src/router';

describe('method token grammar accepts valid custom tokens', () => {
  test.each([
    ['PROPFIND'],
    ['PATCH+X'],
    ['foo'],
    ['get'],
    ['CUSTOM-METHOD_X.0'],
    ['M!#$%&\'*+-.^_`|~0'],
  ])('accepts %s', (method) => {
    const r = new Router<string>();
    expect(() => {
      r.add(method as any, '/x', 'h');
      r.build();
    }).not.toThrow();
    expect(r.match(method as any, '/x')?.value).toBe('h');
  });

  test('accepts a method exactly 64 ASCII bytes (boundary)', () => {
    const r = new Router<string>();
    const m = 'X'.repeat(64);
    expect(() => {
      r.add(m as any, '/x', 'h');
      r.build();
    }).not.toThrow();
  });

  test('case-sensitive: GET and get are distinct registrations', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'upper');
    r.add('get' as any, '/x', 'lower');
    r.build();
    expect(r.match('GET', '/x')?.value).toBe('upper');
    expect(r.match('get' as any, '/x')?.value).toBe('lower');
  });
});

describe('32-method limit boundary', () => {
  test('accepts exactly 32 distinct method tokens (7 default + 25 custom)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 25; i++) {
      r.add(`CUSTOM${i}` as any, '/x', `h${i}`);
    }
    expect(() => r.build()).not.toThrow();
  });

  test('rejects the 33rd distinct method with method-limit', () => {
    const r = new Router<string>();
    for (let i = 0; i < 26; i++) {
      r.add(`CUSTOM${i}` as any, '/x', `h${i}`);
    }
    let kind: string | undefined;
    try { r.build(); } catch (e: any) {
      kind = e.data?.errors?.find((it: any) => it.error.kind === 'method-limit')?.error.kind;
    }
    expect(kind).toBe('method-limit');
  });
});

describe('method token validation', () => {
  test('empty method must throw on add()/build()', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('whitespace method "GET POST" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET POST' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with control char "GET\\t" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET\t' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with delimiter "GET/" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET/' as any, '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method longer than 64 ASCII bytes must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('A'.repeat(65) as any, '/x', 'h');
      r.build();
    }).toThrow();
  });
});
