import { LIMITS } from '../constants';
import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

const KEYWORD_SOURCES = new Set<string>([
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
  "'unsafe-hashes'",
  "'report-sample'",
  "'wasm-unsafe-eval'",
  "'inline-speculation-rules'",
  "'unsafe-webtransport-hashes'",
  "'report-sha256'",
  "'report-sha384'",
  "'report-sha512'",
]);

const BARE_KEYWORDS = new Set<string>([
  'self',
  'none',
  'unsafe-inline',
  'unsafe-eval',
  'strict-dynamic',
  'unsafe-hashes',
  'report-sample',
  'wasm-unsafe-eval',
  'inline-speculation-rules',
  'unsafe-webtransport-hashes',
  'report-sha256',
  'report-sha384',
  'report-sha512',
]);

const NONCE_RE = /^'nonce-([A-Za-z0-9+/_-]{16,256}={0,2})'$/;
const HASH_RE = /^'(sha256|sha384|sha512)-([A-Za-z0-9+/_-]+={0,2})'$/;
const SCHEME_SOURCE_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:$/;
const HOST_SOURCE_RE =
  /^(?:(?:[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)?(?:\*|\*\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))(?::(?:\*|\d{1,5}))?(?:\/[\w\-./%~+]*)?$/;

const HASH_LENGTHS: Record<string, number> = { sha256: 44, sha384: 64, sha512: 88 };

// C0 (\x00-\x1f) + DEL (\x7f) + structural delimiters + whitespace +
// Unicode special spaces NBSP (U+00A0), LSEP (U+2028), PSEP (U+2029), BOM (U+FEFF)
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f'"\\<>;\s\u00a0\u2028\u2029\ufeff]/;

/**
 * Validate a single CSP source expression and push violations.
 * Returns true when the source is valid (or known to be skipped on purpose).
 */
export function validateCspSource(
  source: string,
  path: string,
  out: ViolationDetail[],
): boolean {
  if (typeof source !== 'string') {
    out.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path,
      message: 'CSP source must be a string',
    });
    return false;
  }
  if (source.length > LIMITS.hostSourceLength) {
    out.push({
      reason: HelmetErrorReason.InputTooLarge,
      path,
      message: `CSP source exceeds ${LIMITS.hostSourceLength} chars`,
    });
    return false;
  }
  if (source === '*') return true;
  if (BARE_KEYWORDS.has(source)) {
    out.push({
      reason: HelmetErrorReason.UnquotedCspKeyword,
      path,
      message: `unquoted CSP keyword "${source}" — use Csp.${capitalize(source)} or "'${source}'"`,
      remedy: "wrap CSP keywords in single quotes (e.g., \"'self'\") or import { Csp }",
    });
    return false;
  }
  if (KEYWORD_SOURCES.has(source)) return true;

  const nonceMatch = NONCE_RE.exec(source);
  if (nonceMatch !== null) {
    if (CONTROL_CHAR_RE.test(nonceMatch[1] ?? '')) {
      out.push({
        reason: HelmetErrorReason.ControlCharRejected,
        path,
        message: 'nonce value contains forbidden characters',
      });
      return false;
    }
    return true;
  }

  const hashMatch = HASH_RE.exec(source);
  if (hashMatch !== null) {
    const algo = hashMatch[1] ?? '';
    const value = hashMatch[2] ?? '';
    if (value.length !== HASH_LENGTHS[algo]) {
      out.push({
        reason: HelmetErrorReason.InvalidCspHashLength,
        path,
        message: `${algo} hash must be ${HASH_LENGTHS[algo]} base64 chars (got ${value.length})`,
      });
      return false;
    }
    return true;
  }

  if (SCHEME_SOURCE_RE.test(source)) return true;
  if (HOST_SOURCE_RE.test(source)) return true;

  if (source.startsWith("'") && source.endsWith("'")) {
    out.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path,
      message: `unknown CSP keyword "${source}"`,
    });
    return false;
  }

  out.push({
    reason: HelmetErrorReason.InvalidCspHost,
    path,
    message: `CSP source "${truncate(source)}" is not a recognised keyword, scheme, host, nonce, or hash`,
  });
  return false;
}

function capitalize(value: string): string {
  return value
    .split(/[\s-]/)
    .map(part => (part ? part[0]!.toUpperCase() + part.slice(1) : ''))
    .join('');
}

function truncate(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}…(${value.length} chars)` : value;
}

export const FRAME_ANCESTORS_FORBIDDEN = new Set<string>([
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
  "'unsafe-hashes'",
]);

export { NONCE_RE, HASH_RE };
