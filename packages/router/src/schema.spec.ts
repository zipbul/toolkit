import { describe, it, expect } from 'bun:test';

import {
  METHOD_OFFSET,
  NODE_STRIDE,
  NODE_OFFSET_META,
  NODE_OFFSET_METHOD_MASK,
  NODE_OFFSET_MATCH_FUNC,
  NODE_OFFSET_STATIC_CHILD_PTR,
  NODE_OFFSET_STATIC_CHILD_COUNT,
  NODE_OFFSET_PARAM_CHILD_PTR,
  NODE_OFFSET_WILDCARD_CHILD_PTR,
  NODE_OFFSET_METHODS_PTR,
  PARAM_ENTRY_STRIDE,
} from './schema';

describe('schema constants', () => {
  it('should have correct METHOD_OFFSET values', () => {
    expect(METHOD_OFFSET.GET).toBe(0);
    expect(METHOD_OFFSET.POST).toBe(1);
    expect(METHOD_OFFSET.PUT).toBe(2);
    expect(METHOD_OFFSET.PATCH).toBe(3);
    expect(METHOD_OFFSET.DELETE).toBe(4);
    expect(METHOD_OFFSET.OPTIONS).toBe(5);
    expect(METHOD_OFFSET.HEAD).toBe(6);
  });

  it('should have NODE_STRIDE = 8', () => {
    expect(NODE_STRIDE).toBe(8);
  });

  it('should have sequential node offsets within NODE_STRIDE', () => {
    const offsets = [
      NODE_OFFSET_META,
      NODE_OFFSET_METHOD_MASK,
      NODE_OFFSET_MATCH_FUNC,
      NODE_OFFSET_STATIC_CHILD_PTR,
      NODE_OFFSET_STATIC_CHILD_COUNT,
      NODE_OFFSET_PARAM_CHILD_PTR,
      NODE_OFFSET_WILDCARD_CHILD_PTR,
      NODE_OFFSET_METHODS_PTR,
    ];
    // All offsets should be unique and 0–7
    const unique = new Set(offsets);
    expect(unique.size).toBe(NODE_STRIDE);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(NODE_STRIDE);
    }
  });

  it('should have PARAM_ENTRY_STRIDE = 2', () => {
    expect(PARAM_ENTRY_STRIDE).toBe(2);
  });
});
