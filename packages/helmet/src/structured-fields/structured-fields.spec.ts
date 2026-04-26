import { describe, expect, it } from 'bun:test';

import {
  serializeBoolean,
  serializeDecimal,
  serializeDictionary,
  serializeInnerList,
  serializeInteger,
  serializeItem,
  serializeString,
  serializeToken,
  token,
} from './serialize';

describe('structured-fields/serialize', () => {
  it('emits sf-boolean', () => {
    expect(serializeBoolean(true)).toBe('?1');
    expect(serializeBoolean(false)).toBe('?0');
  });

  it('emits sf-token', () => {
    expect(serializeToken('script')).toBe('script');
    expect(() => serializeToken('1bad')).toThrow();
  });

  it('escapes sf-string', () => {
    expect(serializeString('hello')).toBe('"hello"');
    expect(serializeString('he"llo')).toBe('"he\\"llo"');
    expect(serializeString('back\\slash')).toBe('"back\\\\slash"');
    expect(() => serializeString('bad\nctrl')).toThrow();
  });

  it('rejects non-ASCII per RFC 9651 §3.3.3 (printable ASCII only)', () => {
    // U+00E9 (é) — outside %x20-7E, must be rejected
    expect(() => serializeString('café')).toThrow();
    // DEL (0x7F) — also forbidden
    expect(() => serializeString('a\x7fb')).toThrow();
    // Boundary: 0x7E (~) is valid
    expect(serializeString('~')).toBe('"~"');
  });

  it('emits sf-integer / decimal', () => {
    expect(serializeInteger(42)).toBe('42');
    expect(serializeDecimal(0.5)).toBe('0.5');
    expect(serializeDecimal(1)).toBe('1.0');
  });

  it('rejects sf-decimal with > 12 integer digits per RFC 9651 §3.3.2', () => {
    expect(() => serializeDecimal(1_000_000_000_000)).toThrow();
    expect(() => serializeDecimal(-1_000_000_000_000)).toThrow();
    expect(serializeDecimal(999_999_999_999.999)).toBe('999999999999.999');
  });

  it('rejects non-finite sf-decimal (Infinity / -Infinity / NaN)', () => {
    expect(() => serializeDecimal(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => serializeDecimal(Number.NEGATIVE_INFINITY)).toThrow(/finite/);
    expect(() => serializeDecimal(Number.NaN)).toThrow(/finite/);
  });

  it('routes sf-item by type', () => {
    expect(serializeItem(true)).toBe('?1');
    expect(serializeItem(7)).toBe('7');
    expect(serializeItem(token('inline'))).toBe('inline');
    expect(serializeItem('hello')).toBe('"hello"');
  });

  it('emits inner list', () => {
    expect(serializeInnerList([token('script'), token('style')])).toBe('(script style)');
    expect(serializeInnerList([])).toBe('()');
  });

  it('emits dictionary preserving Map insertion order', () => {
    const dict = new Map<string, never>();
    dict.set('default', 'https://r.example/' as never);
    dict.set('csp', 'https://r.example/csp' as never);
    expect(serializeDictionary(dict as never)).toBe(
      'default="https://r.example/", csp="https://r.example/csp"',
    );
  });

  it('sugars boolean true to bare key in dict', () => {
    const dict = new Map<string, never>();
    dict.set('a', true as never);
    dict.set('b', false as never);
    expect(serializeDictionary(dict as never)).toBe('a, b=?0');
  });

  it('rejects dictionary key that violates RFC 9651 §3.2 grammar (lcalpha-only)', () => {
    const dict = new Map<string, never>();
    dict.set('BadUppercase', true as never);
    expect(() => serializeDictionary(dict as never)).toThrow(/invalid dictionary key/);
  });

  it('emits dict inner list members', () => {
    const dict = new Map<string, never>();
    dict.set('blocked-destinations', { innerList: [token('script'), token('style')] } as never);
    expect(serializeDictionary(dict as never)).toBe('blocked-destinations=(script style)');
  });
});
