import { describe, test, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { resolveMultipartOptions, validateMultipartOptions } from './options';
import {
  DEFAULT_MAX_FIELD_SIZE,
  DEFAULT_MAX_FIELDS,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_HEADER_SIZE,
  DEFAULT_MAX_PARTS,
  DEFAULT_MAX_TOTAL_SIZE,
} from './constants';
import { MultipartErrorReason } from './enums';

// ── resolveMultipartOptions ─────────────────────────────────────────

describe('resolveMultipartOptions', () => {
  test('fills all defaults when no options provided', () => {
    const resolved = resolveMultipartOptions();
    expect(resolved.maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(resolved.maxFiles).toBe(DEFAULT_MAX_FILES);
    expect(resolved.maxFieldSize).toBe(DEFAULT_MAX_FIELD_SIZE);
    expect(resolved.maxFields).toBe(DEFAULT_MAX_FIELDS);
    expect(resolved.maxHeaderSize).toBe(DEFAULT_MAX_HEADER_SIZE);
    expect(resolved.maxTotalSize).toBe(DEFAULT_MAX_TOTAL_SIZE);
    expect(resolved.maxParts).toBe(DEFAULT_MAX_PARTS);
    expect(resolved.allowedMimeTypes).toBeUndefined();
  });

  test('fills all defaults when empty object provided', () => {
    const resolved = resolveMultipartOptions({});
    expect(resolved.maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(resolved.maxFiles).toBe(DEFAULT_MAX_FILES);
    expect(resolved.maxFieldSize).toBe(DEFAULT_MAX_FIELD_SIZE);
    expect(resolved.maxFields).toBe(DEFAULT_MAX_FIELDS);
    expect(resolved.maxHeaderSize).toBe(DEFAULT_MAX_HEADER_SIZE);
    expect(resolved.maxTotalSize).toBe(DEFAULT_MAX_TOTAL_SIZE);
    expect(resolved.maxParts).toBe(DEFAULT_MAX_PARTS);
    expect(resolved.allowedMimeTypes).toBeUndefined();
  });

  test('preserves user-provided values', () => {
    const resolved = resolveMultipartOptions({
      maxFileSize: 1024,
      maxFiles: 5,
      maxFieldSize: 512,
      maxFields: 50,
      maxHeaderSize: 4096,
      maxTotalSize: 1024 * 1024,
      maxParts: 20,
      allowedMimeTypes: { avatar: ['image/png'] },
    });
    expect(resolved.maxFileSize).toBe(1024);
    expect(resolved.maxFiles).toBe(5);
    expect(resolved.maxFieldSize).toBe(512);
    expect(resolved.maxFields).toBe(50);
    expect(resolved.maxHeaderSize).toBe(4096);
    expect(resolved.maxTotalSize).toBe(1024 * 1024);
    expect(resolved.maxParts).toBe(20);
    expect(resolved.allowedMimeTypes).toEqual({ avatar: ['image/png'] });
  });

  test('preserves explicit null for maxTotalSize', () => {
    const resolved = resolveMultipartOptions({ maxTotalSize: null });
    expect(resolved.maxTotalSize).toBeNull();
  });

  test('partial overrides keep other defaults', () => {
    const resolved = resolveMultipartOptions({ maxFileSize: 999 });
    expect(resolved.maxFileSize).toBe(999);
    expect(resolved.maxFiles).toBe(DEFAULT_MAX_FILES);
    expect(resolved.maxFieldSize).toBe(DEFAULT_MAX_FIELD_SIZE);
    expect(resolved.maxFields).toBe(DEFAULT_MAX_FIELDS);
    expect(resolved.maxHeaderSize).toBe(DEFAULT_MAX_HEADER_SIZE);
    expect(resolved.maxTotalSize).toBe(DEFAULT_MAX_TOTAL_SIZE);
    expect(resolved.maxParts).toBe(DEFAULT_MAX_PARTS);
  });

  test('does not replace 0 with default (0 flows through to validation)', () => {
    const resolved = resolveMultipartOptions({ maxFileSize: 0 });
    expect(resolved.maxFileSize).toBe(0);
  });
});

// ── validateMultipartOptions ────────────────────────────────────────

describe('validateMultipartOptions', () => {
  test('returns undefined for valid default options', () => {
    const resolved = resolveMultipartOptions();
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('returns undefined for valid custom options', () => {
    const resolved = resolveMultipartOptions({
      maxFileSize: 1,
      maxFiles: 1,
      maxFieldSize: 1,
      maxFields: 1,
      maxHeaderSize: 1,
      maxTotalSize: 1,
    });
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('accepts null maxTotalSize', () => {
    const resolved = resolveMultipartOptions({ maxTotalSize: null });
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('rejects non-positive maxFileSize', () => {
    for (const maxFileSize of [0, -1, -100, 1.5, 0.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxFileSize });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.reason).toBe(MultipartErrorReason.InvalidOptions);
        expect(result.data.message).toContain('maxFileSize');
      }
    }
  });

  test('rejects non-positive maxFiles', () => {
    for (const maxFiles of [0, -1, 1.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxFiles });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.message).toContain('maxFiles');
      }
    }
  });

  test('rejects non-positive maxFieldSize', () => {
    for (const maxFieldSize of [0, -1, 1.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxFieldSize });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.message).toContain('maxFieldSize');
      }
    }
  });

  test('rejects non-positive maxFields', () => {
    for (const maxFields of [0, -1, 1.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxFields });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.message).toContain('maxFields');
      }
    }
  });

  test('rejects non-positive maxHeaderSize', () => {
    for (const maxHeaderSize of [0, -1, 1.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxHeaderSize });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.message).toContain('maxHeaderSize');
      }
    }
  });

  test('rejects non-positive maxTotalSize', () => {
    for (const maxTotalSize of [0, -1, 1.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxTotalSize });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.message).toContain('maxTotalSize');
      }
    }
  });

  test('rejects Infinity for all numeric options', () => {
    for (const key of ['maxFileSize', 'maxFiles', 'maxFieldSize', 'maxFields', 'maxHeaderSize'] as const) {
      const resolved = resolveMultipartOptions({ [key]: Infinity });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
    }
  });

  test('rejects negative Infinity', () => {
    const resolved = resolveMultipartOptions({ maxFileSize: -Infinity });
    const result = validateMultipartOptions(resolved);
    expect(isErr(result)).toBe(true);
  });

  test('accepts large but valid integers', () => {
    const resolved = resolveMultipartOptions({ maxFileSize: Number.MAX_SAFE_INTEGER });
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('error includes InvalidOptions reason for all rejections', () => {
    const resolved = resolveMultipartOptions({ maxFileSize: -1 });
    const result = validateMultipartOptions(resolved);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.InvalidOptions);
    }
  });

  // ── maxParts validation ──

  test('accepts Infinity for maxParts (default)', () => {
    const resolved = resolveMultipartOptions();
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('accepts positive integer for maxParts', () => {
    const resolved = resolveMultipartOptions({ maxParts: 50 });
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('rejects non-positive maxParts', () => {
    for (const maxParts of [0, -1, 1.5, NaN]) {
      const resolved = resolveMultipartOptions({ maxParts });
      const result = validateMultipartOptions(resolved);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.message).toContain('maxParts');
      }
    }
  });

  // ── allowedMimeTypes validation ──

  test('accepts valid allowedMimeTypes', () => {
    const resolved = resolveMultipartOptions({
      allowedMimeTypes: { avatar: ['image/png', 'image/jpeg'] },
    });
    expect(validateMultipartOptions(resolved)).toBeUndefined();
  });

  test('rejects empty array in allowedMimeTypes', () => {
    const resolved = resolveMultipartOptions({
      allowedMimeTypes: { avatar: [] },
    });
    const result = validateMultipartOptions(resolved);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('allowedMimeTypes');
      expect(result.data.message).toContain('avatar');
    }
  });
});
