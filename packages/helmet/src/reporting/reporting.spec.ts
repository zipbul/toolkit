import { describe, expect, it } from 'bun:test';

import {
  resolveNel,
  resolveReportingEndpoints,
  serializeNel,
  serializeReportToFromEndpoints,
  serializeReportingEndpoints,
} from './serialize';

describe('reporting/endpoints', () => {
  it('serialises a Reporting-Endpoints dictionary', () => {
    const r = resolveReportingEndpoints(
      { endpoints: { default: 'https://r.example/' as never, csp: 'https://r.example/csp' as never } },
      'reportingEndpoints',
      [],
    );
    if (r === undefined) throw new Error('expected');
    expect(serializeReportingEndpoints(r)).toEqual([
      'reporting-endpoints',
      'default="https://r.example/", csp="https://r.example/csp"',
    ]);
  });

  it('rejects http:// URLs', () => {
    const violations: never[] = [];
    resolveReportingEndpoints(
      { endpoints: { default: 'http://r.example/' as never } },
      'reportingEndpoints',
      violations as never,
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'reporting_endpoint_not_https')).toBe(true);
  });

  it('rejects malformed URL', () => {
    const violations: never[] = [];
    resolveReportingEndpoints(
      { endpoints: { default: '::not-a-url' as never } },
      'reportingEndpoints',
      violations as never,
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'reporting_endpoint_invalid_url')).toBe(true);
  });

  it('rejects bad endpoint name', () => {
    const violations: never[] = [];
    resolveReportingEndpoints(
      { endpoints: { 'bad name!': 'https://r.example/' as never } },
      'reportingEndpoints',
      violations as never,
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'invalid_reporting_endpoint_name')).toBe(true);
  });

  it('detects __proto__ override on input object (real prototype pollution attack)', () => {
    const violations: never[] = [];
    // Real attack vector: setting prototype to a malicious object via parsed JSON
    // or attacker-controlled merge. {__proto__: {...}} sets the prototype.
    const malicious = JSON.parse('{"__proto__": {"polluted": "https://attacker/"}}');
    resolveReportingEndpoints(
      { endpoints: malicious },
      'reportingEndpoints',
      violations as never,
    );
    expect(
      (violations as never[]).some(
        (v: never) => (v as { reason: string }).reason === 'reserved_key_denied',
      ),
    ).toBe(true);
  });
});

describe('reporting/nel', () => {
  it('emits NEL JSON + Report-To synthetic', () => {
    const ep = resolveReportingEndpoints(
      { endpoints: { 'nel-group': 'https://r.example/nel' as never } },
      'r',
      [],
    )!;
    const nel = resolveNel(
      { reportTo: 'nel-group', maxAge: 86400, includeSubdomains: true, failureFraction: 1 },
      'nel',
      [],
      new Set(['nel-group']),
    )!;
    expect(serializeNel(nel)).toEqual([
      'nel',
      '{"report_to":"nel-group","max_age":86400,"include_subdomains":true,"failure_fraction":1}',
    ]);
    const rt = serializeReportToFromEndpoints(ep, nel)!;
    expect(rt[0]).toBe('report-to');
    expect(rt[1]).toContain('"endpoints":[{"url":"https://r.example/nel"}]');
  });

  it('rejects unknown reportTo target', () => {
    const violations: never[] = [];
    resolveNel(
      { reportTo: 'unknown', maxAge: 1 },
      'nel',
      violations as never,
      new Set(),
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'nel_missing_reporting_endpoint')).toBe(true);
  });

  it('rejects fraction outside [0,1]', () => {
    const violations: never[] = [];
    resolveNel(
      { reportTo: 'group', maxAge: 1, successFraction: 5 },
      'nel',
      violations as never,
      new Set(['group']),
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'nel_invalid_fraction')).toBe(true);
  });

  it('rejects negative max_age', () => {
    const violations: never[] = [];
    resolveNel(
      { reportTo: 'group', maxAge: -1 },
      'nel',
      violations as never,
      new Set(['group']),
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'nel_invalid_max_age')).toBe(true);
  });

  it('rejects failureFraction outside [0,1]', () => {
    const violations: never[] = [];
    resolveNel(
      { reportTo: 'group', maxAge: 1, failureFraction: -0.1 },
      'nel',
      violations as never,
      new Set(['group']),
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'nel_invalid_fraction')).toBe(true);
  });

  it('returns undefined when input is undefined', () => {
    expect(resolveNel(undefined, 'nel', [], new Set())).toBeUndefined();
  });
});

describe('reporting/endpoints (additional coverage)', () => {
  it('rejects too many endpoints (DoS guard)', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 50; i++) big[`ep-${i}`] = 'https://r.example/' + i;
    const violations: never[] = [];
    resolveReportingEndpoints({ endpoints: big as never }, 'r', violations as never);
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'input_too_large')).toBe(true);
  });

  it('rejects RESERVED_KEYS as endpoint name (constructor / prototype)', () => {
    const violations: never[] = [];
    resolveReportingEndpoints(
      { endpoints: { constructor: 'https://r.example/' as never } },
      'r',
      violations as never,
    );
    expect((violations as never[]).some((v: never) => (v as { reason: string }).reason === 'reserved_key_denied')).toBe(true);
  });

  it('returns undefined when input is undefined', () => {
    expect(resolveReportingEndpoints(undefined, 'r', [])).toBeUndefined();
  });

  it('flags Object.create()-attacked endpoints (non-Object.prototype chain)', () => {
    const malicious = Object.create({ polluted: 'https://attacker/' });
    const violations: never[] = [];
    resolveReportingEndpoints({ endpoints: malicious }, 'r', violations as never);
    expect(
      (violations as never[]).some(
        (v: never) => (v as { reason: string }).reason === 'reserved_key_denied',
      ),
    ).toBe(true);
  });
});
