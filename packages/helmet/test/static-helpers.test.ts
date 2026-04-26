import { describe, expect, it } from 'bun:test';

import { Csp, Helmet } from '../index';

describe('Csp builders', () => {
  it('Csp.nonce wraps a value into the canonical nonce-source form', () => {
    expect(Csp.nonce('AAAAAAAAAAAAAAAA')).toBe("'nonce-AAAAAAAAAAAAAAAA'");
  });
  it('Csp.hash wraps algo+value into the canonical hash-source form', () => {
    expect(Csp.hash('sha256', 'abc=')).toBe("'sha256-abc='");
    expect(Csp.hash('sha384', 'def=')).toBe("'sha384-def='");
    expect(Csp.hash('sha512', 'ghi=')).toBe("'sha512-ghi='");
  });
});

describe('Helmet static helpers (helmet 8 sub-middleware parity)', () => {
  it('Helmet.csp returns CSP tuple from default OWASP policy', () => {
    const [name, value] = Helmet.csp();
    expect(name).toBe('content-security-policy');
    expect(value).toContain("default-src 'self'");
  });

  it('Helmet.hsts returns HSTS tuple', () => {
    expect(Helmet.hsts({ maxAge: 100 })).toEqual([
      'strict-transport-security',
      'max-age=100; includeSubDomains',
    ]);
  });

  it('Helmet.referrerPolicy', () => {
    expect(Helmet.referrerPolicy('strict-origin')).toEqual(['referrer-policy', 'strict-origin']);
  });

  it('Helmet.xFrameOptions preserves case', () => {
    expect(Helmet.xFrameOptions('DENY')).toEqual(['x-frame-options', 'DENY']);
    expect(Helmet.xFrameOptions('sameorigin')).toEqual(['x-frame-options', 'sameorigin']);
  });

  it('Helmet.xContentTypeOptions', () => {
    expect(Helmet.xContentTypeOptions()).toEqual(['x-content-type-options', 'nosniff']);
  });

  it('Helmet.crossOriginOpenerPolicy', () => {
    expect(Helmet.crossOriginOpenerPolicy('same-origin-allow-popups')).toEqual([
      'cross-origin-opener-policy',
      'same-origin-allow-popups',
    ]);
  });

  it('Helmet.crossOriginEmbedderPolicy', () => {
    expect(Helmet.crossOriginEmbedderPolicy('require-corp')).toEqual([
      'cross-origin-embedder-policy',
      'require-corp',
    ]);
  });

  it('Helmet.crossOriginResourcePolicy', () => {
    expect(Helmet.crossOriginResourcePolicy('same-site')).toEqual([
      'cross-origin-resource-policy',
      'same-site',
    ]);
  });

  it('Helmet.permissionsPolicy returns header from features', () => {
    const [name, value] = Helmet.permissionsPolicy({ features: { camera: ['self'] } });
    expect(name).toBe('permissions-policy');
    expect(value).toContain('camera=(self)');
  });

  it('Helmet.originAgentCluster emits sf-boolean ?1/?0', () => {
    expect(Helmet.originAgentCluster(true)).toEqual(['origin-agent-cluster', '?1']);
    expect(Helmet.originAgentCluster(false)).toEqual(['origin-agent-cluster', '?0']);
  });

  it('Helmet.csp throws on invalid options', () => {
    expect(() =>
      Helmet.csp({ directives: { scriptSrc: ['self'] as never } }), // bare keyword
    ).toThrow();
  });

  it('Helmet.csp accepts user directives', () => {
    const [, value] = Helmet.csp({ directives: { scriptSrc: [Csp.Self, 'https://x.com'] } });
    expect(value).toContain("script-src 'self' https://x.com");
  });
});
