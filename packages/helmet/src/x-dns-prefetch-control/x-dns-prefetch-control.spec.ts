import { describe, expect, it } from 'bun:test';

import { serializeXDnsPrefetchControl } from './serialize';
import { validateXDnsPrefetchControl } from './validate';

describe('x-dns-prefetch-control/serialize', () => {
  it('emits on/off', () => {
    expect(serializeXDnsPrefetchControl('on')).toEqual(['x-dns-prefetch-control', 'on']);
    expect(serializeXDnsPrefetchControl('off')).toEqual(['x-dns-prefetch-control', 'off']);
  });
});

describe('x-dns-prefetch-control/validate', () => {
  it('accepts on / off', () => {
    expect(validateXDnsPrefetchControl('on', 'xdpc')).toEqual([]);
    expect(validateXDnsPrefetchControl('off', 'xdpc')).toEqual([]);
  });
  it('rejects unknown / case variants', () => {
    expect(validateXDnsPrefetchControl('ON', 'xdpc')).toHaveLength(1);
    expect(validateXDnsPrefetchControl('', 'xdpc')).toHaveLength(1);
    expect(validateXDnsPrefetchControl('1', 'xdpc')).toHaveLength(1);
  });
});
