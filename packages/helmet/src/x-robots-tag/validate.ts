import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

/**
 * Boolean indexing rules per Google Search Central documentation —
 * https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
 */
const BOOLEAN_RULES = new Set<string>([
  'noindex',
  'nofollow',
  'none',
  'all',
  'nosnippet',
  'indexifembedded',
  'notranslate',
  'noimageindex',
]);

const MAX_IMAGE_PREVIEW_VALUES = new Set<string>(['none', 'standard', 'large']);

// Bot user-agent token: ALPHA *( ALPHA / DIGIT / "-" )
const BOT_NAME_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
// Conservative date check: printable ASCII, no whitespace at boundaries, no
// header-injection characters. Google accepts RFC 822 / RFC 850 / ISO 8601 —
// the union of those is too permissive to encode in a tight regex; we reject
// only obvious garbage and let downstream parsers (including the crawler) decide.
const DATE_VALUE_RE = /^[\x21-\x7e][\x20-\x7e]*[\x21-\x7e]$|^[\x21-\x7e]$/;

/**
 * Validate a single X-Robots-Tag directive entry. Each entry is either:
 *   - a bare rule:      `noindex`, `max-snippet: 10`
 *   - a bot-prefixed rule: `googlebot: noindex`, `googlebot: max-snippet: 10`
 *
 * The serializer joins entries with ", " so a single entry must NOT contain
 * a bare comma — comma is the inter-entry delimiter.
 */
export function validateXRobotsTag(
  directives: readonly string[],
  path: string,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  for (let i = 0; i < directives.length; i++) {
    const entry = directives[i];
    if (typeof entry !== 'string') {
      out.push({
        reason: HelmetErrorReason.InvalidXRobotsTagDirective,
        path: `${path}[${i}]`,
        message: 'X-Robots-Tag entry must be a string',
      });
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      out.push({
        reason: HelmetErrorReason.InvalidXRobotsTagDirective,
        path: `${path}[${i}]`,
        message: 'X-Robots-Tag entry must be a non-empty string',
      });
      continue;
    }
    // Reject CR/LF/control chars to prevent header injection.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
      out.push({
        reason: HelmetErrorReason.ControlCharRejected,
        path: `${path}[${i}]`,
        message: 'X-Robots-Tag entry contains forbidden control characters',
      });
      continue;
    }
    if (trimmed.includes(',')) {
      out.push({
        reason: HelmetErrorReason.InvalidXRobotsTagDirective,
        path: `${path}[${i}]`,
        message: 'X-Robots-Tag entry must not contain comma — pass each rule as a separate array element',
      });
      continue;
    }

    // Detect optional `<bot-name>:` prefix, but be careful not to mistake
    // `max-snippet:10` for a bot prefix. A bot prefix is followed by a known
    // rule keyword; a value-rule has the rule name BEFORE the colon.
    let body = trimmed;
    const firstColon = trimmed.indexOf(':');
    if (firstColon > 0) {
      const head = trimmed.slice(0, firstColon).trim();
      const tail = trimmed.slice(firstColon + 1).trim();
      // Heuristic: head is a bot-name iff head is NOT itself a known rule.
      if (!isKnownRuleName(head) && BOT_NAME_RE.test(head) && tail.length > 0) {
        body = tail;
      }
    }

    if (!isValidRule(body)) {
      out.push({
        reason: HelmetErrorReason.InvalidXRobotsTagDirective,
        path: `${path}[${i}]`,
        message: `X-Robots-Tag rule "${truncate(body)}" is not recognised (Google Search Central spec)`,
      });
    }
  }
  return out;
}

function isKnownRuleName(name: string): boolean {
  return (
    BOOLEAN_RULES.has(name) ||
    name === 'max-snippet' ||
    name === 'max-image-preview' ||
    name === 'max-video-preview' ||
    name === 'unavailable_after'
  );
}

function isValidRule(rule: string): boolean {
  if (BOOLEAN_RULES.has(rule)) return true;
  const colon = rule.indexOf(':');
  if (colon <= 0) return false;
  const name = rule.slice(0, colon).trim();
  const value = rule.slice(colon + 1).trim();
  if (value.length === 0) return false;
  switch (name) {
    case 'max-snippet':
    case 'max-video-preview':
      // Integer including negative; Google notes 0 and -1 as special.
      return /^-?\d+$/.test(value);
    case 'max-image-preview':
      return MAX_IMAGE_PREVIEW_VALUES.has(value);
    case 'unavailable_after':
      return DATE_VALUE_RE.test(value);
    default:
      return false;
  }
}

function truncate(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}…(${value.length} chars)` : value;
}
