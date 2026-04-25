import { describe, expect, it } from 'bun:test';

import { Csp, Helmet, fromHelmetOptions } from '../index';

/**
 * Audit: every helmet 8.x feature must work in @zipbul/helmet.
 * helmet 8.x ships these middleware (per `helmet/types/index.d.ts`):
 *   contentSecurityPolicy, crossOriginEmbedderPolicy,
 *   crossOriginOpenerPolicy, crossOriginResourcePolicy,
 *   originAgentCluster, referrerPolicy, strictTransportSecurity,
 *   xContentTypeOptions, xDnsPrefetchControl, xDownloadOptions,
 *   xFrameOptions, xPermittedCrossDomainPolicies, xPoweredBy,
 *   xXssProtection
 */

describe('helmet 8.x parity — every header surfaces', () => {
  it('contentSecurityPolicy: false disables', () => {
    const h = Helmet.create({ contentSecurityPolicy: false });
    expect(h.headers().get('content-security-policy')).toBeNull();
  });

  it('contentSecurityPolicy: { directives } overrides per-directive', () => {
    const h = Helmet.create({
      contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self, 'https://cdn.example/'] } },
    });
    const csp = h.headers().get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' https://cdn.example/");
  });

  it('crossOriginEmbedderPolicy off by default, on when set', () => {
    expect(Helmet.create().headers().get('cross-origin-embedder-policy')).toBeNull();
    expect(
      Helmet.create({ crossOriginEmbedderPolicy: 'require-corp' })
        .headers()
        .get('cross-origin-embedder-policy'),
    ).toBe('require-corp');
    expect(
      Helmet.create({ crossOriginEmbedderPolicy: 'credentialless' })
        .headers()
        .get('cross-origin-embedder-policy'),
    ).toBe('credentialless');
  });

  it('crossOriginOpenerPolicy supports all 4 values', () => {
    for (const v of ['same-origin', 'same-origin-allow-popups', 'noopener-allow-popups', 'unsafe-none'] as const) {
      expect(Helmet.create({ crossOriginOpenerPolicy: v }).headers().get('cross-origin-opener-policy')).toBe(v);
    }
  });

  it('crossOriginResourcePolicy supports all 3 values', () => {
    for (const v of ['same-origin', 'same-site', 'cross-origin'] as const) {
      expect(Helmet.create({ crossOriginResourcePolicy: v }).headers().get('cross-origin-resource-policy')).toBe(v);
    }
  });

  it('originAgentCluster on by default, off=?0', () => {
    expect(Helmet.create().headers().get('origin-agent-cluster')).toBe('?1');
    expect(Helmet.create({ originAgentCluster: false }).headers().get('origin-agent-cluster')).toBe('?0');
  });

  it('referrerPolicy supports all 8 tokens, single or array', () => {
    for (const v of [
      'no-referrer',
      'no-referrer-when-downgrade',
      'origin',
      'origin-when-cross-origin',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'unsafe-url',
    ] as const) {
      expect(Helmet.create({ referrerPolicy: v }).headers().get('referrer-policy')).toBe(v);
    }
    // Multi-token fallback list
    expect(
      Helmet.create({ referrerPolicy: ['no-referrer', 'strict-origin-when-cross-origin'] })
        .headers()
        .get('referrer-policy'),
    ).toBe('no-referrer, strict-origin-when-cross-origin');
  });

  it('strictTransportSecurity emits all 3 directives', () => {
    const h = Helmet.create({
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
    });
    expect(h.headers().get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('strictTransportSecurity: false disables', () => {
    expect(
      Helmet.create({ strictTransportSecurity: false })
        .headers()
        .get('strict-transport-security'),
    ).toBeNull();
  });

  it('xContentTypeOptions: nosniff default, false disables', () => {
    expect(Helmet.create().headers().get('x-content-type-options')).toBe('nosniff');
    expect(Helmet.create({ xContentTypeOptions: false }).headers().get('x-content-type-options')).toBeNull();
  });

  it('xDnsPrefetchControl: on/off', () => {
    expect(Helmet.create().headers().get('x-dns-prefetch-control')).toBe('off');
    expect(Helmet.create({ xDnsPrefetchControl: 'on' }).headers().get('x-dns-prefetch-control')).toBe('on');
  });

  it('xDownloadOptions: opt-in only, emits noopen', () => {
    expect(Helmet.create().headers().get('x-download-options')).toBeNull();
    expect(Helmet.create({ xDownloadOptions: true }).headers().get('x-download-options')).toBe('noopen');
  });

  it('xFrameOptions preserves input case', () => {
    expect(Helmet.create().headers().get('x-frame-options')).toBe('deny');
    expect(Helmet.create({ xFrameOptions: 'DENY' }).headers().get('x-frame-options')).toBe('DENY');
    expect(Helmet.create({ xFrameOptions: 'sameorigin' }).headers().get('x-frame-options')).toBe('sameorigin');
    expect(Helmet.create({ xFrameOptions: 'SAMEORIGIN' }).headers().get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('xPermittedCrossDomainPolicies all 4 values', () => {
    for (const v of ['none', 'master-only', 'by-content-type', 'all'] as const) {
      expect(
        Helmet.create({ xPermittedCrossDomainPolicies: v })
          .headers()
          .get('x-permitted-cross-domain-policies'),
      ).toBe(v);
    }
  });

  it('xPoweredBy removal default — server header strip', () => {
    const h = Helmet.create();
    expect(h.headersToRemove()).toContain('x-powered-by');
    const out = h.apply(new Response('x', { headers: { 'X-Powered-By': 'PHP' } }));
    expect(out.headers.get('x-powered-by')).toBeNull();
  });

  it('xXssProtection: opt-in only, "0" or "1; mode=block"', () => {
    expect(Helmet.create().headers().get('x-xss-protection')).toBeNull();
    expect(Helmet.create({ xXssProtection: '0' }).headers().get('x-xss-protection')).toBe('0');
    expect(Helmet.create({ xXssProtection: '1; mode=block' }).headers().get('x-xss-protection')).toBe('1; mode=block');
  });
});

describe('helmet 8.x parity — CSP nonce fallback safety', () => {
  it('REGRESSION: headers({nonce}) on default Helmet must NOT break default-src fallback', () => {
    const h = Helmet.create();
    const nonce = Helmet.generateNonce();
    const csp = h.headers({ nonce }).get('content-security-policy') ?? '';
    expect(csp).toContain(`'nonce-${nonce}'`);
    // Critical: when scriptSrc is not explicitly set, nonce MUST be combined
    // with the default-src fallback, otherwise scripts from 'self' break.
    if (csp.includes('script-src ')) {
      expect(csp).toMatch(new RegExp(`script-src[^;]*'self'[^;]*'nonce-${nonce}'|script-src[^;]*'nonce-${nonce}'[^;]*'self'`));
    }
  });

  it('headers({nonce}) preserves user scriptSrc + appends nonce', () => {
    const h = Helmet.create({
      contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self, 'https://cdn.x/'] } },
    });
    const nonce = Helmet.generateNonce();
    const csp = h.headers({ nonce }).get('content-security-policy') ?? '';
    expect(csp).toContain(`script-src 'self' https://cdn.x/ 'nonce-${nonce}'`);
  });

  it('headers() with no nonce strips placeholder (no leaked literal "PLACEHOLDER")', () => {
    const h = Helmet.create({ contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self] } } });
    const csp = h.headers().get('content-security-policy') ?? '';
    expect(csp).not.toContain('PLACEHOLDER');
    expect(csp).not.toContain('zipbul_helmet_nonce');
    expect(csp).toContain("script-src 'self'");
  });
});

describe('helmet 8.x parity — apply() chain composition', () => {
  it('apply() preserves status, statusText, body', async () => {
    const h = Helmet.create();
    const input = new Response('hello world', { status: 201, statusText: 'Created' });
    const out = h.apply(input);
    expect(out.status).toBe(201);
    expect(out.statusText).toBe('Created');
    expect(await out.text()).toBe('hello world');
  });

  it('apply() does not overwrite user-set Cache-Control (set-if-absent)', () => {
    const h = Helmet.create({ cacheControl: true });
    const input = new Response('x', { headers: { 'Cache-Control': 'public, max-age=300' } });
    const out = h.apply(input);
    expect(out.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('apply() always overwrites CSP (always-overwrite group)', () => {
    const h = Helmet.create();
    const input = new Response('x', { headers: { 'Content-Security-Policy': "default-src *" } });
    const out = h.apply(input);
    expect(out.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(out.headers.get('content-security-policy')).not.toContain('*');
  });

  it('apply() handles Response.redirect (302, no body)', () => {
    const h = Helmet.create();
    const input = Response.redirect('https://example.com/', 302);
    const out = h.apply(input);
    expect(out.status).toBe(302);
    expect(out.headers.get('location')).toBe('https://example.com/');
    expect(out.headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains');
  });

  it('applyHeadersTo + headers() agree on the same set of headers', () => {
    const h = Helmet.create();
    const fromHeaders = h.headers();
    const target = new Headers();
    h.applyHeadersTo(target);
    for (const [k, v] of fromHeaders) {
      expect(target.get(k)).toBe(v);
    }
  });
});

describe('helmet 8.x parity — option false/omitted matrix', () => {
  it('every Default-ON header can be individually disabled', () => {
    const cases: Array<[keyof typeof opts, string]> = [
      ['contentSecurityPolicy', 'content-security-policy'],
      ['crossOriginOpenerPolicy', 'cross-origin-opener-policy'],
      ['crossOriginResourcePolicy', 'cross-origin-resource-policy'],
      ['referrerPolicy', 'referrer-policy'],
      ['strictTransportSecurity', 'strict-transport-security'],
      ['xContentTypeOptions', 'x-content-type-options'],
      ['xDnsPrefetchControl', 'x-dns-prefetch-control'],
      ['xFrameOptions', 'x-frame-options'],
      ['xPermittedCrossDomainPolicies', 'x-permitted-cross-domain-policies'],
    ];
    const opts = {} as Record<string, false>;
    for (const [key, header] of cases) {
      const h = Helmet.create({ [key]: false } as never);
      expect(h.headers().get(header)).toBeNull();
    }
  });
});

describe('helmet 8.x parity — alias migration', () => {
  it('all 7 helmet aliases are remapped', () => {
    const h = fromHelmetOptions({
      hsts: { maxAge: 1000 },
      noSniff: true,
      dnsPrefetchControl: { allow: false },
      ieNoOpen: true,
      frameguard: { action: 'deny' },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      xssFilter: false,
    });
    expect(h.headers().get('strict-transport-security')).toBe('max-age=1000; includeSubDomains');
    expect(h.headers().get('x-content-type-options')).toBe('nosniff');
    expect(h.headers().get('x-dns-prefetch-control')).toBe('off');
    expect(h.headers().get('x-download-options')).toBe('noopen');
    expect(h.headers().get('x-frame-options')).toBe('deny');
    expect(h.headers().get('x-permitted-cross-domain-policies')).toBe('none');
  });

  it('hidePoweredBy:true and xPoweredBy:false both remove the header', () => {
    const a = fromHelmetOptions({ hidePoweredBy: true });
    expect(a.headersToRemove()).toContain('x-powered-by');
    const b = fromHelmetOptions({ xPoweredBy: false });
    expect(b.headersToRemove()).toContain('x-powered-by');
  });
});
