import { describe, expect, it } from 'bun:test';

import { isValidCoop, serializeCoop, serializeCoopReportOnly } from './serialize';

describe('coop', () => {
  it('serializes all 4 values', () => {
    for (const v of [
      'same-origin',
      'same-origin-allow-popups',
      'noopener-allow-popups',
      'unsafe-none',
    ] as const) {
      expect(serializeCoop({ value: v })).toEqual(['cross-origin-opener-policy', v]);
    }
  });

  it('serializes Report-Only variant', () => {
    expect(serializeCoopReportOnly({ value: 'same-origin' })).toEqual([
      'cross-origin-opener-policy-report-only',
      'same-origin',
    ]);
  });

  it('attaches report-to parameter (HTML §7.1.3.1)', () => {
    expect(serializeCoop({ value: 'same-origin', reportTo: 'coop-ep' })).toEqual([
      'cross-origin-opener-policy',
      'same-origin; report-to="coop-ep"',
    ]);
  });

  it('isValidCoop type guard', () => {
    expect(isValidCoop('same-origin')).toBe(true);
    expect(isValidCoop('bogus')).toBe(false);
  });
});
