import { Encoding } from './enums.ts';

export interface EncodingPreference {
  encoding: string;
  quality: number;
}

/**
 * Parses an Accept-Encoding header value into a sorted list of preferences.
 * Follows RFC 9110 §12.5.3 (quality values).
 *
 * @example parseAcceptEncoding('gzip;q=1.0, br;q=0.8, identity;q=0.5')
 * // [{ encoding: 'gzip', quality: 1.0 }, { encoding: 'br', quality: 0.8 }, ...]
 */
export function parseAcceptEncoding(header: string): EncodingPreference[] {
  const preferences: EncodingPreference[] = [];

  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    const [encoding, ...params] = trimmed.split(';');
    let name = encoding!.trim().toLowerCase();
    if (name === '') continue;

    // RFC 9110 §8.4.1: x-gzip is equivalent to gzip, x-compress to compress
    if (name === 'x-gzip') name = 'gzip';
    else if (name === 'x-compress') name = 'compress';

    let quality = 1.0;
    for (const param of params) {
      const [key, value] = param.split('=');
      if (key?.trim().toLowerCase() === 'q' && value !== undefined) {
        const parsed = Number.parseFloat(value.trim());
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          quality = parsed;
        }
      }
    }

    preferences.push({ encoding: name, quality });
  }

  preferences.sort((a, b) => b.quality - a.quality);
  return preferences;
}

/**
 * Negotiates the best encoding based on server preferences and client Accept-Encoding.
 *
 * Strategy: among server-supported encodings that the client also accepts (q > 0),
 * pick the one with the highest client quality value. Ties are broken by server
 * preference order (earlier = higher priority).
 */
export function negotiateEncoding(
  serverEncodings: Encoding[],
  clientPreferences: EncodingPreference[],
): Encoding | null {
  const clientMap = new Map<string, number>();
  let wildcardQuality = -1;

  for (const pref of clientPreferences) {
    if (pref.encoding === '*') {
      wildcardQuality = pref.quality;
    } else {
      clientMap.set(pref.encoding, pref.quality);
    }
  }

  let best: Encoding | null = null;
  let bestQuality = 0;

  for (const encoding of serverEncodings) {
    const quality = clientMap.get(encoding) ?? wildcardQuality;
    if (quality > 0 && quality > bestQuality) {
      best = encoding;
      bestQuality = quality;
    }
  }

  return best;
}
