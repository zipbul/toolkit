import { describe, expect, it } from 'bun:test';

import { serializeReferrerPolicy } from './serialize';
import { validateReferrerPolicy } from './validate';

describe('referrer-policy/serialize', () => {
  it('emits a single token', () => {
    expect(serializeReferrerPolicy(['no-referrer'])).toEqual([
      'referrer-policy',
      'no-referrer',
    ]);
  });
  it('joins multi-token fallback list with comma-space (W3C §8.1)', () => {
    expect(
      serializeReferrerPolicy(['unsafe-url', 'strict-origin-when-cross-origin']),
    ).toEqual(['referrer-policy', 'unsafe-url, strict-origin-when-cross-origin']);
  });
});

describe('referrer-policy/validate', () => {
  it('accepts all 8 valid tokens (W3C §8.1)', () => {
    for (const t of [
      'no-referrer',
      'no-referrer-when-downgrade',
      'origin',
      'origin-when-cross-origin',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'unsafe-url',
    ] as const) {
      expect(validateReferrerPolicy([t], 'rp')).toEqual([]);
    }
  });
  it('rejects empty list (W3C §4.1: 1#policy-token)', () => {
    expect(validateReferrerPolicy([], 'rp')).toHaveLength(1);
  });
  it('rejects unknown tokens', () => {
    expect(validateReferrerPolicy(['always' as never], 'rp')).toHaveLength(1);
    expect(validateReferrerPolicy(['' as never], 'rp')).toHaveLength(1);
  });
});
