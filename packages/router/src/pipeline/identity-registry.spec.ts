import { describe, expect, it } from 'bun:test';

import { IdentityRegistry } from './identity-registry';

describe('IdentityRegistry — primitive interning', () => {
  it('returns the same id for two equal strings', () => {
    const r = new IdentityRegistry();
    expect(r.idFor('hello')).toBe(r.idFor('hello'));
  });

  it('returns the same id for two equal numbers', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(42)).toBe(r.idFor(42));
  });

  it('returns the same id for two equal booleans', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(true)).toBe(r.idFor(true));
  });

  it('returns the same id across null calls', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(null)).toBe(r.idFor(null));
  });

  it('returns the same id across undefined calls', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(undefined)).toBe(r.idFor(undefined));
  });

  it('isolates string keys from number keys (tagged keys prevent collision)', () => {
    const r = new IdentityRegistry();
    expect(r.idFor('1')).not.toBe(r.idFor(1));
  });

  it('isolates number 0 from boolean false', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(0)).not.toBe(r.idFor(false));
  });

  it('isolates null from undefined', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(null)).not.toBe(r.idFor(undefined));
  });

  it('interns bigint by string representation', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(BigInt(123))).toBe(r.idFor(BigInt(123)));
    expect(r.idFor(BigInt(123))).not.toBe(r.idFor(BigInt(456)));
  });

  it('interns symbols by their toString representation', () => {
    const r = new IdentityRegistry();
    const s = Symbol('x');
    expect(r.idFor(s)).toBe(r.idFor(s));
  });
});

describe('IdentityRegistry — object interning', () => {
  it('returns the same id for two calls with the same object reference', () => {
    const r = new IdentityRegistry();
    const obj = { x: 1 };
    expect(r.idFor(obj)).toBe(r.idFor(obj));
  });

  it('returns distinct ids for distinct object references even when structurally equal', () => {
    const r = new IdentityRegistry();
    expect(r.idFor({ x: 1 })).not.toBe(r.idFor({ x: 1 }));
  });

  it('returns the same id for two calls with the same function reference', () => {
    const r = new IdentityRegistry();
    const fn = () => 1;
    expect(r.idFor(fn)).toBe(r.idFor(fn));
  });

  it('returns distinct ids for distinct function references', () => {
    const r = new IdentityRegistry();
    expect(r.idFor(() => 1)).not.toBe(r.idFor(() => 1));
  });
});

describe('IdentityRegistry — id allocation', () => {
  it('hands out non-negative integer ids', () => {
    const r = new IdentityRegistry();
    const id = r.idFor('a');
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
  });

  it('hands out monotonically increasing ids on first observation', () => {
    const r = new IdentityRegistry();
    const first = r.idFor('a');
    const second = r.idFor('b');
    expect(second).toBe(first + 1);
  });
});
