import { describe, expect, it } from 'bun:test';
import { injectGzipPadding, injectZstdPadding } from './htb.ts';

describe('injectGzipPadding (HTB - Heal the BREACH)', () => {
  const data = new TextEncoder().encode('Hello, World!'.repeat(100));

  function compress(input: Uint8Array): Uint8Array {
    return Bun.gzipSync(input);
  }

  // --- Correctness ---

  it('should produce output that decompresses to the same data as the original', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 32);
    const decompressed = Bun.gunzipSync(padded);
    expect(Buffer.from(decompressed).toString()).toBe(Buffer.from(data).toString());
  });

  it('should set the FEXTRA flag (bit 2) in the gzip header', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 32);
    expect(padded[3] & 0x04).toBe(0x04);
  });

  it('should produce output longer than the original compressed data', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 32);
    expect(padded.byteLength).toBeGreaterThan(compressed.byteLength);
  });

  it('should insert XLEN + RFC 1952 subfield after the 10-byte gzip header', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 16);
    // Bytes 10-11 should be XLEN (little-endian)
    const xlen = padded[10] | (padded[11] << 8);
    // XLEN = 4 (subfield header: SI1+SI2+LEN) + padLen (1..16)
    expect(xlen).toBeGreaterThanOrEqual(5);  // 4 + 1
    expect(xlen).toBeLessThanOrEqual(20);    // 4 + 16
    // Subfield header: SI1='Z'(0x5a), SI2='P'(0x50)
    expect(padded[12]).toBe(0x5a);
    expect(padded[13]).toBe(0x50);
    // Subfield LEN = padLen = xlen - 4
    const subfieldLen = padded[14] | (padded[15] << 8);
    expect(subfieldLen).toBe(xlen - 4);
    // Total size = original + 2 (XLEN field) + xlen (subfield)
    expect(padded.byteLength).toBe(compressed.byteLength + 2 + xlen);
  });

  // --- Randomness ---

  it('should produce varying output sizes across multiple calls', () => {
    const compressed = compress(data);
    const sizes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      sizes.add(injectGzipPadding(compressed, 64).byteLength);
    }
    // With maxPadding=64, 50 iterations should yield multiple distinct sizes
    expect(sizes.size).toBeGreaterThan(1);
  });

  // --- Boundary ---

  it('should work with maxPadding=1 (always adds exactly 1 byte of padding data)', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 1);
    const xlen = padded[10] | (padded[11] << 8);
    expect(xlen).toBe(5); // 4 (subfield header) + 1 (padding data)
    expect(padded.byteLength).toBe(compressed.byteLength + 7); // +2 XLEN field + 5 subfield
    expect(Buffer.from(Bun.gunzipSync(padded)).toString()).toBe(Buffer.from(data).toString());
  });

  it('should work with large maxPadding=256', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 256);
    const xlen = padded[10] | (padded[11] << 8);
    // xlen = 4 (subfield header) + padLen (1..256)
    expect(xlen).toBeGreaterThanOrEqual(5);
    expect(xlen).toBeLessThanOrEqual(260);
    expect(Buffer.from(Bun.gunzipSync(padded)).toString()).toBe(Buffer.from(data).toString());
  });

  // --- Preserves original header fields ---

  it('should preserve ID1, ID2, CM, MTIME, XFL, OS from the original header', () => {
    const compressed = compress(data);
    const padded = injectGzipPadding(compressed, 32);
    // ID1, ID2, CM unchanged
    expect(padded[0]).toBe(0x1f);
    expect(padded[1]).toBe(0x8b);
    expect(padded[2]).toBe(0x08);
    // MTIME (bytes 4-7), XFL (byte 8), OS (byte 9) unchanged
    for (const i of [4, 5, 6, 7, 8, 9]) {
      expect(padded[i]).toBe(compressed[i]);
    }
  });

  // --- XLEN overflow guard ---

  it('should return original compressed data when XLEN would overflow 16-bit max', () => {
    const compressed = compress(data);
    // Create a gzip with FEXTRA already at near-max XLEN (65530)
    const bigXlen = 65530;
    const fakeGzip = new Uint8Array(compressed.length + 2 + bigXlen);
    fakeGzip.set(compressed.subarray(0, 10));
    fakeGzip[3] = compressed[3]! | 0x04; // FEXTRA flag
    fakeGzip[10] = bigXlen & 0xff;
    fakeGzip[11] = (bigXlen >> 8) & 0xff;
    fakeGzip.set(compressed.subarray(10), 12 + bigXlen);

    const result = injectGzipPadding(fakeGzip, 100);
    // Should return a copy (not mutated) since 65530 + padding > 65535
    expect(result).not.toBe(fakeGzip);
    expect(result).toEqual(fakeGzip);
  });

  // --- Existing FEXTRA ---

  it('should handle input that already has FEXTRA by appending a new subfield', () => {
    const compressed = compress(data);
    // Manually inject a small FEXTRA with one valid subfield (SI1=0xAA, SI2=0xBB, LEN=0)
    const existingExtra = new Uint8Array(compressed.length + 6);
    existingExtra.set(compressed.subarray(0, 10));
    existingExtra[3] = compressed[3] | 0x04;
    existingExtra[10] = 4; // XLEN = 4 (one subfield: SI1+SI2+LEN, no data)
    existingExtra[11] = 0;
    existingExtra[12] = 0xAA; // SI1
    existingExtra[13] = 0xBB; // SI2
    existingExtra[14] = 0x00; // LEN lo = 0
    existingExtra[15] = 0x00; // LEN hi = 0
    existingExtra.set(compressed.subarray(10), 16);

    const padded = injectGzipPadding(existingExtra, 32);
    // Must still decompress correctly
    expect(Buffer.from(Bun.gunzipSync(padded)).toString()).toBe(Buffer.from(data).toString());
    // New XLEN should be old XLEN (4) + 4 (subfield header) + padLen (1..32)
    const newXlen = padded[10] | (padded[11] << 8);
    expect(newXlen).toBeGreaterThanOrEqual(9);  // 4 + 4 + 1
    expect(newXlen).toBeLessThanOrEqual(40);    // 4 + 4 + 32
    // Original subfield should be preserved
    expect(padded[12]).toBe(0xAA);
    expect(padded[13]).toBe(0xBB);
  });
});

describe('injectZstdPadding (HTB - Skippable Frame)', () => {
  const data = new TextEncoder().encode('Hello, World!'.repeat(100));

  function compress(input: Uint8Array): Uint8Array {
    return new Uint8Array(Bun.zstdCompressSync(input, { level: 3 }));
  }

  it('should produce output that decompresses to the same data', () => {
    const compressed = compress(data);
    const padded = injectZstdPadding(compressed, 32);
    const decompressed = Bun.zstdDecompressSync(padded);
    expect(Buffer.from(decompressed).toString()).toBe(Buffer.from(data).toString());
  });

  it('should prepend a Skippable Frame with correct magic number', () => {
    const compressed = compress(data);
    const padded = injectZstdPadding(compressed, 32);
    // Magic: 0x184D2A50 in little-endian
    expect(padded[0]).toBe(0x50);
    expect(padded[1]).toBe(0x2a);
    expect(padded[2]).toBe(0x4d);
    expect(padded[3]).toBe(0x18);
  });

  it('should produce output longer than the original', () => {
    const compressed = compress(data);
    const padded = injectZstdPadding(compressed, 32);
    // At least 8 bytes overhead (magic + size) + 1 byte padding
    expect(padded.byteLength).toBeGreaterThan(compressed.byteLength + 8);
  });

  it('should encode frame size correctly in little-endian', () => {
    const compressed = compress(data);
    const padded = injectZstdPadding(compressed, 16);
    const frameSize = padded[4] | (padded[5] << 8) | (padded[6] << 16) | (padded[7] << 24);
    expect(frameSize).toBeGreaterThanOrEqual(1);
    expect(frameSize).toBeLessThanOrEqual(16);
    // Total = 8 (header) + frameSize (padding) + compressed.length
    expect(padded.byteLength).toBe(8 + frameSize + compressed.byteLength);
  });

  it('should produce varying output sizes across multiple calls', () => {
    const compressed = compress(data);
    const sizes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      sizes.add(injectZstdPadding(compressed, 64).byteLength);
    }
    expect(sizes.size).toBeGreaterThan(1);
  });

  it('should work with maxPadding=1 (always adds exactly 1 byte)', () => {
    const compressed = compress(data);
    const padded = injectZstdPadding(compressed, 1);
    const frameSize = padded[4];
    expect(frameSize).toBe(1);
    expect(padded.byteLength).toBe(8 + 1 + compressed.byteLength);
    expect(Buffer.from(Bun.zstdDecompressSync(padded)).toString()).toBe(Buffer.from(data).toString());
  });

  it('should work with large maxPadding=256', () => {
    const compressed = compress(data);
    const padded = injectZstdPadding(compressed, 256);
    const frameSize = padded[4] | (padded[5] << 8);
    expect(frameSize).toBeGreaterThanOrEqual(1);
    expect(frameSize).toBeLessThanOrEqual(256);
    expect(Buffer.from(Bun.zstdDecompressSync(padded)).toString()).toBe(Buffer.from(data).toString());
  });
});
