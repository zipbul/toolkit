import { describe, test, expect } from 'bun:test';

import { Multipart } from '../../src/multipart';
import { MultipartError } from '../../src/interfaces';
import { MultipartErrorReason } from '../../src/enums';
import type { MultipartPart } from '../../src/interfaces';

// ── Helpers ─────────────────────────────────────────────────────────

function createRequest(boundary: string, body: string | Uint8Array): Request {
  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

function buildBody(boundary: string, parts: Array<{ headers: string; body: string }>): string {
  let raw = '';

  for (const part of parts) {
    raw += `--${boundary}\r\n${part.headers}\r\n\r\n${part.body}\r\n`;
  }

  raw += `--${boundary}--\r\n`;

  return raw;
}

function toChunkedRequest(boundary: string, body: string, chunkSize: number): Request {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.subarray(i, i + chunkSize));
      }

      controller.close();
    },
  });

  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: stream,
  });
}

async function consumeAll(gen: AsyncGenerator<MultipartPart>): Promise<void> {
  for await (const part of gen) {
    // Must consume file streams to avoid backpressure deadlock
    if (part.isFile) {
      await part.bytes();
    }
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Multipart — security limits', () => {
  const boundary = 'limit-boundary';

  test('enforces maxFiles limit', async () => {
    const mp = Multipart.create({ maxFiles: 2 });
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="f1"; filename="a.txt"\r\nContent-Type: text/plain',
        body: 'a',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f2"; filename="b.txt"\r\nContent-Type: text/plain',
        body: 'b',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f3"; filename="c.txt"\r\nContent-Type: text/plain',
        body: 'c',
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFiles);
    }
  });

  test('enforces maxFields limit', async () => {
    const mp = Multipart.create({ maxFields: 2 });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
      { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFields);
    }
  });

  test('enforces maxFileSize limit', async () => {
    const mp = Multipart.create({ maxFileSize: 10 });
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="big"; filename="big.bin"\r\nContent-Type: application/octet-stream',
        body: 'x'.repeat(100),
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
    }
  });

  test('enforces maxFieldSize limit', async () => {
    const mp = Multipart.create({ maxFieldSize: 5 });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="long"', body: 'x'.repeat(100) },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
    }
  });

  test('enforces maxTotalSize limit', async () => {
    const mp = Multipart.create({ maxTotalSize: 50 });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="a"', body: 'x'.repeat(100) },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.TotalSizeLimitExceeded);
    }
  });

  test('enforces maxHeaderSize limit', async () => {
    const mp = Multipart.create({ maxHeaderSize: 20 });
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="field-with-very-long-header-name-that-exceeds-limit"',
        body: 'value',
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.HeaderTooLarge);
    }
  });

  test('allows requests within all limits', async () => {
    const mp = Multipart.create({
      maxFiles: 2,
      maxFields: 2,
      maxFileSize: 1024,
      maxFieldSize: 1024,
    });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="name"', body: 'Alice' },
      { headers: 'Content-Disposition: form-data; name="age"', body: '25' },
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain',
        body: 'content',
      },
    ]);

    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(2);
    expect(files.size).toBe(1);
  });

  test('counts files and fields independently', async () => {
    const mp = Multipart.create({ maxFiles: 1, maxFields: 1 });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="field"', body: 'value' },
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="x.txt"\r\nContent-Type: text/plain',
        body: 'data',
      },
    ]);

    // Should not throw — 1 field + 1 file, both within limits
    const { fields, files } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.size).toBe(1);
    expect(files.size).toBe(1);
  });

  test('maxTotalSize null disables the limit', async () => {
    const mp = Multipart.create({ maxTotalSize: null, maxFieldSize: 200_000 });
    const largeValue = 'A'.repeat(100_000);
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="big"', body: largeValue },
    ]);

    const { fields } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.get('big')![0]!.length).toBe(100_000);
  });

  test('chunked limit enforcement: oversized file caught during streaming', async () => {
    const mp = Multipart.create({ maxFileSize: 50 });
    const fileContent = 'x'.repeat(200);
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream',
        body: fileContent,
      },
    ]);

    const request = toChunkedRequest(boundary, body, 10);

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
    }
  });

  test('chunked field limit: oversized field caught during streaming', async () => {
    const mp = Multipart.create({ maxFieldSize: 30 });
    const fieldContent = 'y'.repeat(200);
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="bigfield"', body: fieldContent },
    ]);

    const request = toChunkedRequest(boundary, body, 8);

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
    }
  });

  test('HeaderTooLarge during accumulation across small chunks', async () => {
    const mp = Multipart.create({ maxHeaderSize: 30 });
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="a-very-long-name-that-will-exceed-the-small-header-limit"',
        body: 'val',
      },
    ]);

    const request = toChunkedRequest(boundary, body, 5);

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.HeaderTooLarge);
    }
  });

  test('error messages contain actual sizes and limits', async () => {
    const mp = Multipart.create({ maxFileSize: 10 });
    const fileContent = 'z'.repeat(50);
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="doc"; filename="big.txt"\r\nContent-Type: text/plain',
        body: fileContent,
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);

      const err = e as MultipartError;

      expect(err.message).toContain('10');
      expect(err.message).toContain('big.txt');
    }
  });

  test('maxFileSize boundary: file exactly at limit is OK', async () => {
    const limit = 20;
    const mp = Multipart.create({ maxFileSize: limit });
    const exactContent = 'x'.repeat(limit);
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="exact.bin"\r\nContent-Type: application/octet-stream',
        body: exactContent,
      },
    ]);

    const { files } = await mp.parseAll(createRequest(boundary, body));

    expect((await files.get('file')![0]!.bytes()).length).toBe(limit);
  });

  test('maxFileSize boundary: file 1 byte over limit is rejected', async () => {
    const limit = 20;
    const mp = Multipart.create({ maxFileSize: limit });
    const overContent = 'x'.repeat(limit + 1);
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="over.bin"\r\nContent-Type: application/octet-stream',
        body: overContent,
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
    }
  });

  test('exactly at maxFiles limit is OK, one over is rejected', async () => {
    const mp = Multipart.create({ maxFiles: 3 });

    const okBody = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="f1"; filename="1.txt"\r\nContent-Type: text/plain',
        body: 'a',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f2"; filename="2.txt"\r\nContent-Type: text/plain',
        body: 'b',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f3"; filename="3.txt"\r\nContent-Type: text/plain',
        body: 'c',
      },
    ]);

    const { files } = await mp.parseAll(createRequest(boundary, okBody));

    expect(files.size).toBe(3);

    const overBody = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="f1"; filename="1.txt"\r\nContent-Type: text/plain',
        body: 'a',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f2"; filename="2.txt"\r\nContent-Type: text/plain',
        body: 'b',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f3"; filename="3.txt"\r\nContent-Type: text/plain',
        body: 'c',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f4"; filename="4.txt"\r\nContent-Type: text/plain',
        body: 'd',
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, overBody)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFiles);
    }
  });

  test('maxFieldSize exact boundary: field exactly at limit succeeds', async () => {
    const limit = 20;
    const mp = Multipart.create({ maxFieldSize: limit });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="field"', body: 'y'.repeat(limit) },
    ]);

    const { fields } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.get('field')).toEqual(['y'.repeat(limit)]);
  });

  test('maxFieldSize exact boundary: field 1 byte over limit fails', async () => {
    const limit = 20;
    const mp = Multipart.create({ maxFieldSize: limit });
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="field"', body: 'y'.repeat(limit + 1) },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
    }
  });

  test('maxFields exact boundary: exactly at limit succeeds, one over fails', async () => {
    const mp = Multipart.create({ maxFields: 3 });

    const okBody = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
      { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
    ]);

    const { fields } = await mp.parseAll(createRequest(boundary, okBody));

    expect(fields.size).toBe(3);

    const overBody = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
      { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
      { headers: 'Content-Disposition: form-data; name="d"', body: '4' },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, overBody)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFields);
    }
  });

  test('maxTotalSize fires before maxFileSize when both would be exceeded', async () => {
    const mp = Multipart.create({ maxTotalSize: 50, maxFileSize: 100 });
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream',
        body: 'x'.repeat(200),
      },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.TotalSizeLimitExceeded);
    }
  });
});
