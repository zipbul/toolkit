import { describe, expect, test } from 'bun:test';

import { sanitizeFilename } from './sanitize';

describe('sanitizeFilename', () => {
  // ── Basic sanitization ──────────────────────────────────────────────

  test('passes through a simple valid filename', () => {
    expect(sanitizeFilename('photo.jpg')).toBe('photo.jpg');
  });

  test('passes through filename without extension', () => {
    expect(sanitizeFilename('README')).toBe('README');
  });

  // ── Directory stripping ─────────────────────────────────────────────

  test('strips Unix directory components', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  });

  test('strips Windows directory components', () => {
    expect(sanitizeFilename('C:\\Users\\alice\\file.txt')).toBe('file.txt');
  });

  test('strips mixed slashes', () => {
    expect(sanitizeFilename('path/to\\file.txt')).toBe('file.txt');
  });

  // ── Unsafe character replacement ────────────────────────────────────

  test('replaces < and > with underscore', () => {
    expect(sanitizeFilename('photo<1>.jpg')).toBe('photo_1_.jpg');
  });

  test('replaces : " | ? *', () => {
    expect(sanitizeFilename('file:name"with|bad?chars*.txt')).toBe(
      'file_name_with_bad_chars_.txt',
    );
  });

  test('removes null bytes', () => {
    expect(sanitizeFilename('file\x00name.txt')).toBe('file_name.txt');
  });

  test('removes control characters', () => {
    expect(sanitizeFilename('file\x01\x1fname.txt')).toBe('file__name.txt');
  });

  test('custom replacement character', () => {
    expect(sanitizeFilename('file<name>.txt', { replacement: '-' })).toBe('file-name-.txt');
  });

  // ── Leading dots ────────────────────────────────────────────────────

  test('removes single leading dot', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
  });

  test('removes multiple leading dots', () => {
    expect(sanitizeFilename('...hidden')).toBe('hidden');
  });

  // ── Dot and dotdot ──────────────────────────────────────────────────

  test('returns undefined for single dot', () => {
    expect(sanitizeFilename('.')).toBeUndefined();
  });

  test('returns undefined for double dot', () => {
    expect(sanitizeFilename('..')).toBeUndefined();
  });

  test('returns undefined for many dots', () => {
    expect(sanitizeFilename('...')).toBeUndefined();
  });

  // ── Empty / whitespace ──────────────────────────────────────────────

  test('returns undefined for empty string', () => {
    expect(sanitizeFilename('')).toBeUndefined();
  });

  test('returns undefined for whitespace-only string', () => {
    expect(sanitizeFilename('   ')).toBeUndefined();
  });

  test('trims leading/trailing whitespace', () => {
    expect(sanitizeFilename('  file.txt  ')).toBe('file.txt');
  });

  test('trims trailing dots', () => {
    expect(sanitizeFilename('file...')).toBe('file');
  });

  // ── Windows reserved names ──────────────────────────────────────────

  test('rejects CON (case-insensitive)', () => {
    expect(sanitizeFilename('CON')).toBeUndefined();
    expect(sanitizeFilename('con')).toBeUndefined();
    expect(sanitizeFilename('Con')).toBeUndefined();
  });

  test('rejects PRN', () => {
    expect(sanitizeFilename('PRN')).toBeUndefined();
  });

  test('rejects AUX', () => {
    expect(sanitizeFilename('AUX')).toBeUndefined();
  });

  test('rejects NUL', () => {
    expect(sanitizeFilename('NUL')).toBeUndefined();
  });

  test('rejects COM1-COM9', () => {
    expect(sanitizeFilename('COM1')).toBeUndefined();
    expect(sanitizeFilename('com9')).toBeUndefined();
  });

  test('rejects LPT1-LPT9', () => {
    expect(sanitizeFilename('LPT1')).toBeUndefined();
    expect(sanitizeFilename('lpt3')).toBeUndefined();
  });

  test('rejects reserved name with extension', () => {
    expect(sanitizeFilename('CON.txt')).toBeUndefined();
    expect(sanitizeFilename('nul.tar.gz')).toBeUndefined();
  });

  test('does not reject names that contain reserved as substring', () => {
    expect(sanitizeFilename('confile.txt')).toBe('confile.txt');
    expect(sanitizeFilename('auxiliary.doc')).toBe('auxiliary.doc');
  });

  // ── Max length ──────────────────────────────────────────────────────

  test('truncates to maxLength preserving extension', () => {
    const longName = 'a'.repeat(300) + '.txt';
    const result = sanitizeFilename(longName)!;

    expect(result.length).toBe(255);
    expect(result.endsWith('.txt')).toBe(true);
  });

  test('truncates to custom maxLength', () => {
    const longName = 'a'.repeat(50) + '.jpg';
    const result = sanitizeFilename(longName, { maxLength: 20 })!;

    expect(result.length).toBe(20);
    expect(result.endsWith('.jpg')).toBe(true);
  });

  test('does not truncate short filenames', () => {
    expect(sanitizeFilename('short.txt')).toBe('short.txt');
  });

  test('truncates without extension preservation if extension is too long', () => {
    const longName = 'a'.repeat(10) + '.' + 'x'.repeat(30);
    const result = sanitizeFilename(longName, { maxLength: 20 })!;

    expect(result.length).toBe(20);
  });

  // ── Combined edge cases ─────────────────────────────────────────────

  test('directory traversal + unsafe chars', () => {
    expect(sanitizeFilename('../path/<file>.txt')).toBe('_file_.txt');
  });

  test('all unsafe input produces undefined', () => {
    expect(sanitizeFilename('///\\\\')).toBeUndefined();
  });

  test('filename with only extension after stripping', () => {
    expect(sanitizeFilename('.gitignore')).toBe('gitignore');
  });

  test('real-world user upload filename', () => {
    const result = sanitizeFilename('IMG_20240101 (1).jpg');

    expect(result).toBe('IMG_20240101 (1).jpg');
  });
});
