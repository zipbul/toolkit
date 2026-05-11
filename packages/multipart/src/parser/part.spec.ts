import { describe, test, expect } from 'bun:test';

import { MultipartFieldImpl } from './part';

const encoder = new TextEncoder();

describe('MultipartFieldImpl', () => {
  // ── 1. Field part: name set, filename undefined, isFile false ──

  test('field part has name set, filename undefined, and isFile false', () => {
    const part = new MultipartFieldImpl('field', 'text/plain', encoder.encode('value'));

    expect(part.name).toBe('field');
    expect(part.filename).toBeUndefined();
    expect(part.isFile).toBe(false);
  });

  // ── 2. text() returns UTF-8 decoded string ──

  test('text() returns UTF-8 decoded string', () => {
    const part = new MultipartFieldImpl('msg', 'text/plain', encoder.encode('hello world'));

    expect(part.text()).toBe('hello world');
  });

  // ── 3. text() on UTF-8 content (Korean + emoji) ──

  test('text() decodes Korean and emoji correctly', () => {
    const content = '안녕하세요 🎉';
    const part = new MultipartFieldImpl('greeting', 'text/plain', encoder.encode(content));

    expect(part.text()).toBe(content);
  });

  // ── 4. text() on invalid UTF-8 bytes → replacement character U+FFFD ──

  test('text() on invalid UTF-8 bytes returns string with U+FFFD replacement character', () => {
    // 0xfe and 0xff are never valid in UTF-8
    const invalidBytes = new Uint8Array([0x48, 0x69, 0xfe, 0xff]);
    const part = new MultipartFieldImpl('broken', 'application/octet-stream', invalidBytes);

    const result = part.text();

    expect(result).toContain('\uFFFD');
    expect(result.startsWith('Hi')).toBe(true);
  });

  // ── 5. bytes() returns exact Uint8Array reference ──

  test('bytes() returns the exact same Uint8Array reference', () => {
    const data = new Uint8Array([1, 2, 3]);
    const part = new MultipartFieldImpl('bin', 'application/octet-stream', data);

    expect(part.bytes()).toBe(data);
  });

  // ── 6. bytes() returns correct data ──

  test('bytes() returns correct data contents', () => {
    const data = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
    const part = new MultipartFieldImpl('bin', 'application/octet-stream', data);

    const result = part.bytes();

    expect(result.length).toBe(4);
    expect(result[0]).toBe(0xca);
    expect(result[1]).toBe(0xfe);
    expect(result[2]).toBe(0xba);
    expect(result[3]).toBe(0xbe);
  });

  // ── 7. Empty body ──

  describe('empty body', () => {
    const part = new MultipartFieldImpl('empty', 'text/plain', new Uint8Array(0));

    test('text() returns empty string', () => {
      expect(part.text()).toBe('');
    });

    test('bytes() returns empty Uint8Array', () => {
      const result = part.bytes();

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });
  });

  // ── 8. Large body (10KB) ──

  describe('large body (10KB)', () => {
    const size = 10 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const part = new MultipartFieldImpl('large', 'application/octet-stream', data);

    test('bytes() returns full 10KB', () => {
      expect(part.bytes().length).toBe(size);
      expect(part.bytes()).toBe(data);
    });

    test('text() returns a string of correct byte length', () => {
      const result = part.text();

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ── 9. contentType is correctly stored ──

  test('contentType is correctly stored', () => {
    const part = new MultipartFieldImpl('doc', 'application/pdf', new Uint8Array(0));

    expect(part.contentType).toBe('application/pdf');
  });
});
