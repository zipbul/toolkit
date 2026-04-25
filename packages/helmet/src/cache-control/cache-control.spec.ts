import { describe, expect, it } from 'bun:test';

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
