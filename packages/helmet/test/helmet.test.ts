import { describe, expect, it } from 'bun:test';

import {
  Csp,
  Helmet,
  HelmetError,
  HelmetErrorReason,
  fromHelmetOptions,
  hashFromString,
  lintCsp,
  parseCspReport,
  presets,
} from '../index';

describe('Helmet.create — defaults', () => {
  it('emits the OWASP-aligned Default-ON set', () => {
    const helmet = Helmet.create();
    const headers = helmet.headers();
    expect(headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains');
    expect(headers.get('x-frame-options')).toBe('deny');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(headers.get('origin-agent-cluster')).toBe('?1');
    expect(headers.get('x-permitted-cross-domain-policies')).toBe('none');
    expect(headers.get('permissions-policy')).toContain('camera=()');
    expect(headers.get('cross-origin-embedder-policy')).toBeNull();
  });

  it('headers() returns a fresh defensive copy', () => {
    const helmet = Helmet.create();
    const a = helmet.headers();
    a.set('x-foo', 'bar');
    const b = helmet.headers();
    expect(b.get('x-foo')).toBeNull();
  });

  it('originAgentCluster:false emits ?0 (sf-boolean opt-out)', () => {
    const helmet = Helmet.create({ originAgentCluster: false });
    expect(helmet.headers().get('origin-agent-cluster')).toBe('?0');
  });

  it('preserves X-Frame-Options input case for WAF compatibility', () => {
    const helmet = Helmet.create({ xFrameOptions: 'DENY' });
    expect(helmet.headers().get('x-frame-options')).toBe('DENY');
  });
});

describe('Helmet.create — validation', () => {
  it('aggregates multiple violations', () => {
    let err: HelmetError | undefined;
    try {
      Helmet.create({
        contentSecurityPolicy: { directives: { scriptSrc: ['self', 'none'] } },
        strictTransportSecurity: { maxAge: -1, preload: true, includeSubDomains: false },
      });
    } catch (e) {
      err = e as HelmetError;
    }
    expect(err).toBeInstanceOf(HelmetError);
    expect(err!.violations.length).toBeGreaterThan(2);
    const reasons = err!.violations.map(v => v.reason);
    expect(reasons).toContain(HelmetErrorReason.UnquotedCspKeyword);
    expect(reasons).toContain(HelmetErrorReason.HstsMaxAgeInvalid);
    expect(reasons).toContain(HelmetErrorReason.HstsPreloadRequirementMissing);
  });

  it('cross-references report-to with reportingEndpoints (always strict)', () => {
    // Defining `report-to: 'group'` without declaring 'group' is a security bug —
    // browsers silently drop the directive and reports never arrive.
    expect(() =>
      Helmet.create({
        contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self], reportTo: 'group' } },
      }),
    ).toThrow();
    // With matching endpoints declared the same config validates cleanly.
    expect(() =>
      Helmet.create({
        reportingEndpoints: { endpoints: { group: 'https://r.example/' as never } },
        contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self], reportTo: 'group' } },
      }),
    ).not.toThrow();
  });

  it('rejects bad reporting endpoint URL scheme', () => {
    expect(() =>
      Helmet.create({
        reportingEndpoints: { endpoints: { csp: 'http://insecure.example/csp' as never } },
      }),
    ).toThrow(HelmetError);
  });
});

describe('Helmet.headers({ nonce })', () => {
  it('injects nonce into script-src and style-src', () => {
    const helmet = Helmet.create({
      contentSecurityPolicy: {
        directives: { scriptSrc: [Csp.Self], styleSrc: [Csp.Self] },
      },
    });
    const nonce = Helmet.generateNonce();
    const csp = helmet.headers({ nonce }).get('content-security-policy') ?? '';
    expect(csp).toContain(`'nonce-${nonce}'`);
  });

  it('strips nonce placeholders when no nonce supplied', () => {
    const helmet = Helmet.create({
      contentSecurityPolicy: {
        directives: { scriptSrc: [Csp.Self] },
      },
    });
    const csp = helmet.headers().get('content-security-policy') ?? '';
    expect(csp).not.toContain('nonce');
  });

  it('rejects malformed nonce', () => {
    const helmet = Helmet.create();
    expect(() => helmet.headers({ nonce: 'bad' as never })).toThrow();
  });

  it('uses function-form replaceAll (cache poisoning safe)', () => {
    const helmet = Helmet.create({
      contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self] } },
    });
    // A nonce containing $ would corrupt a string-form replaceAll.
    const evil = 'AAAAAAAAAAAAAAAA$&injected'.padEnd(22, 'A').slice(0, 22);
    expect(() => helmet.headers({ nonce: evil as never })).toThrow();
  });
});

describe('Helmet.apply', () => {
  it('overlays headers and removes information-disclosure headers', () => {
    const helmet = Helmet.create();
    const input = new Response('hello', {
      headers: { Server: 'nginx', 'X-Powered-By': 'PHP/8.4', 'Content-Type': 'text/plain' },
    });
    const out = helmet.apply(input);
    expect(out.headers.get('server')).toBeNull();
    expect(out.headers.get('x-powered-by')).toBeNull();
    expect(out.headers.get('x-content-type-options')).toBe('nosniff');
    expect(out.headers.get('content-type')).toBe('text/plain');
  });

  it('skips 304 responses (RFC 9111 §4.3.4 stored-response update tradeoff)', () => {
    const helmet = Helmet.create();
    const input = new Response(null, { status: 304 });
    const out = helmet.apply(input);
    expect(out).toBe(input);
  });

  it('preserves multiple Set-Cookie values', () => {
    const helmet = Helmet.create();
    const input = new Response('x');
    input.headers.append('set-cookie', 'a=1');
    input.headers.append('set-cookie', 'b=2');
    const out = helmet.apply(input);
    expect(out.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  });
});

describe('Helmet.derive', () => {
  it('overlays partial options and re-validates', () => {
    const parent = Helmet.create();
    const child = parent.derive({
      contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self, "'unsafe-inline'"] } },
    });
    expect(child.headers().get('content-security-policy')).toContain("'unsafe-inline'");
    expect(parent.headers().get('content-security-policy')).not.toContain("'unsafe-inline'");
  });

  it('throws on invalid override', () => {
    const parent = Helmet.create();
    expect(() => parent.derive({ strictTransportSecurity: { maxAge: -5 } })).toThrow(HelmetError);
  });
});

describe('headersRecord / applyHeadersTo', () => {
  it('headersRecord returns frozen plain object', () => {
    const r = Helmet.create().headersRecord();
    expect(Object.isFrozen(r)).toBe(true);
    expect(r['x-content-type-options']).toBe('nosniff');
  });

  it('applyHeadersTo mutates Headers in place', () => {
    const helmet = Helmet.create();
    const h = new Headers({ Server: 'nginx' });
    helmet.applyHeadersTo(h);
    expect(h.get('server')).toBeNull();
    expect(h.get('x-frame-options')).toBe('deny');
  });
});

describe('presets', () => {
  it('strict preset has trusted-types', () => {
    const csp = presets.strict().headers().get('content-security-policy') ?? '';
    expect(csp).toContain('require-trusted-types-for');
  });

  it('api preset emits no-store', () => {
    const headers = presets.api().headers();
    expect(headers.get('cache-control')).toContain('no-store');
  });

  it('observatoryAPlus preset includes integrity-policy', () => {
    expect(presets.observatoryAPlus().headers().get('integrity-policy')).toContain('blocked-destinations');
  });

  it('ipa preset emits uppercase DENY', () => {
    expect(presets.ipa().headers().get('x-frame-options')).toBe('DENY');
  });
});

describe('hashFromString', () => {
  it('matches a known SHA-384 fixture', async () => {
    const hash = await hashFromString('hello', 'sha384');
    // Pre-computed expected base64
    expect(hash).toBe(
      'WeF0h3dEjGnea4ANejO7+5/xtGPkQ1TDVTvNucZm+pASWjx5+QOXvfX2oT3oKGhP',
    );
  });
});

describe('lintCsp', () => {
  it('flags wildcard script-src', () => {
    const findings = lintCsp({ scriptSrc: ['*'] });
    expect(findings.some(f => f.severity === 'high' && f.directive === 'scriptSrc')).toBe(true);
  });

  it('flags missing object-src/base-uri', () => {
    const findings = lintCsp({ scriptSrc: [Csp.Self] });
    expect(findings.some(f => f.directive === 'object-src')).toBe(true);
    expect(findings.some(f => f.directive === 'base-uri')).toBe(true);
  });
});

describe('parseCspReport', () => {
  it('parses legacy application/csp-report', async () => {
    const req = new Request('https://example.com/csp', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': { 'document-uri': 'https://x', 'violated-directive': 'script-src' },
      }),
    });
    const reports = await parseCspReport(req);
    expect(reports[0]?.documentUri).toBe('https://x');
    expect(reports[0]?.violatedDirective).toBe('script-src');
  });

  it('rejects bad content-type', async () => {
    const req = new Request('https://x/c', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'nope',
    });
    await expect(parseCspReport(req)).rejects.toThrow();
  });
});

describe('fromHelmetOptions migration', () => {
  it('lifts reportOnly into top-level CSP-RO with warning', () => {
    const h = fromHelmetOptions({
      contentSecurityPolicy: {
        reportOnly: true,
        directives: { 'default-src': [Csp.Self] } as never,
      },
    });
    expect(h.headerNames()).toContain('content-security-policy-report-only');
    expect(h.warnings.some(w => w.reason === 'helmet_report_only_lifted')).toBe(true);
  });

  it('overrides removeHeaders:false on legacy xPoweredBy:false intent', () => {
    const h = fromHelmetOptions({ xPoweredBy: false, removeHeaders: false });
    expect(h.headersToRemove()).toContain('x-powered-by');
    expect(h.warnings.some(w => w.reason === 'remove_headers_forced_by_legacy')).toBe(true);
  });
});
