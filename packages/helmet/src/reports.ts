import { LIMITS } from './constants';
import { HelmetErrorReason } from './enums';
import { HelmetError } from './interfaces';

export interface CspReportNormalized {
  source: 'legacy' | 'reporting-api';
  blockedUri?: string;
  documentUri?: string;
  effectiveDirective?: string;
  violatedDirective?: string;
  disposition?: 'enforce' | 'report';
  originalPolicy?: string;
  referrer?: string;
  sample?: string;
  statusCode?: number;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
}

const ALLOWED_CONTENT_TYPES = new Set<string>([
  'application/csp-report',
  'application/reports+json',
]);

/**
 * Parse a CSP violation report from a Web Fetch Request.
 * Handles both `application/csp-report` (legacy) and `application/reports+json`.
 *
 * @throws {HelmetError} on bad content-type, oversized body, malformed JSON,
 *   or read timeout (10s).
 */
export async function parseCspReport(request: Request): Promise<CspReportNormalized[]> {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HelmetError([
      {
        reason: HelmetErrorReason.UnsupportedCspReportContentType,
        path: 'request.headers.content-type',
        message: 'CSP report Content-Type must be application/csp-report or application/reports+json',
      },
    ]);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LIMITS.cspReportTimeoutMs);
  let raw: string;
  try {
    if (request.body === null) raw = await request.text();
    else {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          total += value.byteLength;
          if (total > LIMITS.cspReportBodyBytes) {
            reader.cancel().catch(() => undefined);
            throw new HelmetError([
              {
                reason: HelmetErrorReason.CspReportTooLarge,
                path: 'request.body',
                message: `CSP report body exceeds ${LIMITS.cspReportBodyBytes} bytes`,
              },
            ]);
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      raw = new TextDecoder().decode(merged);
    }
  } catch (err) {
    if (ac.signal.aborted) {
      throw new HelmetError([
        {
          reason: HelmetErrorReason.CspReportTimeout,
          path: 'request.body',
          message: 'CSP report read exceeded 10s timeout',
        },
      ]);
    }
    if (err instanceof HelmetError) throw err;
    throw new HelmetError([
      {
        reason: HelmetErrorReason.InvalidCspReport,
        path: 'request.body',
        message: 'failed to read CSP report body',
      },
    ]);
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HelmetError([
      {
        reason: HelmetErrorReason.InvalidCspReport,
        path: 'request.body',
        message: 'CSP report body is not valid JSON',
      },
    ]);
  }

  if (contentType === 'application/csp-report') {
    return [normalizeLegacy(parsed)];
  }
  return normalizeReportingApi(parsed);
}

function pick(obj: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.length > 2048 ? v.slice(0, 2048) : v;
}

function asInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

function normalizeLegacy(parsed: unknown): CspReportNormalized {
  const safe = Object.create(null) as CspReportNormalized;
  safe.source = 'legacy';
  if (typeof parsed !== 'object' || parsed === null) return safe;
  const wrapper = parsed as Record<string, unknown>;
  const body = (pick(wrapper, 'csp-report') as Record<string, unknown> | undefined) ?? wrapper;
  safe.blockedUri = asString(pick(body, 'blocked-uri'));
  safe.documentUri = asString(pick(body, 'document-uri'));
  safe.effectiveDirective = asString(pick(body, 'effective-directive'));
  safe.violatedDirective = asString(pick(body, 'violated-directive'));
  safe.disposition = pick(body, 'disposition') === 'report' ? 'report' : 'enforce';
  safe.originalPolicy = asString(pick(body, 'original-policy'));
  safe.referrer = asString(pick(body, 'referrer'));
  safe.statusCode = asInt(pick(body, 'status-code'));
  safe.sourceFile = asString(pick(body, 'source-file'));
  safe.lineNumber = asInt(pick(body, 'line-number'));
  safe.columnNumber = asInt(pick(body, 'column-number'));
  return safe;
}

function normalizeReportingApi(parsed: unknown): CspReportNormalized[] {
  const out: CspReportNormalized[] = [];
  if (!Array.isArray(parsed)) return out;
  for (let i = 0; i < parsed.length && i < LIMITS.cspReportItems; i++) {
    const item = parsed[i];
    if (typeof item !== 'object' || item === null) continue;
    const body = (item as Record<string, unknown>).body as Record<string, unknown> | undefined;
    if (body === undefined) continue;
    const safe = Object.create(null) as CspReportNormalized;
    safe.source = 'reporting-api';
    safe.blockedUri = asString(pick(body, 'blockedURL'));
    safe.documentUri = asString(pick(body, 'documentURL'));
    safe.effectiveDirective = asString(pick(body, 'effectiveDirective'));
    safe.disposition = pick(body, 'disposition') === 'report' ? 'report' : 'enforce';
    safe.originalPolicy = asString(pick(body, 'originalPolicy'));
    safe.referrer = asString(pick(body, 'referrer'));
    safe.sample = asString(pick(body, 'sample'));
    safe.statusCode = asInt(pick(body, 'statusCode'));
    safe.sourceFile = asString(pick(body, 'sourceFile'));
    safe.lineNumber = asInt(pick(body, 'lineNumber'));
    safe.columnNumber = asInt(pick(body, 'columnNumber'));
    out.push(safe);
  }
  return out;
}
