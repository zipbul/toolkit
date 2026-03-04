import { describe, test, expect } from 'bun:test';

import { Multipart } from './multipart';
import { MultipartError } from './interfaces';
import type { MultipartPart } from './interfaces';
import { MultipartErrorReason } from './enums';
import { BufferedMultipartFile } from './parser/streaming-part';

// ── Helpers ─────────────────────────────────────────────────────────

function createMultipartRequest(
  boundary: string,
  parts: Array<{ headers: string; body: string }>,
): Request {
  let raw = '';

  for (const part of parts) {
    raw += `--${boundary}\r\n`;
    raw += part.headers;
    raw += '\r\n\r\n';
    raw += part.body;
    raw += '\r\n';
  }

  raw += `--${boundary}--\r\n`;

  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: raw,
  });
}

async function partText(part: MultipartPart): Promise<string> {
  if (part.isFile) return part.text();
  return part.text();
}

/**
 * Collects parts from parse(), consuming file streams immediately
 * to avoid TransformStream backpressure deadlock.
 */
async function collectParts(gen: AsyncGenerator<MultipartPart>): Promise<MultipartPart[]> {
  const parts: MultipartPart[] = [];

  for await (const part of gen) {
    if (part.isFile) {
      const data = await part.bytes();
      parts.push(new BufferedMultipartFile(part.name, part.filename, part.contentType, data));
    } else {
      parts.push(part);
    }
  }

  return parts;
}

// ── Multipart.create ────────────────────────────────────────────────

describe('Multipart.create', () => {
  test('creates instance with default options', () => {
    const mp = Multipart.create();
    expect(mp).toBeInstanceOf(Multipart);
  });

  test('creates instance with custom options', () => {
    const mp = Multipart.create({ maxFileSize: 1024 });
    expect(mp).toBeInstanceOf(Multipart);
  });

  test('creates instance with all custom options', () => {
    const mp = Multipart.create({
      maxFileSize: 1024,
      maxFiles: 2,
      maxFieldSize: 512,
      maxFields: 10,
      maxHeaderSize: 2048,
      maxTotalSize: 5000,
    });
    expect(mp).toBeInstanceOf(Multipart);
  });

  test('creates instance with maxTotalSize: null', () => {
    const mp = Multipart.create({ maxTotalSize: null });
    expect(mp).toBeInstanceOf(Multipart);
  });

  test('creates instance with maxParts', () => {
    const mp = Multipart.create({ maxParts: 5 });
    expect(mp).toBeInstanceOf(Multipart);
  });

  test('creates instance with allowedMimeTypes', () => {
    const mp = Multipart.create({ allowedMimeTypes: { avatar: ['image/png', 'image/jpeg'] } });
    expect(mp).toBeInstanceOf(Multipart);
  });

  test('throws MultipartError on invalid options (negative)', () => {
    expect(() => Multipart.create({ maxFileSize: -1 })).toThrow(MultipartError);
  });

  test('throws MultipartError on invalid options (zero)', () => {
    expect(() => Multipart.create({ maxFiles: 0 })).toThrow(MultipartError);
  });

  test('throws MultipartError on invalid options (float)', () => {
    expect(() => Multipart.create({ maxFieldSize: 1.5 })).toThrow(MultipartError);
  });

  test('throws MultipartError on invalid options (NaN)', () => {
    expect(() => Multipart.create({ maxHeaderSize: NaN })).toThrow(MultipartError);
  });

  test('thrown error has InvalidOptions reason', () => {
    try {
      Multipart.create({ maxFileSize: -1 });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.InvalidOptions);
    }
  });
});

// ── Multipart.parse ─────────────────────────────────────────────────

describe('Multipart.parse', () => {
  test('parses a single field', async () => {
    const mp = Multipart.create();
    const boundary = '----TestBoundary';
    const request = createMultipartRequest(boundary, [
      { headers: 'Content-Disposition: form-data; name="field1"', body: 'value1' },
    ]);

    const parts = await collectParts(mp.parse(request));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('field1');
    expect(await partText(parts[0]!)).toBe('value1');
  });

  test('parses multiple fields', async () => {
    const mp = Multipart.create();
    const boundary = 'multi-field';
    const request = createMultipartRequest(boundary, [
      { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
      { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
    ]);

    const parts = await collectParts(mp.parse(request));

    expect(parts).toHaveLength(3);
    expect(await partText(parts[0]!)).toBe('1');
    expect(await partText(parts[1]!)).toBe('2');
    expect(await partText(parts[2]!)).toBe('3');
  });

  test('parses file with filename and content-type', async () => {
    const mp = Multipart.create();
    const boundary = 'file-test';
    const request = createMultipartRequest(boundary, [
      {
        headers: 'Content-Disposition: form-data; name="doc"; filename="report.pdf"\r\nContent-Type: application/pdf',
        body: 'PDF_BYTES',
      },
    ]);

    const parts = await collectParts(mp.parse(request));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('doc');
    expect(parts[0]!.filename).toBe('report.pdf');
    expect(parts[0]!.isFile).toBe(true);
    expect(parts[0]!.contentType).toBe('application/pdf');
    expect(await partText(parts[0]!)).toBe('PDF_BYTES');
  });

  test('throws on missing Content-Type', async () => {
    const mp = Multipart.create();
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: 'data',
    });

    try {
      for await (const _ of mp.parse(request)) { /* consume */ }
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.InvalidContentType);
    }
  });

  test('throws on non-multipart Content-Type', async () => {
    const mp = Multipart.create();
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    try {
      for await (const _ of mp.parse(request)) { /* consume */ }
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.InvalidContentType);
    }
  });

  test('throws on null body', async () => {
    const mp = Multipart.create();
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=abc' },
    });

    try {
      for await (const _ of mp.parse(request)) { /* consume */ }
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MissingBody);
    }
  });

  test('throws on missing boundary', async () => {
    const mp = Multipart.create();
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'data',
    });

    try {
      for await (const _ of mp.parse(request)) { /* consume */ }
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MissingBoundary);
    }
  });
});

// ── Multipart.parseAll ──────────────────────────────────────────────

describe('Multipart.parseAll', () => {
  test('collects fields and files into Maps', async () => {
    const mp = Multipart.create();
    const boundary = '----TestBoundary';
    const request = createMultipartRequest(boundary, [
      { headers: 'Content-Disposition: form-data; name="name"', body: 'John' },
      { headers: 'Content-Disposition: form-data; name="age"', body: '30' },
      {
        headers: 'Content-Disposition: form-data; name="avatar"; filename="face.png"\r\nContent-Type: image/png',
        body: 'PNG_DATA',
      },
    ]);

    const { fields, files } = await mp.parseAll(request);
    expect(fields.size).toBe(2);
    expect(fields.get('name')).toEqual(['John']);
    expect(fields.get('age')).toEqual(['30']);
    expect(files.size).toBe(1);
    expect(files.get('avatar')![0]!.filename).toBe('face.png');
  });

  test('returns empty maps for empty form', async () => {
    const mp = Multipart.create();
    const boundary = 'empty';
    const body = `--${boundary}--\r\n`;
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    const { fields, files } = await mp.parseAll(request);
    expect(fields.size).toBe(0);
    expect(files.size).toBe(0);
  });

  test('collects duplicate field names into arrays', async () => {
    const mp = Multipart.create();
    const boundary = 'dup';
    const request = createMultipartRequest(boundary, [
      { headers: 'Content-Disposition: form-data; name="x"', body: 'first' },
      { headers: 'Content-Disposition: form-data; name="x"', body: 'second' },
      { headers: 'Content-Disposition: form-data; name="x"', body: 'third' },
    ]);

    const { fields } = await mp.parseAll(request);
    expect(fields.size).toBe(1);
    expect(fields.get('x')).toEqual(['first', 'second', 'third']);
  });

  test('collects multiple files with same name into arrays', async () => {
    const mp = Multipart.create();
    const boundary = 'dup-files';
    const request = createMultipartRequest(boundary, [
      {
        headers: 'Content-Disposition: form-data; name="docs"; filename="a.txt"\r\nContent-Type: text/plain',
        body: 'aaa',
      },
      {
        headers: 'Content-Disposition: form-data; name="docs"; filename="b.txt"\r\nContent-Type: text/plain',
        body: 'bbb',
      },
    ]);

    const { files } = await mp.parseAll(request);
    expect(files.size).toBe(1);
    const docs = files.get('docs')!;
    expect(docs).toHaveLength(2);
    expect(docs[0]!.filename).toBe('a.txt');
    expect(docs[1]!.filename).toBe('b.txt');
  });

  test('instance can be reused for multiple requests', async () => {
    const mp = Multipart.create();
    const boundary = 'reuse';

    for (let i = 0; i < 3; i++) {
      const request = createMultipartRequest(boundary, [
        { headers: `Content-Disposition: form-data; name="iter"`, body: String(i) },
      ]);

      const { fields } = await mp.parseAll(request);
      expect(fields.get('iter')).toEqual([String(i)]);
    }
  });
});

// ── MultipartError ──────────────────────────────────────────────────

describe('MultipartError', () => {
  test('is an instance of Error', () => {
    const e = new MultipartError({ reason: MultipartErrorReason.MissingBody, message: 'test' });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MultipartError);
  });

  test('has correct name', () => {
    const e = new MultipartError({ reason: MultipartErrorReason.MissingBody, message: 'test' });
    expect(e.name).toBe('MultipartError');
  });

  test('has reason and message', () => {
    const e = new MultipartError({ reason: MultipartErrorReason.FileTooLarge, message: 'too big' });
    expect(e.reason).toBe(MultipartErrorReason.FileTooLarge);
    expect(e.message).toBe('too big');
  });

  test('supports cause option', () => {
    const cause = new TypeError('original');
    const e = new MultipartError(
      { reason: MultipartErrorReason.UnexpectedEnd, message: 'wrapped' },
      { cause },
    );
    expect(e.cause).toBe(cause);
  });

  test('supports context option', () => {
    const e = new MultipartError(
      { reason: MultipartErrorReason.FileTooLarge, message: 'too big' },
      { context: { partIndex: 2, fieldName: 'avatar', bytesRead: 1024 } },
    );
    expect(e.context).toEqual({ partIndex: 2, fieldName: 'avatar', bytesRead: 1024 });
  });
});
