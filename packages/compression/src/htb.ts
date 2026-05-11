/**
 * Heal-the-BREACH (HTB) — injects random-length padding into compressed
 * output so that sizes vary between requests, defeating BREACH oracle attacks.
 *
 * Gzip: padding in FEXTRA field (RFC 1952 §2.3.1).
 * Zstd: prepended Skippable Frame (RFC 8878 §3.1.2).
 *
 * The padding is transparent to any RFC-compliant decompressor.
 */

const GZIP_HEADER_SIZE = 10;
const FEXTRA_FLAG = 0x04;
const MAX_XLEN = 0xffff; // 16-bit max for gzip XLEN field

// RFC 1952 §2.3.1: FEXTRA subfield header (SI1, SI2, LEN)
const SUBFIELD_HEADER_SIZE = 4; // SI1(1) + SI2(1) + LEN(2)
const SUBFIELD_SI1 = 0x5a; // 'Z'
const SUBFIELD_SI2 = 0x50; // 'P' — "ZP" identifies zipbul padding

/** Bias-free CSPRNG integer in [1, maxPadding] via rejection sampling. */
const rngBuf = new Uint32Array(1);
function randomPadLen(maxPadding: number): number {
  const limit = 0x100000000 - (0x100000000 % maxPadding);
  let value: number;
  do {
    crypto.getRandomValues(rngBuf);
    value = rngBuf[0]!;
  } while (value >= limit);
  return 1 + (value % maxPadding);
}

/** Writes a proper RFC 1952 subfield: SI1 SI2 LEN(le16) data. */
function writeSubfield(target: Uint8Array, offset: number, dataLen: number): void {
  target[offset] = SUBFIELD_SI1;
  target[offset + 1] = SUBFIELD_SI2;
  target[offset + 2] = dataLen & 0xff;
  target[offset + 3] = (dataLen >> 8) & 0xff;
}

export function injectGzipPadding(compressed: Uint8Array, maxPadding: number): Uint8Array {
  const padLen = randomPadLen(maxPadding);
  const subfieldTotal = SUBFIELD_HEADER_SIZE + padLen; // total bytes added to extra field
  const hasFExtra = (compressed[3]! & FEXTRA_FLAG) !== 0;

  if (hasFExtra) {
    // Existing FEXTRA: read current XLEN, append a new subfield
    const existingXlen = compressed[GZIP_HEADER_SIZE]! | (compressed[GZIP_HEADER_SIZE + 1]! << 8);
    const newXlen = existingXlen + subfieldTotal;

    // XLEN is a 16-bit field; if subfield would overflow, return unmodified copy
    if (newXlen > MAX_XLEN) return compressed.slice();

    const result = new Uint8Array(compressed.length + subfieldTotal);
    // Header (10 bytes)
    result.set(compressed.subarray(0, GZIP_HEADER_SIZE));
    // New XLEN
    result[GZIP_HEADER_SIZE] = newXlen & 0xff;
    result[GZIP_HEADER_SIZE + 1] = (newXlen >> 8) & 0xff;
    // Original extra data
    const extraStart = GZIP_HEADER_SIZE + 2;
    result.set(compressed.subarray(extraStart, extraStart + existingXlen), extraStart);
    // New subfield (SI1 SI2 LEN data) after existing extra data
    writeSubfield(result, extraStart + existingXlen, padLen);
    // Padding data (zero-filled by Uint8Array constructor)
    // Rest of compressed data
    const afterExtra = extraStart + existingXlen;
    result.set(compressed.subarray(afterExtra), extraStart + newXlen);

    return result;
  }

  // No existing FEXTRA: insert XLEN + subfield after header
  const result = new Uint8Array(compressed.length + 2 + subfieldTotal);
  // Header (10 bytes), set FEXTRA flag
  result.set(compressed.subarray(0, GZIP_HEADER_SIZE));
  result[3] = compressed[3]! | FEXTRA_FLAG;
  // XLEN (little-endian)
  result[GZIP_HEADER_SIZE] = subfieldTotal & 0xff;
  result[GZIP_HEADER_SIZE + 1] = (subfieldTotal >> 8) & 0xff;
  // Subfield header
  writeSubfield(result, GZIP_HEADER_SIZE + 2, padLen);
  // Padding data (zero-filled by Uint8Array constructor)
  // Rest of compressed data
  result.set(compressed.subarray(GZIP_HEADER_SIZE), GZIP_HEADER_SIZE + 2 + subfieldTotal);

  return result;
}

const ZSTD_SKIPPABLE_MAGIC = 0x184d2a50;

export function injectZstdPadding(compressed: Uint8Array, maxPadding: number): Uint8Array {
  const padLen = randomPadLen(maxPadding);
  const frameOverhead = 8; // 4 bytes magic + 4 bytes frame size
  const result = new Uint8Array(frameOverhead + padLen + compressed.length);

  // Skippable Frame magic number (little-endian)
  result[0] = ZSTD_SKIPPABLE_MAGIC & 0xff;
  result[1] = (ZSTD_SKIPPABLE_MAGIC >> 8) & 0xff;
  result[2] = (ZSTD_SKIPPABLE_MAGIC >> 16) & 0xff;
  result[3] = (ZSTD_SKIPPABLE_MAGIC >> 24) & 0xff;

  // User_Data size (little-endian)
  result[4] = padLen & 0xff;
  result[5] = (padLen >> 8) & 0xff;
  result[6] = (padLen >> 16) & 0xff;
  result[7] = (padLen >> 24) & 0xff;

  // Padding bytes (zero-filled by Uint8Array constructor)
  // Actual compressed frame follows
  result.set(compressed, frameOverhead + padLen);

  return result;
}
