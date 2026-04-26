import { describe, expect, it } from 'bun:test';

import {
  Csp,
  Helmet,
  HelmetError,
  HelmetErrorReason,
    hashFromString,
  lintCsp,
  parseCspReport,
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

  it('rejects report-uri with CRLF (header injection defense)', () => {
    let err: HelmetError | undefined;
    try {
      Helmet.create({
        contentSecurityPolicy: {
          directives: {
            scriptSrc: [Csp.Self],
            reportUri: 'https://r.example/csp\r\nX-Injected: yes',
          },
        },
      });
    } catch (e) {
      err = e as HelmetError;
    }
    expect(err).toBeInstanceOf(HelmetError);
    expect(err!.violations.map(v => v.reason)).toContain(
      HelmetErrorReason.ControlCharRejected,
    );
  });

  it('rejects report-uri containing whitespace', () => {
    expect(() =>
      Helmet.create({
        contentSecurityPolicy: {
          directives: { scriptSrc: [Csp.Self], reportUri: 'https://r.example/ csp' },
        },
      }),
    ).toThrow(HelmetError);
  });

  it('rejects bad reporting endpoint URL scheme', () => {
    expect(() =>
      Helmet.create({
        reportingEndpoints: { endpoints: { csp: 'http://insecure.example/csp' as never } },
      }),
    ).toThrow(HelmetError);
  });

  it('rejects empty Referrer-Policy token list (W3C §4.1: 1#policy-token)', () => {
    expect(() => Helmet.create({ referrerPolicy: [] as never })).toThrow(HelmetError);
  });

  it('accepts X-Permitted-Cross-Domain-Policies: by-ftp-filename', () => {
    expect(() =>
      Helmet.create({ xPermittedCrossDomainPolicies: 'by-ftp-filename' }),
    ).not.toThrow();
  });

  it('Timing-Allow-Origin rejects URLs with paths/fragments (Resource Timing §3.5.2)', () => {
    expect(() =>
      Helmet.create({ timingAllowOrigin: 'https://x.example/path' }),
    ).toThrow(HelmetError);
    expect(() =>
      Helmet.create({ timingAllowOrigin: 'https://x.example#frag' }),
    ).toThrow(HelmetError);
    expect(() =>
      Helmet.create({ timingAllowOrigin: ['*'] }),
    ).not.toThrow();
    expect(() =>
      Helmet.create({ timingAllowOrigin: ['https://x.example', 'https://y.example:8443'] }),
    ).not.toThrow();
  });

  it('strips fragment from Reporting-Endpoints URL (W3C Reporting-1 §3.6)', () => {
    const helmet = Helmet.create({
      reportingEndpoints: { endpoints: { csp: 'https://r.example/csp#frag' as never } },
    });
    const value = helmet.headers().get('reporting-endpoints') ?? '';
    expect(value).toContain('"https://r.example/csp"');
    expect(value).not.toContain('#frag');
  });

  it('emits COOP/COEP with report-to parameter (HTML §7.1.3.1 / §7.1.4.1)', () => {
    const helmet = Helmet.create({
      reportingEndpoints: {
        endpoints: {
          'coop-ep': 'https://r.example/coop' as never,
          'coep-ep': 'https://r.example/coep' as never,
        },
      },
      crossOriginOpenerPolicy: { value: 'same-origin', reportTo: 'coop-ep' },
      crossOriginEmbedderPolicy: { value: 'require-corp', reportTo: 'coep-ep' },
    });
    expect(helmet.headers().get('cross-origin-opener-policy')).toBe(
      'same-origin; report-to="coop-ep"',
    );
    expect(helmet.headers().get('cross-origin-embedder-policy')).toBe(
      'require-corp; report-to="coep-ep"',
    );
  });

  it('rejects COOP/COEP report-to that does not reference a declared endpoint', () => {
    expect(() =>
      Helmet.create({
        crossOriginOpenerPolicy: { value: 'same-origin', reportTo: 'undeclared' },
      }),
    ).toThrow(HelmetError);
    expect(() =>
      Helmet.create({
        crossOriginEmbedderPolicy: { value: 'require-corp', reportTo: 'undeclared' },
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

  it('injects nonce into explicitly-set script-src-elem / style-src-elem / -attr', () => {
    const helmet = Helmet.create({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: [Csp.Self],
          styleSrc: [Csp.Self],
          scriptSrcElem: [Csp.Self],
          styleSrcElem: [Csp.Self],
          scriptSrcAttr: [Csp.Self],
          styleSrcAttr: [Csp.Self],
        },
      },
    });
    const nonce = Helmet.generateNonce();
    const csp = helmet.headers({ nonce }).get('content-security-policy') ?? '';
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`script-src-elem 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src-elem 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`script-src-attr 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src-attr 'self' 'nonce-${nonce}'`);
  });

  it('synthesises script-src/style-src from default-src when absent (CSP3 §6.1 fallback)', () => {
    const helmet = Helmet.create({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [Csp.Self, 'https://cdn.example'],
        },
      },
    });
    const nonce = Helmet.generateNonce();
    const csp = helmet.headers({ nonce }).get('content-security-policy') ?? '';
    // script-src / style-src must be synthesised so the nonce binds correctly.
    expect(csp).toContain(`script-src 'self' https://cdn.example 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src 'self' https://cdn.example 'nonce-${nonce}'`);
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

describe('Helmet option resolution branches', () => {
  it('xRobotsTag: true → default [noindex, nofollow]', () => {
    const helmet = Helmet.create({ xRobotsTag: true });
    expect(helmet.headers().get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('xRobotsTag: false → header omitted', () => {
    const helmet = Helmet.create({ xRobotsTag: false });
    expect(helmet.headers().get('x-robots-tag')).toBeNull();
  });
  it('xRobotsTag: { directives } → custom list', () => {
    const helmet = Helmet.create({ xRobotsTag: { directives: ['noindex', 'max-snippet: 0'] } });
    expect(helmet.headers().get('x-robots-tag')).toBe('noindex, max-snippet: 0');
  });
  it('xDownloadOptions: true → noopen', () => {
    const helmet = Helmet.create({ xDownloadOptions: true });
    expect(helmet.headers().get('x-download-options')).toBe('noopen');
  });
  it('xXssProtection: true → 0 (OWASP recommended)', () => {
    const helmet = Helmet.create({ xXssProtection: true });
    expect(helmet.headers().get('x-xss-protection')).toBe('0');
  });
  it('xXssProtection: 0 (explicit)', () => {
    const helmet = Helmet.create({ xXssProtection: '0' });
    expect(helmet.headers().get('x-xss-protection')).toBe('0');
  });
  it('xXssProtection: 1; mode=block (explicit)', () => {
    const helmet = Helmet.create({ xXssProtection: '1; mode=block' });
    expect(helmet.headers().get('x-xss-protection')).toBe('1; mode=block');
  });
  it('xDnsPrefetchControl: true → off (privacy default)', () => {
    const helmet = Helmet.create({ xDnsPrefetchControl: true });
    expect(helmet.headers().get('x-dns-prefetch-control')).toBe('off');
  });
  it('xDnsPrefetchControl: on (explicit)', () => {
    const helmet = Helmet.create({ xDnsPrefetchControl: 'on' });
    expect(helmet.headers().get('x-dns-prefetch-control')).toBe('on');
  });
  it('xPermittedCrossDomainPolicies: true → none', () => {
    const helmet = Helmet.create({ xPermittedCrossDomainPolicies: true });
    expect(helmet.headers().get('x-permitted-cross-domain-policies')).toBe('none');
  });
  it('referrerPolicy: single token (not array)', () => {
    const helmet = Helmet.create({ referrerPolicy: 'strict-origin-when-cross-origin' });
    expect(helmet.headers().get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
  it('crossOriginResourcePolicy: explicit cross-origin', () => {
    const helmet = Helmet.create({ crossOriginResourcePolicy: 'cross-origin' });
    expect(helmet.headers().get('cross-origin-resource-policy')).toBe('cross-origin');
  });
  it('timingAllowOrigin accepts a single string (auto-wrapped)', () => {
    const helmet = Helmet.create({ timingAllowOrigin: 'https://x.example' });
    expect(helmet.headers().get('timing-allow-origin')).toBe('https://x.example');
  });
});

describe('Helmet — option subsystem wiring', () => {
  it('integrityPolicy: true → defaults validated', () => {
    const helmet = Helmet.create({ integrityPolicy: true });
    expect(helmet.headers().get('integrity-policy')).toContain('blocked-destinations=');
  });

  it('integrityPolicyReportOnly emits its dedicated header', () => {
    const helmet = Helmet.create({ integrityPolicyReportOnly: { blockedDestinations: ['script'] } });
    expect(helmet.headers().get('integrity-policy-report-only')).toBeTruthy();
  });

  it('clearSiteData: true → defaults emitted', () => {
    const helmet = Helmet.create({ clearSiteData: true });
    expect(helmet.headers().get('clear-site-data')).toContain('"cache"');
  });

  it('clearSiteData with custom directives emits them', () => {
    const helmet = Helmet.create({
      clearSiteData: { directives: ['cookies', '*'] },
    });
    expect(helmet.headers().get('clear-site-data')).toBe('"cookies", "*"');
  });

  it('COOP/COEP report-only: object form with reportTo cross-references endpoints', () => {
    const helmet = Helmet.create({
      reportingEndpoints: { endpoints: { ep: 'https://r.example/x' as never } },
      crossOriginOpenerPolicyReportOnly: { value: 'same-origin', reportTo: 'ep' },
      crossOriginEmbedderPolicyReportOnly: { value: 'require-corp', reportTo: 'ep' },
    });
    expect(helmet.headers().get('cross-origin-opener-policy-report-only')).toBe(
      'same-origin; report-to="ep"',
    );
    expect(helmet.headers().get('cross-origin-embedder-policy-report-only')).toBe(
      'require-corp; report-to="ep"',
    );
  });

  it('rejects invalid CORP value', () => {
    expect(() => Helmet.create({ crossOriginResourcePolicy: 'bogus' as never })).toThrow(HelmetError);
  });

  it('rejects invalid Document-Isolation-Policy value', () => {
    expect(() => Helmet.create({ documentIsolationPolicy: 'bogus' as never })).toThrow(HelmetError);
  });

  it('validates permissionsPolicyReportOnly options', () => {
    expect(() =>
      Helmet.create({
        permissionsPolicyReportOnly: { features: { camera: ['javascript:alert(1)'] } },
      }),
    ).toThrow(HelmetError);
  });

  it('rejects invalid COOP / COOP-RO / COEP / COEP-RO token values', () => {
    expect(() => Helmet.create({ crossOriginOpenerPolicy: 'bogus' as never })).toThrow(HelmetError);
    expect(() => Helmet.create({ crossOriginOpenerPolicyReportOnly: 'bogus' as never })).toThrow(HelmetError);
    expect(() => Helmet.create({ crossOriginEmbedderPolicy: 'bogus' as never })).toThrow(HelmetError);
    expect(() => Helmet.create({ crossOriginEmbedderPolicyReportOnly: 'bogus' as never })).toThrow(HelmetError);
  });

  it('rejects COOP/COEP reportTo with malformed name (not [A-Za-z0-9_-]{1,64})', () => {
    expect(() =>
      Helmet.create({
        reportingEndpoints: { endpoints: { ep: 'https://r.example/' as never } },
        crossOriginOpenerPolicy: { value: 'same-origin', reportTo: 'has spaces' },
      }),
    ).toThrow(HelmetError);
  });

  it('rejects too-many-violations and emits truncation sentinel (>256)', () => {
    // Build CSP with many sources across many directives to exceed LIMITS.violations.
    const bad = Array.from({ length: 60 }, () => 'self'); // unquoted keyword × 60
    let err: HelmetError | undefined;
    try {
      Helmet.create({
        contentSecurityPolicy: {
          directives: {
            scriptSrc: bad as never,
            styleSrc: bad as never,
            imgSrc: bad as never,
            fontSrc: bad as never,
            connectSrc: bad as never,
          },
        },
      });
    } catch (e) {
      err = e as HelmetError;
    }
    expect(err).toBeInstanceOf(HelmetError);
    expect(err!.violations.length).toBeLessThanOrEqual(256);
    expect(err!.violations.some(v => v.reason === 'too_many_violations')).toBe(true);
  });
});

describe('Helmet diagnostic surface', () => {
  it('toJSON returns the deep-frozen resolved snapshot', () => {
    const helmet = Helmet.create({ xFrameOptions: 'DENY' });
    const snap = helmet.toJSON();
    expect(snap.xFrameOptions).toBe('DENY');
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('headerNames lists every header Helmet will emit (incl. CSP)', () => {
    const helmet = Helmet.create();
    const names = helmet.headerNames();
    expect(names).toContain('content-security-policy');
    expect(names).toContain('strict-transport-security');
    expect(names).toContain('referrer-policy');
  });

  it('headerNames includes csp-report-only when configured', () => {
    const helmet = Helmet.create({
      contentSecurityPolicyReportOnly: { directives: { scriptSrc: [Csp.Self] } },
    });
    expect(helmet.headerNames()).toContain('content-security-policy-report-only');
  });

  it('headersToRemove reports the resolved removal list', () => {
    const helmet = Helmet.create();
    expect(helmet.headersToRemove()).toContain('server');
    expect(helmet.headersToRemove()).toContain('x-powered-by');
  });

  it('CSP-Report-Only body carries injected nonce just like enforcing CSP', () => {
    const helmet = Helmet.create({
      contentSecurityPolicyReportOnly: {
        directives: { scriptSrc: [Csp.Self] },
      },
    });
    const nonce = Helmet.generateNonce();
    const value =
      helmet.headers({ nonce }).get('content-security-policy-report-only') ?? '';
    expect(value).toContain(`'nonce-${nonce}'`);
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

  it('parses application/reports+json (Reporting API format)', async () => {
    const req = new Request('https://example.com/r', {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([
        {
          type: 'csp-violation',
          age: 0,
          url: 'https://x',
          user_agent: 'tests',
          body: {
            documentURL: 'https://doc',
            effectiveDirective: 'script-src',
            disposition: 'enforce',
            blockedURL: 'https://evil',
          },
        },
      ]),
    });
    const reports = await parseCspReport(req);
    expect(reports[0]?.source).toBe('reporting-api');
    expect(reports[0]?.documentUri).toBe('https://doc');
    expect(reports[0]?.effectiveDirective).toBe('script-src');
    expect(reports[0]?.disposition).toBe('enforce');
    expect(reports[0]?.blockedUri).toBe('https://evil');
  });

  it('rejects oversized body', async () => {
    const big = 'x'.repeat(70 * 1024);
    const req = new Request('https://x/c', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: big,
    });
    await expect(parseCspReport(req)).rejects.toThrow();
  });

  it('rejects malformed JSON', async () => {
    const req = new Request('https://x/c', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: '{not-json',
    });
    await expect(parseCspReport(req)).rejects.toThrow();
  });

  it('reports CspReportTimeout when the abort timer fires before read completes', async () => {
    // Force the internal 10s timer to fire synchronously so the AbortController
    // is already aborted by the time the reader throws.
    const realSetTimeout = globalThis.setTimeout;
    let timerCb: (() => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).setTimeout = ((cb: () => void) => {
      timerCb = cb;
      return 0;
    }) as never;
    try {
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          // Run the (now-synchronous) timer to flip ac.signal.aborted = true,
          // then make the reader throw so the catch-block sees aborted=true.
          timerCb?.();
          controller.error(new Error('aborted-by-test'));
        },
      });
      const req = new Request('https://x/c', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: stream,
      });
      let err: { violations: { reason: string }[] } | undefined;
      try {
        await parseCspReport(req);
      } catch (e) {
        err = e as never;
      }
      expect(err?.violations?.[0]?.reason).toBe('csp_report_timeout');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('reports a generic read error when the body stream throws', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('synthetic stream failure'));
      },
    });
    const req = new Request('https://x/c', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: stream,
    });
    await expect(parseCspReport(req)).rejects.toThrow();
  });

  it('handles bare legacy report object (no csp-report wrapper)', async () => {
    const req = new Request('https://example.com/csp', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'document-uri': 'https://x',
        'violated-directive': 'img-src',
      }),
    });
    const reports = await parseCspReport(req);
    expect(reports[0]?.documentUri).toBe('https://x');
    expect(reports[0]?.violatedDirective).toBe('img-src');
  });
});

