import { describe, expect, it } from 'bun:test';
import { parseAcceptEncoding, negotiateEncoding } from './encoding.ts';
import { Encoding } from './enums.ts';

describe('parseAcceptEncoding', () => {
  it('should parse single encoding without quality as quality 1.0 when given plain encoding', () => {
    const header = 'gzip';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 1.0 }]);
  });

  it('should parse single encoding with explicit quality value when given q param', () => {
    const header = 'br;q=0.9';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'br', quality: 0.9 }]);
  });

  it('should parse multiple encodings and sort by quality descending when given comma-separated list', () => {
    const header = 'identity;q=0.5, gzip;q=1.0, deflate;q=0.8';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([
      { encoding: 'gzip', quality: 1.0 },
      { encoding: 'deflate', quality: 0.8 },
      { encoding: 'identity', quality: 0.5 },
    ]);
  });

  it('should parse wildcard * as encoding name when given in header', () => {
    const header = '*;q=0.3';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: '*', quality: 0.3 }]);
  });

  it('should lowercase encoding names when given mixed case', () => {
    const header = 'GZIP, Br';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([
      { encoding: 'gzip', quality: 1.0 },
      { encoding: 'br', quality: 1.0 },
    ]);
  });

  it('should return empty array when given empty string', () => {
    const header = '';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([]);
  });

  it('should default quality to 1.0 when q value is non-numeric', () => {
    const header = 'gzip;q=abc';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 1.0 }]);
  });

  it('should default quality to 1.0 when q value exceeds 1', () => {
    const header = 'gzip;q=1.5';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 1.0 }]);
  });

  it('should default quality to 1.0 when q value is negative', () => {
    const header = 'gzip;q=-0.1';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 1.0 }]);
  });

  it('should default quality to 1.0 when q param has no value', () => {
    const header = 'gzip;q=';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 1.0 }]);
  });

  it('should skip empty parts when given commas with empty segments', () => {
    const header = 'gzip,,deflate';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([
      { encoding: 'gzip', quality: 1.0 },
      { encoding: 'deflate', quality: 1.0 },
    ]);
  });

  it('should return empty array when given single comma', () => {
    const header = ',';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([]);
  });

  it('should parse quality exactly 0 when q=0 is specified', () => {
    const header = 'gzip;q=0';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 0 }]);
  });

  it('should skip encoding name when it is empty after trim', () => {
    const header = '   ;q=0.5';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([]);
  });

  it('should preserve duplicate encodings when same encoding appears multiple times', () => {
    const header = 'gzip;q=0.8, gzip;q=0.6';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([
      { encoding: 'gzip', quality: 0.8 },
      { encoding: 'gzip', quality: 0.6 },
    ]);
  });

  it('should handle uppercase Q param key when q is uppercase', () => {
    const header = 'gzip;Q=0.7';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 0.7 }]);
  });

  it('should handle whitespace when given around semicolons and equals', () => {
    const header = 'gzip ; q = 0.6';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 0.6 }]);
  });

  it('should use last q value when multiple q params exist in same part', () => {
    const header = 'gzip;q=0.5;q=0.9';
    const result = parseAcceptEncoding(header);
    expect(result).toEqual([{ encoding: 'gzip', quality: 0.9 }]);
  });

  it('should return same result when given same input multiple times', () => {
    const header = 'gzip;q=0.8, br;q=0.9';
    const a = parseAcceptEncoding(header);
    const b = parseAcceptEncoding(header);
    expect(a).toEqual(b);
  });

  it('should maintain stable order when quality values are equal', () => {
    const header = 'gzip, deflate, br';
    const result = parseAcceptEncoding(header);
    expect(result[0].encoding).toBe('gzip');
    expect(result[1].encoding).toBe('deflate');
    expect(result[2].encoding).toBe('br');
  });

  // RFC 9110 §8.4.1: encoding alias normalization
  it('should normalize x-gzip to gzip (RFC 9110 §8.4.1.3)', () => {
    const result = parseAcceptEncoding('x-gzip;q=0.8');
    expect(result).toEqual([{ encoding: 'gzip', quality: 0.8 }]);
  });

  it('should normalize x-compress to compress (RFC 9110 §8.4.1.1)', () => {
    const result = parseAcceptEncoding('x-compress');
    expect(result).toEqual([{ encoding: 'compress', quality: 1.0 }]);
  });

  it('should normalize x-gzip among mixed encodings', () => {
    const result = parseAcceptEncoding('x-gzip;q=0.5, br;q=1.0');
    expect(result).toEqual([
      { encoding: 'br', quality: 1.0 },
      { encoding: 'gzip', quality: 0.5 },
    ]);
  });
});

describe('negotiateEncoding', () => {
  it('should return server-preferred encoding when client supports it', () => {
    const serverEncodings = [Encoding.Brotli, Encoding.Gzip];
    const clientPreferences = [{ encoding: 'br', quality: 1.0 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Brotli);
  });

  it('should select encoding with highest client quality when multiple matches exist', () => {
    const serverEncodings = [Encoding.Gzip, Encoding.Deflate, Encoding.Brotli];
    const clientPreferences = [
      { encoding: 'gzip', quality: 0.5 },
      { encoding: 'deflate', quality: 0.9 },
      { encoding: 'br', quality: 0.3 },
    ];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Deflate);
  });

  it('should match via wildcard when no specific match exists', () => {
    const serverEncodings = [Encoding.Zstd];
    const clientPreferences = [{ encoding: '*', quality: 0.5 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Zstd);
  });

  it('should prefer specific match over wildcard when specific has higher quality', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences = [
      { encoding: 'gzip', quality: 0.9 },
      { encoding: '*', quality: 0.5 },
    ];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Gzip);
  });

  it('should return null when server encodings is empty', () => {
    const serverEncodings: Encoding[] = [];
    const clientPreferences = [{ encoding: 'gzip', quality: 1.0 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBeNull();
  });

  it('should return null when client preferences is empty', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences: { encoding: string; quality: number }[] = [];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBeNull();
  });

  it('should return null when all client qualities are 0', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences = [{ encoding: 'gzip', quality: 0 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBeNull();
  });

  it('should return null when no overlap exists between server and client', () => {
    const serverEncodings = [Encoding.Brotli];
    const clientPreferences = [{ encoding: 'gzip', quality: 1.0 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBeNull();
  });

  it('should return null when quality is exactly 0', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences = [{ encoding: 'gzip', quality: 0 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBeNull();
  });

  it('should return encoding when quality is just above 0', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences = [{ encoding: 'gzip', quality: 0.001 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Gzip);
  });

  it('should use wildcard quality when encoding not in client map', () => {
    const serverEncodings = [Encoding.Zstd];
    const clientPreferences = [{ encoding: '*', quality: 0.4 }];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Zstd);
  });

  it('should use specific quality over wildcard even when specific is q=0', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences = [
      { encoding: 'gzip', quality: 0 },
      { encoding: '*', quality: 0.5 },
    ];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBeNull();
  });

  it('should use last wildcard quality when multiple wildcards present', () => {
    const serverEncodings = [Encoding.Zstd];
    const clientPreferences = [
      { encoding: '*', quality: 0.1 },
      { encoding: '*', quality: 0.6 },
    ];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Zstd);
  });

  it('should return same result when given same input multiple times', () => {
    const serverEncodings = [Encoding.Gzip];
    const clientPreferences = [{ encoding: 'gzip', quality: 0.8 }];
    const a = negotiateEncoding(serverEncodings, clientPreferences);
    const b = negotiateEncoding(serverEncodings, clientPreferences);
    expect(a).toBe(b);
  });

  it('should break quality ties by server encoding order when client qualities are equal', () => {
    const serverEncodings = [Encoding.Brotli, Encoding.Gzip, Encoding.Deflate];
    const clientPreferences = [
      { encoding: 'br', quality: 0.5 },
      { encoding: 'gzip', quality: 0.5 },
      { encoding: 'deflate', quality: 0.5 },
    ];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Brotli);
  });

  it('should let higher quality override server order when qualities differ', () => {
    const serverEncodings = [Encoding.Brotli, Encoding.Gzip];
    const clientPreferences = [
      { encoding: 'br', quality: 0.3 },
      { encoding: 'gzip', quality: 0.9 },
    ];
    const result = negotiateEncoding(serverEncodings, clientPreferences);
    expect(result).toBe(Encoding.Gzip);
  });
});
