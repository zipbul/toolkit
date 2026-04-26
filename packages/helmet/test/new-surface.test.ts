import { describe, expect, it } from 'bun:test';

import { Helmet, HelmetError } from '../index';

describe('Helmet.endpoints()', () => {
  it('serialises a Reporting-Endpoints header', () => {
    const [name, value] = Helmet.endpoints({
      default: 'https://r.example/csp',
      backup: 'https://r.example/backup',
    });
    expect(name).toBe('reporting-endpoints');
    expect(value).toBe('default="https://r.example/csp", backup="https://r.example/backup"');
  });

  it('rejects http:// endpoints', () => {
    expect(() => Helmet.endpoints({ default: 'http://r.example/csp' })).toThrow(HelmetError);
  });

  it('rejects prototype-pollution keys', () => {
    const polluted = JSON.parse('{"__proto__":"https://r.example/csp"}') as Record<string, string>;
    expect(() => Helmet.endpoints(polluted)).toThrow(HelmetError);
  });
});

describe('CSP nonce injection — edge cases', () => {
  it('strips placeholder cleanly when no nonce supplied', () => {
    const csp = Helmet.create().headersRecord()['content-security-policy']!;
    expect(csp).not.toContain('__zipbul_helmet_nonce__');
    expect(csp).not.toContain(' ;');
    expect(csp).not.toContain('  ');
  });

  it('rejects malformed nonces', () => {
    expect(() => Helmet.create().headersRecord({ nonce: 'short' })).toThrow(HelmetError);
    expect(() => Helmet.create().headersRecord({ nonce: 'a$$$' })).toThrow(HelmetError);
  });

  it('per-request nonce is not memoized across calls', () => {
    const helmet = Helmet.create();
    const a = helmet.headersRecord({ nonce: 'AAAAAAAAAAAAAAAA' });
    const b = helmet.headersRecord({ nonce: 'BBBBBBBBBBBBBBBB' });
    expect(a['content-security-policy']).toContain('AAAAAAAAAAAAAAAA');
    expect(b['content-security-policy']).toContain('BBBBBBBBBBBBBBBB');
    expect(b['content-security-policy']).not.toContain('AAAAAAAAAAAAAAAA');
  });
});

describe('Response/304 + opaque edge cases', () => {
  it('passes 304 Not Modified through unchanged', () => {
    const response = new Response(null, { status: 304 });
    const out = Helmet.create().apply(response);
    expect(out).toBe(response);
  });

  it('throws on opaque/error responses', () => {
    const r = Response.error();
    expect(() => Helmet.create().apply(r)).toThrow(HelmetError);
  });

  it('preserves multiple Set-Cookie headers', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    const response = new Response('ok', { headers });
    const out = Helmet.create().apply(response);
    const cookies = out.headers.getSetCookie();
    expect(cookies.length).toBe(2);
  });
});

describe('CSP fuzz — round-trip resilience', () => {
  it('100 random host sources never corrupt output or throw unrelated errors', () => {
    const RNG = mulberry32(0xdeadbeef);
    let validated = 0;
    for (let i = 0; i < 100; i++) {
      const host = `${pick(RNG, ['', 'https://', 'http://'])}${pick(RNG, ['*.', ''])}${randAscii(RNG, 1, 12)}.example${pick(RNG, ['', ':*', ':8080'])}${pick(RNG, ['', '/x', '/y/z'])}`;
      try {
        const [, value] = Helmet.csp({ directives: { defaultSrc: ['\'self\'', host as never] } });
        expect(value).toContain(host);
        validated++;
      } catch (err) {
        expect(err).toBeInstanceOf(HelmetError);
      }
    }
    expect(validated).toBeGreaterThan(0);
  });
});

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, choices: readonly T[]): T {
  return choices[Math.floor(rng() * choices.length)]!;
}
function randAscii(rng: () => number, lo: number, hi: number): string {
  const len = lo + Math.floor(rng() * (hi - lo));
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(97 + Math.floor(rng() * 26));
  return s;
}
