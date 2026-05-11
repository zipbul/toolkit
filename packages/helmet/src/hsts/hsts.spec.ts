import { describe, expect, it } from 'bun:test';

import { resolveHsts, serializeHsts, validateHsts } from './serialize';

describe('hsts', () => {
  it('default emits 2-year max-age + includeSubDomains', () => {
    const r = resolveHsts(undefined);
    if (r === false) throw new Error('expected');
    const [, value] = serializeHsts(r);
    expect(value).toBe('max-age=63072000; includeSubDomains');
  });

  it('preload emits all three directives', () => {
    const r = resolveHsts({ maxAge: 31536000, includeSubDomains: true, preload: true });
    if (r === false) throw new Error('expected');
    const [, value] = serializeHsts(r);
    expect(value).toBe('max-age=31536000; includeSubDomains; preload');
  });

  it('preload requires max-age >= 1 year', () => {
    const r = resolveHsts({ maxAge: 1000, includeSubDomains: true, preload: true });
    if (r === false) throw new Error('expected');
    const out = validateHsts(r, 'hsts');
    expect(out.some(v => v.reason === 'hsts_preload_requirement_missing')).toBe(true);
  });

  it('preload requires includeSubDomains', () => {
    const r = resolveHsts({ maxAge: 63072000, includeSubDomains: false, preload: true });
    if (r === false) throw new Error('expected');
    const out = validateHsts(r, 'hsts');
    expect(out.some(v => v.reason === 'hsts_preload_requirement_missing' && v.message.includes('includeSubDomains'))).toBe(true);
  });

  it('rejects negative max-age', () => {
    const r = resolveHsts({ maxAge: -1 });
    if (r === false) throw new Error('expected');
    const out = validateHsts(r, 'hsts');
    expect(out.some(v => v.reason === 'hsts_max_age_invalid')).toBe(true);
  });

  it('omits includeSubDomains when explicitly disabled', () => {
    const r = resolveHsts({ maxAge: 100, includeSubDomains: false });
    if (r === false) throw new Error('expected');
    expect(serializeHsts(r)[1]).toBe('max-age=100');
  });
});
