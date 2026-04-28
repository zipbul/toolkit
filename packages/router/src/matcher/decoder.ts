/** Function type returned by {@link buildDecoder}. Takes a raw segment and returns decoded string. */
export type DecoderFn = (raw: string) => string;

/**
 * Builds a decoder closure for param value decoding.
 * Decodes percent-encoded values. On decode failure, returns raw string as-is.
 */
export function buildDecoder(): DecoderFn {
  return (raw: string): string => {
    if (!raw.includes('%')) return raw;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
}
