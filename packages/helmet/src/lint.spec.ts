import { describe, expect, it } from 'bun:test';

import { Csp } from './constants';
import { lintCsp } from './lint';

describe('lintCsp', () => {
  it('flags wildcard in script-src', () => {
    const findings = lintCsp({ scriptSrc: ['*'] as never });
    expect(findings.some(f => f.directive === 'scriptSrc' && f.severity === 'high')).toBe(true);
  });

  it("flags 'unsafe-eval'", () => {
    const findings = lintCsp({ scriptSrc: [Csp.Self, Csp.UnsafeEval] });
    expect(
      findings.some(f => f.directive === 'script-src' && f.message.includes("'unsafe-eval'")),
    ).toBe(true);
  });

  it("flags unsafe-inline without nonce in strict mode", () => {
    const findings = lintCsp(
      { scriptSrc: [Csp.Self, Csp.UnsafeInline] },
      { level: 'strict' },
    );
    expect(findings.some(f => f.message.includes("'unsafe-inline'"))).toBe(true);
  });

  it('does NOT flag unsafe-inline-with-nonce in strict mode (nonce neutralises)', () => {
    const findings = lintCsp(
      {
        scriptSrc: [Csp.Self, Csp.UnsafeInline, "'nonce-AAAAAAAAAAAAAAAA'" as never],
      },
      { level: 'strict' },
    );
    expect(findings.some(f => f.message.includes("'unsafe-inline'"))).toBe(false);
  });

  it("flags missing object-src 'none'", () => {
    const findings = lintCsp({ scriptSrc: [Csp.Self] });
    expect(findings.some(f => f.directive === 'object-src')).toBe(true);
  });

  it("does NOT flag object-src when set to 'none'", () => {
    const findings = lintCsp({ scriptSrc: [Csp.Self], objectSrc: [Csp.None], baseUri: [Csp.Self] });
    expect(findings.some(f => f.directive === 'object-src')).toBe(false);
  });

  it('flags missing base-uri', () => {
    const findings = lintCsp({ scriptSrc: [Csp.Self], objectSrc: [Csp.None] });
    expect(findings.some(f => f.directive === 'base-uri')).toBe(true);
  });

  it('handles undefined input gracefully', () => {
    expect(lintCsp(undefined)).toEqual(expect.arrayContaining([
      expect.objectContaining({ directive: 'object-src' }),
      expect.objectContaining({ directive: 'base-uri' }),
    ]));
  });

  it('falls back to defaultSrc when scriptSrc absent', () => {
    const findings = lintCsp({ defaultSrc: [Csp.Self, Csp.UnsafeEval] });
    expect(findings.some(f => f.directive === 'script-src')).toBe(true);
  });
});
