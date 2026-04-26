/**
 * RFC 9651 Structured Field Values — serialization helpers.
 *
 * Only the subset required by the Helmet headers is implemented:
 * - sf-boolean (`?1` / `?0`)
 * - sf-token  (bare lowercase token, RFC 9651 §3.3.4)
 * - sf-string (double-quoted, only `"` and `\` escaped, RFC 9651 §3.3.3)
 * - Inner List `(item1 item2)` (§3.1.1)
 * - Dictionary `key=value, key2=value2` (§3.2)
 *
 * Strict on emit — rejects values that would produce ambiguous output.
 */

const TOKEN_RE = /^[a-zA-Z*][a-zA-Z0-9!#$%&'*+\-.^_`|~:/]*$/;
const KEY_RE = /^[a-z*][a-z0-9_\-.*]*$/;

/** RFC 9651 §3.3.6 — `?1` / `?0`. */
export function serializeBoolean(value: boolean): string {
  return value ? '?1' : '?0';
}

/** RFC 9651 §3.3.4 — bare token. Caller must guarantee grammar. */
export function serializeToken(value: string): string {
  if (!TOKEN_RE.test(value)) {
    throw new Error(`structured-fields: invalid sf-token "${truncate(value)}"`);
  }
  return value;
}

/** RFC 9651 §3.3.3 — double-quoted string with `\\"` and `\\\\` escapes.
 * Per spec, sf-string is restricted to printable ASCII (0x20-0x7E). Non-ASCII
 * (≥ 0x80) and controls (< 0x20) and DEL (0x7F) are rejected. Use sf-display-string
 * (RFC 9651 §3.3.11) for UTF-8 if added later. */
export function serializeString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code > 0x7f) {
      throw new Error(`structured-fields: invalid sf-string char at index ${i} (only ASCII 0x20-0x7E allowed)`);
    }
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** RFC 9651 §3.3.7 — sf-integer. */
export function serializeInteger(value: number): string {
  if (!Number.isInteger(value) || value < -999_999_999_999_999 || value > 999_999_999_999_999) {
    throw new Error('structured-fields: sf-integer out of range');
  }
  return String(value);
}

/** RFC 9651 §3.3.8 — sf-decimal. At most 12 digits before the decimal point
 * and 3 after. */
export function serializeDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('structured-fields: sf-decimal must be finite');
  }
  if (Math.abs(value) >= 1_000_000_000_000) {
    throw new Error('structured-fields: sf-decimal exceeds 12 integer digits');
  }
  // RFC 9651: at most 12 integer digits, 3 fractional digits
  const rounded = Math.round(value * 1000) / 1000;
  let str = rounded.toFixed(3);
  // Strip trailing zeros but keep at least one fractional digit per RFC 9651
  str = str.replace(/0+$/, '').replace(/\.$/, '.0');
  return str;
}

export type SfBareItem = boolean | number | string | { __sfToken: string };

/** Wrap a value so it serialises as sf-token rather than sf-string. */
export function token(value: string): { __sfToken: string } {
  return { __sfToken: value };
}

function isToken(item: unknown): item is { __sfToken: string } {
  return typeof item === 'object' && item !== null && '__sfToken' in item;
}

/** Serialise a single sf-item (no parameters). */
export function serializeItem(item: SfBareItem): string {
  if (typeof item === 'boolean') return serializeBoolean(item);
  if (typeof item === 'number') {
    return Number.isInteger(item) ? serializeInteger(item) : serializeDecimal(item);
  }
  if (isToken(item)) return serializeToken(item.__sfToken);
  if (typeof item === 'string') return serializeString(item);
  throw new Error('structured-fields: unsupported sf-item type');
}

/** RFC 9651 §3.1.1 — `(a b c)` */
export function serializeInnerList(items: readonly SfBareItem[]): string {
  return `(${items.map(serializeItem).join(' ')})`;
}

export type DictionaryValue = SfBareItem | { innerList: readonly SfBareItem[] };

/** RFC 9651 §3.2 — dictionary. Order is preserved (Map insertion order). */
export function serializeDictionary(dict: ReadonlyMap<string, DictionaryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of dict) {
    if (!KEY_RE.test(key)) {
      throw new Error(`structured-fields: invalid dictionary key "${truncate(key)}"`);
    }
    if (typeof value === 'object' && value !== null && 'innerList' in value) {
      parts.push(`${key}=${serializeInnerList(value.innerList)}`);
    } else if (typeof value === 'boolean' && value === true) {
      // Boolean true sugars to the bare key per RFC 9651 §3.2.
      parts.push(key);
    } else {
      parts.push(`${key}=${serializeItem(value)}`);
    }
  }
  return parts.join(', ');
}

function truncate(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}…(${value.length} chars)` : value;
}
