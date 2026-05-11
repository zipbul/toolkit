import { describe, test, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { extractBoundary } from './boundary';
import { MultipartErrorReason } from '../enums';

describe('extractBoundary', () => {
  // ── Success cases ────────────────────────────────────────────────

  test('extracts unquoted boundary from standard Content-Type', () => {
    const result = extractBoundary('multipart/form-data; boundary=----WebKitFormBoundaryABC123');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('----WebKitFormBoundaryABC123');
  });

  test('extracts quoted boundary', () => {
    const result = extractBoundary('multipart/form-data; boundary="----boundary"');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('----boundary');
  });

  test('extracts quoted boundary with spaces inside', () => {
    const result = extractBoundary('multipart/form-data; boundary="abc def ghi"');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('abc def ghi');
  });

  test('handles case-insensitive Content-Type ("Multipart/Form-Data")', () => {
    const result = extractBoundary('Multipart/Form-Data; boundary=abc');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('abc');
  });

  test('handles case-insensitive boundary parameter ("Boundary=abc")', () => {
    const result = extractBoundary('multipart/form-data; Boundary=abc');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('abc');
  });

  test('handles extra whitespace around boundary parameter', () => {
    const result = extractBoundary('multipart/form-data;  boundary=abc');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('abc');
  });

  test('handles multiple parameters with charset before boundary', () => {
    const result = extractBoundary('multipart/form-data; charset=utf-8; boundary=abc');
    expect(isErr(result)).toBe(false);
    expect(result).toBe('abc');
  });

  test('accepts boundary at exactly 70 characters (max per RFC 2046)', () => {
    const boundary = 'a'.repeat(70);
    const result = extractBoundary(`multipart/form-data; boundary=${boundary}`);
    expect(isErr(result)).toBe(false);
    expect(result).toBe(boundary);
  });

  test('accepts boundary with valid RFC 2046 special characters', () => {
    // RFC 2046 allows: digits, letters, and: '()+_,-./:=?
    const boundary = "----abc123_+.-'()/=?:XYZ";
    const result = extractBoundary(`multipart/form-data; boundary=${boundary}`);
    expect(isErr(result)).toBe(false);
    expect(result).toBe(boundary);
  });

  test('unquoted boundary with leading space after = does not match (treated as missing)', () => {
    // The regex `([^\s;]+)` for unquoted boundaries starts matching at the first
    // non-whitespace char, but the overall pattern expects the value immediately
    // after `=`. A space after `=` breaks the unquoted match, so no boundary is found.
    const result = extractBoundary('multipart/form-data; boundary= abc');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MissingBoundary);
    }
  });

  // ── InvalidContentType errors ────────────────────────────────────

  test('returns InvalidContentType for null content type', () => {
    const result = extractBoundary(null);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.InvalidContentType);
      expect(result.data.message).toBe('Content-Type header is missing');
    }
  });

  test('returns InvalidContentType for empty string', () => {
    const result = extractBoundary('');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.InvalidContentType);
      expect(result.data.message).toBe('Content-Type header is missing');
    }
  });

  test('returns InvalidContentType for non-multipart content type ("application/json")', () => {
    const result = extractBoundary('application/json');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.InvalidContentType);
      expect(result.data.message).toBe('Expected multipart/form-data, got "application/json"');
    }
  });

  // ── MissingBoundary errors ───────────────────────────────────────

  test('returns MissingBoundary when boundary parameter is absent', () => {
    const result = extractBoundary('multipart/form-data');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MissingBoundary);
      expect(result.data.message).toBe('Boundary parameter is missing from Content-Type');
    }
  });

  test('returns MissingBoundary for empty quoted boundary', () => {
    const result = extractBoundary('multipart/form-data; boundary=""');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MissingBoundary);
      expect(result.data.message).toBe('Boundary parameter is empty');
    }
  });

  test('returns MissingBoundary for boundary at 71 characters (exceeds max)', () => {
    const boundary = 'a'.repeat(71);
    const result = extractBoundary(`multipart/form-data; boundary=${boundary}`);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MissingBoundary);
      expect(result.data.message).toBe(
        `Boundary length (71) exceeds maximum of 70 characters (RFC 2046)`,
      );
    }
  });

  test('returns MissingBoundary for very long boundary (1000 chars)', () => {
    const boundary = 'x'.repeat(1000);
    const result = extractBoundary(`multipart/form-data; boundary=${boundary}`);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MissingBoundary);
      expect(result.data.message).toBe(
        `Boundary length (1000) exceeds maximum of 70 characters (RFC 2046)`,
      );
    }
  });
});
