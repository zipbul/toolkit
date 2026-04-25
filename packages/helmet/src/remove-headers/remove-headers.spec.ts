import { describe, expect, it } from 'bun:test';

import { applyRemoveHeaders } from './apply';
import { resolveRemoveHeaders } from './resolve';

describe('remove-headers/resolve', () => {
  it('defaults to OWASP must-strip 4', () => {
    const r = resolveRemoveHeaders(undefined);
    expect(r.headers).toEqual(['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']);
  });

  it('returns empty list for false', () => {
    expect(resolveRemoveHeaders(false).headers).toEqual([]);
  });

  it('expands "owasp" preset', () => {
    const r = resolveRemoveHeaders('owasp');
    expect(r.headers.length).toBeGreaterThan(50);
    expect(r.headers).toContain('x-runtime');
  });

  it('replaces default when headers is supplied', () => {
    const r = resolveRemoveHeaders({ headers: ['X-Custom'] });
    expect(r.headers).toEqual(['x-custom']);
  });

  it('merges additional onto default', () => {
    const r = resolveRemoveHeaders({ additional: ['X-Trace-Id'] });
    expect(r.headers).toContain('server');
    expect(r.headers).toContain('x-trace-id');
  });
});

describe('remove-headers/apply', () => {
  it('deletes headers case-insensitively', () => {
    const h = new Headers({ Server: 'nginx', 'X-Powered-By': 'PHP/8.4' });
    applyRemoveHeaders(h, ['server', 'x-powered-by']);
    expect(h.get('server')).toBeNull();
    expect(h.get('x-powered-by')).toBeNull();
  });
});
