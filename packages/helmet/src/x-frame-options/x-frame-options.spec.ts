import { describe, expect, it } from 'bun:test';

import { serializeXFrameOptions } from './serialize';
import { validateXFrameOptions } from './validate';

describe('x-frame-options/serialize', () => {
  it('preserves input case (WAF compatibility)', () => {
    expect(serializeXFrameOptions('deny')).toEqual(['x-frame-options', 'deny']);
    expect(serializeXFrameOptions('DENY')).toEqual(['x-frame-options', 'DENY']);
    expect(serializeXFrameOptions('sameorigin')).toEqual(['x-frame-options', 'sameorigin']);
    expect(serializeXFrameOptions('SAMEORIGIN')).toEqual(['x-frame-options', 'SAMEORIGIN']);
  });
});

describe('x-frame-options/validate', () => {
  it('accepts the four canonical values', () => {
    for (const v of ['deny', 'DENY', 'sameorigin', 'SAMEORIGIN']) {
      expect(validateXFrameOptions(v, 'xfo')).toEqual([]);
    }
  });
  it('rejects ALLOW-FROM (deprecated, ignored by browsers)', () => {
    expect(validateXFrameOptions('ALLOW-FROM https://x.example', 'xfo')).toHaveLength(1);
  });
  it('rejects empty / unknown', () => {
    expect(validateXFrameOptions('', 'xfo')).toHaveLength(1);
    expect(validateXFrameOptions('mango', 'xfo')).toHaveLength(1);
  });
  it('case-sensitive on lowercase forms — Deny is rejected', () => {
    expect(validateXFrameOptions('Deny', 'xfo')).toHaveLength(1);
  });
});
