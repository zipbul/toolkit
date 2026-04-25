import { describe, expect, it } from 'bun:test';

import {
  isValidCoep,
  isValidCoop,
  isValidCorp,
  serializeCoep,
  serializeCoepReportOnly,
  serializeCoop,
  serializeCoopReportOnly,
  serializeCorp,
} from './serialize';

describe('cross-origin', () => {
  it('serializeCoop emits all 4 values', () => {
    for (const v of ['same-origin', 'same-origin-allow-popups', 'noopener-allow-popups', 'unsafe-none'] as const) {
      expect(serializeCoop(v)).toEqual(['cross-origin-opener-policy', v]);
    }
  });

  it('serializeCoep / Report-Only', () => {
    expect(serializeCoep('require-corp')).toEqual(['cross-origin-embedder-policy', 'require-corp']);
    expect(serializeCoepReportOnly('credentialless')).toEqual([
      'cross-origin-embedder-policy-report-only',
      'credentialless',
    ]);
  });

  it('serializeCorp', () => {
    for (const v of ['same-origin', 'same-site', 'cross-origin'] as const) {
      expect(serializeCorp(v)).toEqual(['cross-origin-resource-policy', v]);
    }
  });

  it('serializeCoopReportOnly', () => {
    expect(serializeCoopReportOnly('same-origin')).toEqual([
      'cross-origin-opener-policy-report-only',
      'same-origin',
    ]);
  });

  it('isValid* type guards', () => {
    expect(isValidCoop('same-origin')).toBe(true);
    expect(isValidCoop('bogus')).toBe(false);
    expect(isValidCoep('require-corp')).toBe(true);
    expect(isValidCorp('same-site')).toBe(true);
  });
});
