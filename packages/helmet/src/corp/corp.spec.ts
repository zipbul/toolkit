import { describe, expect, it } from 'bun:test';

import { isValidCorp, serializeCorp } from './serialize';

describe('corp', () => {
  it('serializes all 3 values', () => {
    for (const v of ['same-origin', 'same-site', 'cross-origin'] as const) {
      expect(serializeCorp(v)).toEqual(['cross-origin-resource-policy', v]);
    }
  });

  it('isValidCorp type guard', () => {
    expect(isValidCorp('same-site')).toBe(true);
    expect(isValidCorp('bogus')).toBe(false);
  });
});
