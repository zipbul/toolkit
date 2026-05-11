import { describe, expect, it } from 'bun:test';

import { Csp, Helmet, HelmetError } from '../index';
import { serializeString, serializeDecimal, serializeInteger } from '../src/structured-fields/serialize';

/**
 * Property-based smoke tests for invariants that should hold for any input
 * shape — defends against regressions in validation, escaping, and grammar
 * acceptance/rejection.
 */

function randomBytes(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode((Math.random() * 256) | 0);
  return s;
}

/** RFC 9651 §4.2.5 character-by-character sf-string parser. */
function decodeSfString(emitted: string): string {
  if (!emitted.startsWith('"') || !emitted.endsWith('"') || emitted.length < 2) {
    throw new Error('not a quoted string');
  }
  const inner = emitted.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\') {
      const next = inner[++i];
      if (next !== '"' && next !== '\\') throw new Error('invalid escape');
      out += next;
    } else if (c === '"') {
      throw new Error('raw DQUOTE inside body');
    } else {
      out += c;
    }
  }
  return out;
}

describe('fuzz: structured-fields sf-string', () => {
  it('rejects every input containing a non-ASCII byte (RFC 9651 §3.3.3)', () => {
    for (let i = 0; i < 200; i++) {
      const buf = randomBytes(8);
      const hasBad = [...buf].some(c => {
        const code = c.charCodeAt(0);
        return code < 0x20 || code === 0x7f || code > 0x7f;
      });
      let threw = false;
      try {
        serializeString(buf);
      } catch {
        threw = true;
      }
      expect(threw).toBe(hasBad);
    }
  });

  it('round-trips printable ASCII through the RFC 9651 §4.2.5 decoder', () => {
    for (let i = 0; i < 200; i++) {
      let s = '';
      const len = (Math.random() * 16) | 0;
      for (let j = 0; j < len; j++) {
        s += String.fromCharCode(0x20 + ((Math.random() * (0x7e - 0x20 + 1)) | 0));
      }
      const out = serializeString(s);
      expect(decodeSfString(out)).toBe(s);
    }
  });
});

describe('fuzz: structured-fields sf-integer / sf-decimal range', () => {
  it('accepts 15-digit integers; rejects beyond', () => {
    expect(() => serializeInteger(999_999_999_999_999)).not.toThrow();
    expect(() => serializeInteger(-999_999_999_999_999)).not.toThrow();
    expect(() => serializeInteger(1_000_000_000_000_000)).toThrow();
    expect(() => serializeInteger(-1_000_000_000_000_000)).toThrow();
  });

  it('rejects sf-decimal with > 12 integer digits at the boundary', () => {
    expect(() => serializeDecimal(999_999_999_999.999)).not.toThrow();
    expect(() => serializeDecimal(1_000_000_000_000)).toThrow();
  });
});

describe('fuzz: Helmet.create rejects malformed CSP sources', () => {
  // Each sample is grammar-invalid per CSP3 §2.3.1. Helmet.create must throw
  // HelmetError. (Note: `javascript:` IS a valid scheme-source per the
  // grammar even though it's a poor choice operationally — excluded from
  // this rejection set.)
  it('throws on every malformed sample', () => {
    const samples = [
      "'self",
      "'unsafe-eval",
      'http://',
      'https:///',
      'https://*.*.example.com',
      "'sha256-short'",
      "'nonce-'",
      ' https://x',
      'https://x ',
      'https://x\r\nX-Bad: yes',
    ];
    for (const src of samples) {
      let threw = false;
      try {
        Helmet.create({
          contentSecurityPolicy: {
            directives: { scriptSrc: [src as never, Csp.Self] },
          },
        });
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(HelmetError);
      }
      if (!threw) throw new Error(`sample unexpectedly accepted: ${JSON.stringify(src)}`);
    }
  });

  it('output contains no CR/LF in any header value (header-injection guard)', () => {
    const helmet = Helmet.create({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: [Csp.Self, 'https://a.example', 'https://b.example:8443'],
          styleSrc: [Csp.Self],
        },
      },
      reportingEndpoints: {
        endpoints: { csp: 'https://r.example/csp' as never },
      },
      crossOriginOpenerPolicy: { value: 'same-origin', reportTo: 'csp' },
    });
    for (const [, value] of helmet.headers()) {
      expect(value).not.toMatch(/\r|\n/);
    }
  });
});

describe('fuzz: Permissions-Policy origin validation', () => {
  it('every accepted origin emits a parseable URL', () => {
    const origins = [
      'https://x.example',
      'https://x.example:8443',
      'http://localhost:3000',
      'https://a.b.c.example/',
    ];
    for (const o of origins) {
      const helmet = Helmet.create({
        permissionsPolicy: { features: { camera: [o] } },
      });
      const value = helmet.headers().get('permissions-policy') ?? '';
      expect(value).toMatch(/camera=\([^)]*"https?:\/\/[^"]+"\)/);
    }
  });

  it('null-origin and non-http schemes always throw', () => {
    for (const bad of ['file:///', 'data:text/plain,hi', 'javascript:alert(1)', 'about:blank']) {
      let threw = false;
      try {
        Helmet.create({ permissionsPolicy: { features: { camera: [bad] } } });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
  });
});
