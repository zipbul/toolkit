import { describe, expect, it } from 'bun:test';

import { Helmet, HelmetError } from '../../index';

import { resolveCacheControl, serializeCacheControl } from './serialize';

describe('cache-control', () => {
  it('default OWASP value when boolean true', () => {
    const r = resolveCacheControl(true);
    if (r === false || r === undefined) throw new Error('expected');
    expect(serializeCacheControl(r)).toEqual([['cache-control', 'no-store, max-age=0']]);
  });

  it('emits Pragma + Expires when requested', () => {
    const r = resolveCacheControl({ value: 'no-store', pragma: true, expires: true });
    if (r === false || r === undefined) throw new Error('expected');
    expect(serializeCacheControl(r)).toEqual([
      ['cache-control', 'no-store'],
      ['pragma', 'no-cache'],
      ['expires', '0'],
    ]);
  });

  it('false disables', () => {
    expect(resolveCacheControl(false)).toBe(false);
  });

  it('undefined remains undefined', () => {
    expect(resolveCacheControl(undefined)).toBe(undefined);
  });
});

describe('cache-control eager validation', () => {
  it('rejects CRLF in user-supplied value at create-time (header injection guard)', () => {
    expect(() =>
      Helmet.create({ cacheControl: { value: 'no-store\r\nX-Injected: yes' } }),
    ).toThrow(HelmetError);
  });
  it('rejects oversized value', () => {
    expect(() =>
      Helmet.create({ cacheControl: { value: 'a'.repeat(20_000) } }),
    ).toThrow(HelmetError);
  });
  it('rejects empty string', () => {
    expect(() => Helmet.create({ cacheControl: { value: '' } })).toThrow(HelmetError);
  });
  it('accepts a normal RFC 9111 directive list', () => {
    expect(() =>
      Helmet.create({ cacheControl: { value: 'public, max-age=3600, must-revalidate' } }),
    ).not.toThrow();
  });
});
