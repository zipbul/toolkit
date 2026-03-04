import { describe, test, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { parsePartHeaders } from './header-parser';
import { MultipartErrorReason } from '../enums';

describe('parsePartHeaders', () => {
  // ── 1. Basic field (name only, no filename) ─────────────────────────

  test('parses basic field headers with name only', () => {
    const result = parsePartHeaders('Content-Disposition: form-data; name="field1"');
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('field1');
      expect(result.filename).toBeUndefined();
      expect(result.contentType).toBe('text/plain');
    }
  });

  // ── 2. File headers (name + filename + Content-Type) ────────────────

  test('parses file headers with name, filename, and Content-Type', () => {
    const headers = [
      'Content-Disposition: form-data; name="file"; filename="photo.png"',
      'Content-Type: image/png',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('file');
      expect(result.filename).toBe('photo.png');
      expect(result.contentType).toBe('image/png');
    }
  });

  // ── 3. Unquoted name value ──────────────────────────────────────────

  test('handles unquoted name value', () => {
    const result = parsePartHeaders('Content-Disposition: form-data; name=fieldname');
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('fieldname');
    }
  });

  // ── 4. Unquoted filename value ──────────────────────────────────────

  test('handles unquoted filename value', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename=report.pdf',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('report.pdf');
    }
  });

  // ── 5. Empty filename ("") ──────────────────────────────────────────

  test('handles empty quoted filename as empty string', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename=""',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('');
    }
  });

  // ── 6. Missing Content-Disposition ──────────────────────────────────

  test('returns MalformedHeader error when Content-Disposition is missing', () => {
    const result = parsePartHeaders('Content-Type: text/plain');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
      expect(result.data.message).toContain('Content-Disposition');
    }
  });

  // ── 7. Missing name parameter ──────────────────────────────────────

  test('returns MalformedHeader error when name parameter is missing', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; filename="file.txt"',
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
      expect(result.data.message).toContain('name');
    }
  });

  // ── 8. Case-insensitive header names ────────────────────────────────

  test('handles uppercase CONTENT-DISPOSITION', () => {
    const result = parsePartHeaders(
      'CONTENT-DISPOSITION: form-data; name="test"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('test');
    }
  });

  test('handles lowercase content-disposition', () => {
    const result = parsePartHeaders(
      'content-disposition: form-data; name="test"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('test');
    }
  });

  test('handles mixed-case content-type', () => {
    const headers = [
      'Content-Disposition: form-data; name="f"; filename="a.txt"',
      'CONTENT-TYPE: application/json',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.contentType).toBe('application/json');
    }
  });

  // ── 9. Extra whitespace in header values ────────────────────────────

  test('handles extra whitespace around header values', () => {
    const result = parsePartHeaders(
      'Content-Disposition:   form-data;  name="spaced"  ',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('spaced');
    }
  });

  test('handles extra whitespace around Content-Type value', () => {
    const headers = [
      'Content-Disposition: form-data; name="f"',
      'Content-Type:   text/html  ',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.contentType).toBe('text/html');
    }
  });

  // ── 10. Multiple headers (unknown headers ignored) ──────────────────

  test('ignores unknown headers and still parses correctly', () => {
    const headers = [
      'Content-Disposition: form-data; name="data"; filename="file.bin"',
      'Content-Type: application/octet-stream',
      'X-Custom-Header: some-value',
      'Content-Transfer-Encoding: binary',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('data');
      expect(result.filename).toBe('file.bin');
      expect(result.contentType).toBe('application/octet-stream');
    }
  });

  // ── 11. Bare \n line endings (M4 fix) ───────────────────────────────

  test('parses headers with bare \\n line endings', () => {
    const headers = [
      'Content-Disposition: form-data; name="field"; filename="doc.pdf"',
      'Content-Type: application/pdf',
    ].join('\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('field');
      expect(result.filename).toBe('doc.pdf');
      expect(result.contentType).toBe('application/pdf');
    }
  });

  // ── 12. Mixed \r\n and \n line endings ──────────────────────────────

  test('parses headers with mixed \\r\\n and \\n line endings', () => {
    const headers =
      'Content-Disposition: form-data; name="mix"; filename="f.txt"\r\n' +
      'Content-Type: text/csv\n' +
      'X-Extra: ignored';

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('mix');
      expect(result.filename).toBe('f.txt');
      expect(result.contentType).toBe('text/csv');
    }
  });

  // ── 13. Escaped quotes in filename (M1 fix) ────────────────────────

  test('handles escaped quotes in filename', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename="file\\"name.txt"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('file"name.txt');
    }
  });

  // ── 14. Escaped quotes in name ──────────────────────────────────────

  test('handles escaped quotes in name', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="field\\"1"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('field"1');
    }
  });

  // ── 15. Null bytes in filename (M3 fix) ─────────────────────────────

  test('strips null bytes from filename', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename="evil.php\0.jpg"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('evil.php.jpg');
    }
  });

  // ── 16. Null bytes in name ──────────────────────────────────────────

  test('strips null bytes from name', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="field\0name"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('fieldname');
    }
  });

  // ── 17. Empty name (M5 fix) ─────────────────────────────────────────

  test('returns MalformedHeader error when name is empty string', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name=""',
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  // ── 18. Non form-data directive (L4 fix) ────────────────────────────

  test('returns MalformedHeader error for attachment disposition', () => {
    const result = parsePartHeaders(
      'Content-Disposition: attachment; name="x"',
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  test('returns MalformedHeader error for inline disposition', () => {
    const result = parsePartHeaders(
      'Content-Disposition: inline; name="x"',
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  // ── 19. Header line without colon → silently skipped ────────────────

  test('skips header lines without colon and still parses if Content-Disposition is present', () => {
    const headers = [
      'this-line-has-no-colon',
      'Content-Disposition: form-data; name="valid"',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('valid');
    }
  });

  test('returns error when only non-colon lines are present', () => {
    const headers = [
      'no-colon-line-one',
      'no-colon-line-two',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  // ── 20. Empty lines between headers → skipped ──────────────────────

  test('skips empty lines between headers', () => {
    const headers = [
      'Content-Disposition: form-data; name="data"; filename="a.bin"',
      '',
      '',
      'Content-Type: application/octet-stream',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('data');
      expect(result.filename).toBe('a.bin');
      expect(result.contentType).toBe('application/octet-stream');
    }
  });

  // ── 21. Content-Type with charset ───────────────────────────────────

  test('preserves full Content-Type value including charset', () => {
    const headers = [
      'Content-Disposition: form-data; name="text"',
      'Content-Type: text/plain; charset=utf-8',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.contentType).toBe('text/plain; charset=utf-8');
    }
  });

  // ── 22. Name with special characters ────────────────────────────────

  test('handles name containing special characters like brackets', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="field[0]"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('field[0]');
    }
  });

  test('handles name containing dots and dashes', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="user.address.line-1"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('user.address.line-1');
    }
  });

  // ── 23. Filename with path characters ───────────────────────────────

  test('preserves filename with path separators as-is', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename="uploads/photo.jpg"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('uploads/photo.jpg');
    }
  });

  test('preserves filename with backslash path separators', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename="C:\\\\Users\\\\photo.jpg"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      // Backslashes after the escape-unescape pass: \\\\ → \\, so the value is C:\Users\photo.jpg
      expect(result.filename).toBe('C:\\Users\\photo.jpg');
    }
  });

  // ── 24. Duplicate Content-Disposition: first-wins (BUG-1 fix) ───────

  test('uses first Content-Disposition when duplicates are present', () => {
    const headers = [
      'Content-Disposition: form-data; name="first"',
      'Content-Disposition: form-data; name="second"; filename="evil.txt"',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('first');
      expect(result.filename).toBeUndefined();
    }
  });

  // ── 25. Duplicate Content-Type: first-wins (BUG-1 fix) ─────────────

  test('uses first Content-Type when duplicates are present', () => {
    const headers = [
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      'Content-Type: application/javascript',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.contentType).toBe('text/plain');
    }
  });

  // ── 26. form-data with no parameters at all ─────────────────────────

  test('returns MalformedHeader error when form-data has no parameters', () => {
    const result = parsePartHeaders('Content-Disposition: form-data');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
      expect(result.data.message).toContain('name');
    }
  });

  // ── 27. Name consisting entirely of null bytes → empty after strip ──

  test('returns MalformedHeader error when name is only null bytes', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="\0\0\0"',
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  // ── 28. Tab character between colon and value (RFC 7230 OWS) ────────

  test('handles tab character as OWS between colon and value', () => {
    const headers = [
      'Content-Disposition:\tform-data; name="tabbed"',
      'Content-Type:\t\ttext/html',
    ].join('\r\n');

    const result = parsePartHeaders(headers);
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('tabbed');
      expect(result.contentType).toBe('text/html');
    }
  });

  // ── 29. Uppercase parameter names (case-insensitive) ────────────────

  test('handles uppercase Name= parameter', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; Name="field1"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('field1');
    }
  });

  test('handles uppercase Filename= parameter', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="f"; Filename="UPPER.txt"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('UPPER.txt');
    }
  });

  // ── 30. Semicolons inside quoted filename ───────────────────────────

  test('preserves semicolons inside quoted filename', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename="report;2024;final.csv"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('report;2024;final.csv');
    }
  });

  // ── 31. Non-ASCII UTF-8 characters in filename ─────────────────────

  test('preserves non-ASCII UTF-8 characters in filename', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="file"; filename="resume_\uD55C\uAD6D\uC5B4.pdf"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('resume_\uD55C\uAD6D\uC5B4.pdf');
    }
  });

  // ── 32. filename*= is intentionally ignored (RFC 7578 §4.2) ────────

  test('ignores filename*= and uses filename= value', () => {
    const result = parsePartHeaders(
      "Content-Disposition: form-data; name=\"file\"; filename=\"safe.png\"; filename*=UTF-8''backdoor.php",
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.filename).toBe('safe.png');
    }
  });

  // ── 33. Duplicate name= parameters: first-wins via regex ───────────

  test('uses first name= parameter when duplicates are present', () => {
    const result = parsePartHeaders(
      'Content-Disposition: form-data; name="first"; name="second"',
    );
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.name).toBe('first');
    }
  });
});
