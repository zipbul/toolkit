import { describe, test, expect } from 'bun:test';

import { Router } from '../router';

describe('method token grammar accepts valid custom tokens', () => {
  test.each([['PROPFIND'], ['PATCH+X'], ['foo'], ['get'], ['CUSTOM-METHOD_X.0'], ["M!#$%&'*+-.^_`|~0"]])('accepts %s', method => {
    const r = new Router<string>();
    expect(() => {
      r.add(method, '/x', 'h');
      r.build();
    }).not.toThrow();
    expect(r.match(method, '/x')?.value).toBe('h');
  });

  test('accepts a method exactly 64 ASCII bytes (boundary)', () => {
    const r = new Router<string>();
    const m = 'X'.repeat(64);
    expect(() => {
      r.add(m, '/x', 'h');
      r.build();
    }).not.toThrow();
  });

  test('case-sensitive: GET and get are distinct registrations', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'upper');
    r.add('get', '/x', 'lower');
    r.build();
    expect(r.match('GET', '/x')?.value).toBe('upper');
    expect(r.match('get', '/x')?.value).toBe('lower');
  });
});

describe('32-method limit boundary', () => {
  test('accepts exactly 32 distinct method tokens (7 default + 25 custom)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 25; i++) {
      r.add(`CUSTOM${i}`, '/x', `h${i}`);
    }
    expect(() => r.build()).not.toThrow();
  });

  test('rejects the 33rd distinct method with method-limit', () => {
    const r = new Router<string>();
    for (let i = 0; i < 26; i++) {
      r.add(`CUSTOM${i}`, '/x', `h${i}`);
    }
    let kind: string | undefined;
    try {
      r.build();
    } catch (e: any) {
      kind = e.data?.errors?.find((it: any) => it.error.kind === 'method-limit')?.error.kind;
    }
    expect(kind).toBe('method-limit');
  });
});

describe('HEAD and OPTIONS get no implicit fallback', () => {
  test('HEAD does not match a GET-only registration', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'g');
    r.build();
    expect(r.match('HEAD', '/x')).toBeNull();
    expect(r.allowedMethods('/x')).toEqual(['GET']);
  });

  test('OPTIONS is not generated implicitly', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'g');
    r.add('POST', '/x', 'p');
    r.build();
    expect(r.match('OPTIONS', '/x')).toBeNull();
    expect([...r.allowedMethods('/x')].sort()).toEqual(['GET', 'POST']);
  });
});

describe('method token validation', () => {
  test('empty method must throw on add()/build()', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('', '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('whitespace method "GET POST" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET POST', '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with control char "GET\\t" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET\t', '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('method with delimiter "GET/" must throw', () => {
    const r = new Router<string>();
    expect(() => {
      r.add('GET/', '/x', 'h');
      r.build();
    }).toThrow();
  });

  test('long valid-tchar method tokens are accepted (no length cap; RFC 9110 §2.3)', () => {
    const r = new Router<string>();
    r.add('A'.repeat(1024), '/x', 'h');
    r.build();
    expect(r.match('A'.repeat(1024), '/x')?.value).toBe('h');
  });
});
