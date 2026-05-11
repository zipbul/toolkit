import { brotliCompressSync, deflateSync, constants as zlibConstants } from 'node:zlib';
import { Encoding } from './enums.ts';
import type { BufferCompressFn } from './types.ts';

// Bun native APIs require Uint8Array<ArrayBuffer> (excludes SharedArrayBuffer)
type BunSafeArray = Uint8Array<ArrayBuffer>;
// Bun ZlibCompressionOptions.level is a literal union; runtime-validated by options.ts
type BunZlibLevel = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const BUFFER_COMPRESSORS: Record<Encoding, BufferCompressFn> = {
  [Encoding.Gzip]: (data, level) =>
    Bun.gzipSync(data as BunSafeArray, { level: level as BunZlibLevel }),
  // RFC 1950: HTTP Content-Encoding: deflate requires zlib-wrapped format.
  // Bun.deflateSync produces raw deflate (RFC 1951), so we use node:zlib instead.
  [Encoding.Deflate]: (data, level) =>
    deflateSync(data, { level }),
  [Encoding.Brotli]: (data, level) =>
    brotliCompressSync(data, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level },
    }),
  [Encoding.Zstd]: (data, level) =>
    Bun.zstdCompressSync(data, { level }),
};
