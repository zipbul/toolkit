import { describe, expect, it } from 'bun:test';

import { serializeXXssProtection } from './serialize';
import { validateXXssProtection } from './validate';

describe('x-xss-protection/serialize', () => {
  it('emits 0 (OWASP-recommended disabling)', () => {
    expect(serializeXXssProtection('0')).toEqual(['x-xss-protection', '0']);
  });
  it('emits 1; mode=block', () => {
    expect(serializeXXssProtection('1; mode=block')).toEqual([
      'x-xss-protection',
      '1; mode=block',
    ]);
  });
});

describe('x-xss-protection/validate', () => {
  // Modern recommendation is `0`; the package restricts to the two safe values
  // and rejects the buggy `1`/`1; report=...` legacy forms by design.
  it('accepts 0', () => {
    expect(validateXXssProtection('0', 'xxp')).toEqual([]);
  });
  it('accepts 1; mode=block', () => {
    expect(validateXXssProtection('1; mode=block', 'xxp')).toEqual([]);
  });
  it('rejects 1 (legacy unsafe enable)', () => {
    expect(validateXXssProtection('1', 'xxp')).toHaveLength(1);
  });
  it('rejects 1; report=https://r.example/x (Chrome-only legacy)', () => {
    expect(validateXXssProtection('1; report=https://r.example/x', 'xxp')).toHaveLength(1);
  });
  it('rejects empty', () => {
    expect(validateXXssProtection('', 'xxp')).toHaveLength(1);
  });
  it('rejects garbage', () => {
    expect(validateXXssProtection('block', 'xxp')).toHaveLength(1);
  });
});
