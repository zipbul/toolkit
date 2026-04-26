import { describe, expect, it } from 'bun:test';

import { resolveDocumentPolicy, serializeDocumentPolicy } from './serialize';

describe('document-policy/resolve', () => {
  it('returns undefined when no input', () => {
    expect(resolveDocumentPolicy(undefined, 'dp', [])).toBeUndefined();
  });

  it('resolves scalar and array values', () => {
    const out = resolveDocumentPolicy(
      { policies: { 'oversized-images': 1.5, 'document-write': false, 'lossless-images-strategy': ['inline'] } },
      'dp',
      [],
    );
    expect(out?.policies.get('oversized-images')).toBe(1.5);
    expect(out?.policies.get('document-write')).toBe(false);
    expect(out?.policies.get('lossless-images-strategy')).toEqual(['inline']);
  });

  it('flags non-Object.prototype prototype chain (Object.create attack)', () => {
    const malicious = Object.create({ polluted: 'evil' });
    const violations: never[] = [];
    resolveDocumentPolicy(
      { policies: malicious },
      'dp',
      violations as never,
    );
    expect(
      (violations as never[]).some(
        (v: never) => (v as { reason: string }).reason === 'reserved_key_denied',
      ),
    ).toBe(true);
  });

  it('flags __proto__ key (prototype pollution guard)', () => {
    // JSON.parse preserves `__proto__` as an own enumerable property (unlike
    // object literals, which set the prototype). This is the realistic
    // attack vector when input arrives as JSON over the wire.
    const polluted = JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown>;
    const violations: never[] = [];
    resolveDocumentPolicy(
      { policies: polluted as never },
      'dp',
      violations as never,
    );
    expect(
      (violations as never[]).some(
        (v: never) => (v as { reason: string }).reason === 'reserved_key_denied',
      ),
    ).toBe(true);
  });

  it('flags too-many entries', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) big[`policy-${i}`] = true;
    const violations: never[] = [];
    resolveDocumentPolicy({ policies: big as never }, 'dp', violations as never);
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'input_too_large')).toBe(true);
  });
});

describe('document-policy/serialize', () => {
  it('emits sf-dictionary with token strings unquoted', () => {
    const r = resolveDocumentPolicy(
      { policies: { 'lossless-images-strategy': 'inline' } },
      'dp',
      [],
    )!;
    expect(serializeDocumentPolicy(r)).toEqual([
      'document-policy',
      'lossless-images-strategy=inline',
    ]);
  });

  it('emits booleans (true sugars to bare key, false → ?0)', () => {
    const r = resolveDocumentPolicy(
      { policies: { 'document-write': false, 'force-load-at-top': true } },
      'dp',
      [],
    )!;
    const [, value] = serializeDocumentPolicy(r);
    expect(value).toContain('document-write=?0');
    expect(value).toContain('force-load-at-top');
  });

  it('emits decimal values per RFC 9651 §3.3.2', () => {
    // JS `2.0` is the integer 2; use a fractional value to exercise sf-decimal.
    const r = resolveDocumentPolicy(
      { policies: { 'oversized-images': 2.5 } },
      'dp',
      [],
    )!;
    expect(serializeDocumentPolicy(r)[1]).toBe('oversized-images=2.5');
  });

  it('emits inner list for array values', () => {
    const r = resolveDocumentPolicy(
      { policies: { 'lossless-images-strategy': ['inline', 'noimage'] } },
      'dp',
      [],
    )!;
    expect(serializeDocumentPolicy(r)[1]).toBe(
      'lossless-images-strategy=(inline noimage)',
    );
  });
});
