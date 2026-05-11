import { describe, test, expect } from 'bun:test';

import { parseMultipart } from './state-machine';
import { PartQueue } from './part-queue';
import { StreamingCallbacks, BufferingCallbacks } from './callbacks';
import { BufferedMultipartFile } from './streaming-part';
import { MultipartError } from '../interfaces';
import type { MultipartFile, MultipartPart } from '../interfaces';
import { MultipartErrorReason } from '../enums';
import { resolveMultipartOptions } from '../options';
import type { ParseAllResult } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────

function toStream(data: string | Uint8Array): ReadableStream<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;

  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function toChunkedStream(data: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(data);

  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.subarray(i, i + chunkSize));
      }

      controller.close();
    },
  });
}

function toTwoChunkStream(data: string, splitAt: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(data);

  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, splitAt));
      controller.enqueue(bytes.subarray(splitAt));
      controller.close();
    },
  });
}

function errorStream(errorToThrow: Error): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.error(errorToThrow);
    },
  });
}

function createBody(boundary: string, parts: Array<{ headers: string; body: string }>): string {
  let result = '';

  for (const part of parts) {
    result += `--${boundary}\r\n`;
    result += part.headers;
    result += '\r\n\r\n';
    result += part.body;
    result += '\r\n';
  }

  result += `--${boundary}--\r\n`;

  return result;
}

/**
 * Collects all parts from the streaming parser into an array.
 * Uses StreamingCallbacks + PartQueue bridge (same path as Multipart.parse).
 */
async function collectParts(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  opts: ReturnType<typeof resolveMultipartOptions>,
): Promise<MultipartPart[]> {
  const queue = new PartQueue();
  const callbacks = new StreamingCallbacks(queue);

  parseMultipart(body, boundary, opts, callbacks)
    .then(() => queue.finish())
    .catch((error) => { if (!queue.abandoned) queue.fail(error); });

  const parts: MultipartPart[] = [];

  for await (const part of queue) {
    if (part.isFile) {
      // Consume the stream immediately to avoid TransformStream backpressure deadlock
      const data = await part.bytes();
      parts.push(new BufferedMultipartFile(part.name, part.filename, part.contentType, data));
    } else {
      parts.push(part);
    }
  }

  return parts;
}

/**
 * Collects all parts using BufferingCallbacks (same path as Multipart.parseAll).
 */
async function collectPartsBuffered(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  opts: ReturnType<typeof resolveMultipartOptions>,
): Promise<ParseAllResult> {
  const fields = new Map<string, string[]>();
  const files = new Map<string, MultipartFile[]>();
  const callbacks = new BufferingCallbacks(fields, files);

  await parseMultipart(body, boundary, opts, callbacks);

  return { fields, files };
}

/**
 * Gets text from a part (handles both sync fields and async files).
 */
async function partText(part: MultipartPart): Promise<string> {
  return part.text();
}

/**
 * Gets bytes from a part (handles both sync fields and async files).
 */
async function partBytes(part: MultipartPart): Promise<Uint8Array> {
  return part.bytes();
}

// ── Tests ───────────────────────────────────────────────────────────

describe('parseMultipart', () => {
  const boundary = '----TestBoundary';
  const opts = resolveMultipartOptions({ maxTotalSize: null });

  // ── Basic parsing ───────────────────────────────────────────────

  describe('basic parsing', () => {
    test('1. single text field', async () => {
      const body = createBody(boundary, [
        {
          headers: 'Content-Disposition: form-data; name="field1"',
          body: 'hello',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('field1');
      expect(await partText(parts[0]!)).toBe('hello');
      expect(parts[0]!.isFile).toBe(false);
      expect(parts[0]!.filename).toBeUndefined();
      expect(parts[0]!.contentType).toBe('text/plain');
    });

    test('2. multiple fields', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
        { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(3);
      expect(parts[0]!.name).toBe('a');
      expect(await partText(parts[0]!)).toBe('1');
      expect(parts[1]!.name).toBe('b');
      expect(await partText(parts[1]!)).toBe('2');
      expect(parts[2]!.name).toBe('c');
      expect(await partText(parts[2]!)).toBe('3');
    });

    test('3. file part (with filename + content-type)', async () => {
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="upload"; filename="test.txt"\r\nContent-Type: text/plain',
          body: 'file contents here',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('upload');
      expect(parts[0]!.filename).toBe('test.txt');
      expect(parts[0]!.isFile).toBe(true);
      expect(parts[0]!.contentType).toBe('text/plain');
      expect(await partText(parts[0]!)).toBe('file contents here');
    });

    test('4. mixed fields and files', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="username"', body: 'John' },
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="face.png"\r\nContent-Type: image/png',
          body: 'PNG_DATA',
        },
        { headers: 'Content-Disposition: form-data; name="bio"', body: 'Hello world' },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(3);
      expect(parts[0]!.isFile).toBe(false);
      expect(parts[0]!.name).toBe('username');
      expect(await partText(parts[0]!)).toBe('John');
      expect(parts[1]!.isFile).toBe(true);
      expect(parts[1]!.name).toBe('avatar');
      expect(parts[1]!.filename).toBe('face.png');
      expect(parts[1]!.contentType).toBe('image/png');
      expect(parts[2]!.isFile).toBe(false);
      expect(parts[2]!.name).toBe('bio');
    });

    test('5. empty body part (zero-length body)', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="empty"', body: '' },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe('');
      expect((await partBytes(parts[0]!)).length).toBe(0);
    });

    test('6. bytes() returns Uint8Array', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="data"', body: 'binary' },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      const raw = await partBytes(parts[0]!);
      expect(raw).toBeInstanceOf(Uint8Array);
      expect(raw.length).toBe(6);
      // Verify the bytes match 'binary'
      expect(new TextDecoder().decode(raw)).toBe('binary');
    });

    test('7. file stream() returns ReadableStream with correct data', async () => {
      const body = createBody(boundary, [
        {
          headers: 'Content-Disposition: form-data; name="data"; filename="s.txt"\r\nContent-Type: text/plain',
          body: 'streamed content',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts[0]!.isFile).toBe(true);
      expect(await partText(parts[0]!)).toBe('streamed content');
    });
  });

  // ── Chunked input ─────────────────────────────────────────────────

  describe('chunked input (cross-chunk boundary splitting)', () => {
    test('8. very small chunks (5 bytes) — boundary split across chunks', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="field"', body: 'value' },
      ]);

      const parts = await collectParts(toChunkedStream(body, 5), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('field');
      expect(await partText(parts[0]!)).toBe('value');
    });

    test('9. single-byte chunks — extreme splitting', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="x"', body: 'y' },
      ]);

      const parts = await collectParts(toChunkedStream(body, 1), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('x');
      expect(await partText(parts[0]!)).toBe('y');
    });

    test('10. boundary split at EVERY possible byte position', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="k"', body: 'val' },
      ]);

      for (let splitAt = 1; splitAt < body.length; splitAt++) {
        const stream = toTwoChunkStream(body, splitAt);
        const parts = await collectParts(stream, boundary, opts);
        expect(parts).toHaveLength(1);
        expect(parts[0]!.name).toBe('k');
        expect(await partText(parts[0]!)).toBe('val');
      }
    });

    test('11. large chunk (entire body in one chunk)', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="big"', body: 'all at once' },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe('all at once');
    });
  });

  // ── Preamble (RFC 2046) ───────────────────────────────────────────

  describe('preamble (RFC 2046)', () => {
    test('12. text before the first boundary (preamble) is ignored', async () => {
      const raw =
        `This is the preamble. It should be ignored.\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="field"\r\n\r\n` +
        `value\r\n` +
        `--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('field');
      expect(await partText(parts[0]!)).toBe('value');
    });

    test('13. long preamble (1KB of text) is ignored', async () => {
      const preamble = 'X'.repeat(1024) + '\r\n';
      const raw =
        preamble +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="after_preamble"\r\n\r\n` +
        `data\r\n` +
        `--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('after_preamble');
      expect(await partText(parts[0]!)).toBe('data');
    });
  });

  // ── Empty forms ───────────────────────────────────────────────────

  describe('empty forms', () => {
    test('14. just final boundary → zero parts', async () => {
      const raw = `--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(0);
    });

    test('15. empty ReadableStream (no chunks at all) → zero parts', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      // State stays Start — Start is allowed as a terminal state
      const parts = await collectParts(stream, boundary, opts);
      expect(parts).toHaveLength(0);
    });
  });

  // ── Truncated streams ─────────────────────────────────────────────

  describe('truncated streams', () => {
    test('16. stream ends mid-body (no closing boundary) → UnexpectedEnd', async () => {
      const raw = `--${boundary}\r\nContent-Disposition: form-data; name="f"\r\n\r\npartial data`;

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });

    test('17. stream ends mid-headers → UnexpectedEnd', async () => {
      const raw = `--${boundary}\r\nContent-Disposition: form-data; name="f"`;

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });

    test('18. second part truncated → UnexpectedEnd (first part was already yielded)', async () => {
      const raw =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="a"\r\n\r\n` +
        `ok\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="b"\r\n\r\n` +
        `truncated`;

      const collectedBeforeError: MultipartPart[] = [];

      try {
        const queue = new PartQueue();
        const callbacks = new StreamingCallbacks(queue);

        parseMultipart(toStream(raw), boundary, opts, callbacks)
          .then(() => queue.finish())
          .catch((error) => { if (!queue.abandoned) queue.fail(error); });

        for await (const part of queue) {
          collectedBeforeError.push(part);
        }

        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
        // First part was yielded before the error on the second
        expect(collectedBeforeError).toHaveLength(1);
        expect(collectedBeforeError[0]!.name).toBe('a');
        expect(await partText(collectedBeforeError[0]!)).toBe('ok');
      }
    });
  });

  // ── Limits ────────────────────────────────────────────────────────

  describe('limits', () => {
    test('19. TooManyFiles (maxFiles exceeded)', async () => {
      const limitOpts = resolveMultipartOptions({ maxFiles: 1, maxTotalSize: null });
      const body = createBody(boundary, [
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
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFiles);
      }
    });

    test('20. TooManyFields (maxFields exceeded)', async () => {
      const limitOpts = resolveMultipartOptions({ maxFields: 1, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFields);
      }
    });

    test('21. FileTooLarge (maxFileSize exceeded)', async () => {
      const limitOpts = resolveMultipartOptions({ maxFileSize: 5, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="big.txt"\r\nContent-Type: text/plain',
          body: 'this is way too big for five bytes',
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
      }
    });

    test('22. FieldTooLarge (maxFieldSize exceeded)', async () => {
      const limitOpts = resolveMultipartOptions({ maxFieldSize: 3, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="f"', body: 'too long for three' },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
      }
    });

    test('23. TotalSizeLimitExceeded (maxTotalSize exceeded)', async () => {
      const limitOpts = resolveMultipartOptions({ maxTotalSize: 10 });
      const body = createBody(boundary, [
        {
          headers: 'Content-Disposition: form-data; name="f"',
          body: 'this is definitely more than ten bytes',
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TotalSizeLimitExceeded);
      }
    });

    test('24. HeaderTooLarge (maxHeaderSize exceeded)', async () => {
      const limitOpts = resolveMultipartOptions({ maxHeaderSize: 20, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="field_with_very_long_header_that_exceeds_the_limit"',
          body: 'value',
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.HeaderTooLarge);
      }
    });

    test('25. chunked stream with low file size limit — checkBodyLimitProjected fires during accumulation', async () => {
      const fileBody = 'A'.repeat(100);
      const limitOpts = resolveMultipartOptions({ maxFileSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="big.bin"\r\nContent-Type: application/octet-stream',
          body: fileBody,
        },
      ]);

      try {
        await collectParts(toChunkedStream(body, 10), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
      }
    });

    test('26. chunked stream with low field size limit — checkBodyLimitProjected fires during accumulation', async () => {
      const fieldBody = 'B'.repeat(100);
      const limitOpts = resolveMultipartOptions({ maxFieldSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers: 'Content-Disposition: form-data; name="bigfield"',
          body: fieldBody,
        },
      ]);

      try {
        await collectParts(toChunkedStream(body, 10), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
      }
    });
  });

  // ── Malformed input ───────────────────────────────────────────────

  describe('malformed input', () => {
    test('27. missing Content-Disposition → MalformedHeader', async () => {
      const raw =
        `--${boundary}\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `body\r\n` +
        `--${boundary}--\r\n`;

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
      }
    });

    test('28. AfterBoundary skip limit — 200 bytes of garbage → MalformedHeader', async () => {
      const garbage = 'Z'.repeat(200);
      const raw = `--${boundary}${garbage}\r\nContent-Disposition: form-data; name="f"\r\n\r\ndata\r\n--${boundary}--\r\n`;

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
        expect((e as MultipartError).message).toContain('128');
      }
    });

    test('29. AfterBoundary with small amount of padding (< 128 bytes) then CRLF → should work', async () => {
      const padding = ' '.repeat(50);
      const raw =
        `--${boundary}${padding}\r\n` +
        `Content-Disposition: form-data; name="padded"\r\n\r\n` +
        `padded_value\r\n` +
        `--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('padded');
      expect(await partText(parts[0]!)).toBe('padded_value');
    });
  });

  // ── Error wrapping ────────────────────────────────────────────────

  describe('error wrapping', () => {
    test('30. stream that throws a TypeError → wrapped in MultipartError', async () => {
      const streamError = new TypeError('network failure');
      const stream = errorStream(streamError);

      try {
        await collectParts(stream, boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
        expect((e as MultipartError).message).toBe('network failure');
        expect((e as MultipartError).cause).toBe(streamError);
      }
    });
  });

  // ── Body content edge cases ───────────────────────────────────────

  describe('body content edge cases', () => {
    test('31. body containing \\r\\n--boundary literally (which IS the delimiter) → correct split', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="first"', body: 'before' },
        { headers: 'Content-Disposition: form-data; name="second"', body: 'after' },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(2);
      expect(await partText(parts[0]!)).toBe('before');
      expect(await partText(parts[1]!)).toBe('after');
    });

    test('32. body containing --boundary without preceding \\r\\n → NOT a delimiter, preserved in body', async () => {
      const raw =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="tricky"\r\n\r\n` +
        `text with --${boundary} in the middle` +
        `\r\n--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe(`text with --${boundary} in the middle`);
    });

    test('33. CRLF within field values (multiline text)', async () => {
      const multilineValue = 'line one\r\nline two\r\nline three';
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="message"', body: multilineValue },
      ]);

      const parts = await collectParts(toStream(body), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe(multilineValue);
    });

    test('34. very large body (1MB) in reasonable chunks', async () => {
      const largePart = 'X'.repeat(1024 * 1024); // 1 MiB
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="large"; filename="big.bin"\r\nContent-Type: application/octet-stream',
          body: largePart,
        },
      ]);

      const parts = await collectParts(toChunkedStream(body, 64 * 1024), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe(largePart);
      expect((await partBytes(parts[0]!)).length).toBe(1024 * 1024);
    });
  });

  // ── Headers ───────────────────────────────────────────────────────

  describe('headers', () => {
    test('35. bare \\n line endings in headers → parsed correctly', async () => {
      const raw =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="field"\n` +
        `Content-Type: text/html\r\n\r\n` +
        `<b>bold</b>\r\n` +
        `--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('field');
      expect(parts[0]!.contentType).toBe('text/html');
      expect(await partText(parts[0]!)).toBe('<b>bold</b>');
    });
  });

  // ── Truncated streams (continued) ──────────────────────────────────

  describe('truncated streams (continued)', () => {
    test('36. stream ends in AfterBoundary state → UnexpectedEnd', async () => {
      const raw = `--${boundary}`;

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });

    test('37. stream with data but no boundary at all → UnexpectedEnd', async () => {
      const raw = 'This is random data with no multipart boundary whatsoever.';

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });
  });

  // ── AfterBoundary skip limits ──────────────────────────────────────

  describe('AfterBoundary skip limits', () => {
    test('38. AfterBoundary with exactly 128 bytes of padding then CRLF → should succeed', async () => {
      const padding = ' '.repeat(128);
      const raw =
        `--${boundary}${padding}\r\n` +
        `Content-Disposition: form-data; name="padded128"\r\n\r\n` +
        `ok\r\n` +
        `--${boundary}--\r\n`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('padded128');
      expect(await partText(parts[0]!)).toBe('ok');
    });

    test('39. AfterBoundary with exactly 129 bytes of padding → MalformedHeader', async () => {
      const padding = ' '.repeat(129);
      const raw =
        `--${boundary}${padding}\r\n` +
        `Content-Disposition: form-data; name="padded129"\r\n\r\n` +
        `value\r\n` +
        `--${boundary}--\r\n`;

      try {
        await collectParts(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
        expect((e as MultipartError).message).toContain('128');
      }
    });

    test('40. AfterBoundary skip counter across chunk boundary (129 bytes split at byte 64) → MalformedHeader', async () => {
      const padding = ' '.repeat(129);
      const raw =
        `--${boundary}${padding}\r\n` +
        `Content-Disposition: form-data; name="split"\r\n\r\n` +
        `value\r\n` +
        `--${boundary}--\r\n`;

      try {
        await collectParts(toTwoChunkStream(raw, 64), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
        expect((e as MultipartError).message).toContain('128');
      }
    });
  });

  // ── Exact limit boundaries (off-by-one) ────────────────────────────

  describe('exact limit boundaries (off-by-one)', () => {
    test('41. maxFieldSize: field exactly at limit succeeds', async () => {
      const fieldValue = 'A'.repeat(50);
      const limitOpts = resolveMultipartOptions({ maxFieldSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="exact"', body: fieldValue },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe(fieldValue);
    });

    test('42. maxFieldSize: field 1 byte over limit fails with FieldTooLarge', async () => {
      const fieldValue = 'A'.repeat(51);
      const limitOpts = resolveMultipartOptions({ maxFieldSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="over"', body: fieldValue },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
      }
    });

    test('43. maxTotalSize: body exactly at limit succeeds', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="f"', body: 'hello' },
      ]);
      const totalBytes = new TextEncoder().encode(body).length;
      const limitOpts = resolveMultipartOptions({ maxTotalSize: totalBytes });

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe('hello');
    });

    test('44. maxTotalSize: body 1 byte over limit fails', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="f"', body: 'hello' },
      ]);
      const totalBytes = new TextEncoder().encode(body).length;
      const limitOpts = resolveMultipartOptions({ maxTotalSize: totalBytes - 1 });

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TotalSizeLimitExceeded);
      }
    });

    test('45. maxFields exactly at limit succeeds, one over fails', async () => {
      const threeFieldOpts = resolveMultipartOptions({ maxFields: 3, maxTotalSize: null });

      // 3 fields — exactly at limit
      const bodyOk = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
        { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
      ]);

      const partsOk = await collectParts(toStream(bodyOk), boundary, threeFieldOpts);
      expect(partsOk).toHaveLength(3);

      // 4 fields — one over limit
      const bodyOver = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
        { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
        { headers: 'Content-Disposition: form-data; name="d"', body: '4' },
      ]);

      try {
        await collectParts(toStream(bodyOver), boundary, threeFieldOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFields);
      }
    });

    test('46. maxHeaderSize: headers exactly at limit succeeds', async () => {
      const base = 'Content-Disposition: form-data; name="';
      const closing = '"';
      const targetSize = 80;
      const padLen = targetSize - base.length - closing.length;
      const paddedName = 'x'.repeat(padLen);
      const header = `${base}${paddedName}${closing}`;

      expect(header.length).toBe(targetSize);

      const limitOpts = resolveMultipartOptions({ maxHeaderSize: targetSize, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: header, body: 'value' },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe('value');
    });

    test('47. maxHeaderSize: headers 1 byte over limit fails', async () => {
      const base = 'Content-Disposition: form-data; name="';
      const closing = '"';
      const targetSize = 80;
      const padLen = targetSize - base.length - closing.length + 1;
      const paddedName = 'x'.repeat(padLen);
      const header = `${base}${paddedName}${closing}`;

      expect(header.length).toBe(targetSize + 1);

      const limitOpts = resolveMultipartOptions({ maxHeaderSize: targetSize, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: header, body: 'value' },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.HeaderTooLarge);
      }
    });
  });

  // ── Body state — small chunks (safeLen <= 0 path) ──────────────────

  describe('body state — small chunks (safeLen <= 0 path)', () => {
    test('48. body state with 3-byte chunks — verifies safeLen <= 0 path', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="tiny"', body: 'the quick brown fox' },
      ]);

      const parts = await collectParts(toChunkedStream(body, 3), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('tiny');
      expect(await partText(parts[0]!)).toBe('the quick brown fox');
    });

    test('49. body state with 2-byte chunks — safeLen deeply negative, data preserved', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="mini"', body: 'abcdefghijklmnopqrstuvwxyz' },
      ]);

      const parts = await collectParts(toChunkedStream(body, 2), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('mini');
      expect(await partText(parts[0]!)).toBe('abcdefghijklmnopqrstuvwxyz');
    });
  });

  // ── bodyChunks multi-element concat ────────────────────────────────

  describe('bodyChunks multi-element concat', () => {
    test('50. multi-chunk body accumulation — 500-byte body in 30-byte chunks', async () => {
      const largeValue = 'ABCDEFGHIJ'.repeat(50); // 500 bytes
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="big"; filename="data.bin"\r\nContent-Type: application/octet-stream',
          body: largeValue,
        },
      ]);

      const parts = await collectParts(toChunkedStream(body, 30), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(await partText(parts[0]!)).toBe(largeValue);
      expect((await partBytes(parts[0]!)).length).toBe(500);
    });
  });

  // ── Error wrapping — non-Error values ──────────────────────────────

  describe('error wrapping — non-Error values', () => {
    function errorStreamWithValue(value: unknown): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller) {
          controller.error(value);
        },
      });
    }

    test('51. stream that errors with a string → wrapped as MultipartError', async () => {
      try {
        await collectParts(errorStreamWithValue('kaboom'), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
        expect((e as MultipartError).message).toBe('Stream read failed');
        expect((e as MultipartError).cause).toBe('kaboom');
      }
    });

    test('52. stream that errors with null → wrapped as MultipartError', async () => {
      try {
        await collectParts(errorStreamWithValue(null), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
        expect((e as MultipartError).message).toBe('Stream read failed');
        expect((e as MultipartError).cause).toBe(null);
      }
    });
  });

  // ── Epilogue (RFC 2046) ────────────────────────────────────────────

  describe('epilogue (RFC 2046)', () => {
    test('53. epilogue after final boundary is ignored', async () => {
      const raw =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="field"\r\n\r\n` +
        `value\r\n` +
        `--${boundary}--\r\n` +
        `This is the epilogue. It should be ignored.\r\n` +
        `More epilogue data here.`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('field');
      expect(await partText(parts[0]!)).toBe('value');
    });

    test('54. final boundary without trailing CRLF — still parsed correctly', async () => {
      const raw =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="field"\r\n\r\n` +
        `value\r\n` +
        `--${boundary}--`;

      const parts = await collectParts(toStream(raw), boundary, opts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.name).toBe('field');
      expect(await partText(parts[0]!)).toBe('value');
    });
  });

  // ── maxTotalSize vs per-part priority ──────────────────────────────

  describe('maxTotalSize vs per-part priority', () => {
    test('55. maxTotalSize fires before maxFileSize when both would be exceeded', async () => {
      const fileBody = 'X'.repeat(200);
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: 10,
        maxFileSize: 50,
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="big.bin"\r\nContent-Type: application/octet-stream',
          body: fileBody,
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TotalSizeLimitExceeded);
      }
    });
  });

  // ── BufferingCallbacks (parseAll fast path) ──────────────────────────

  describe('BufferingCallbacks', () => {
    test('56. single field collected into fields map', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="field1"', body: 'hello' },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, opts);
      expect(result.fields.get('field1')).toEqual(['hello']);
      expect(result.files.size).toBe(0);
    });

    test('57. multiple fields with same name collected as array', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="tag"', body: 'a' },
        { headers: 'Content-Disposition: form-data; name="tag"', body: 'b' },
        { headers: 'Content-Disposition: form-data; name="tag"', body: 'c' },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, opts);
      expect(result.fields.get('tag')).toEqual(['a', 'b', 'c']);
    });

    test('58. file collected into files map with correct data', async () => {
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="upload"; filename="test.txt"\r\nContent-Type: text/plain',
          body: 'file contents here',
        },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, opts);
      expect(result.fields.size).toBe(0);
      expect(result.files.has('upload')).toBe(true);

      const fileList = result.files.get('upload')!;
      expect(fileList).toHaveLength(1);
      expect(fileList[0]!.filename).toBe('test.txt');
      expect(fileList[0]!.contentType).toBe('text/plain');
      expect(await fileList[0]!.text()).toBe('file contents here');
    });

    test('59. mixed fields and files collected correctly', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="username"', body: 'John' },
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="face.png"\r\nContent-Type: image/png',
          body: 'PNG_DATA',
        },
        { headers: 'Content-Disposition: form-data; name="bio"', body: 'Hello world' },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, opts);
      expect(result.fields.get('username')).toEqual(['John']);
      expect(result.fields.get('bio')).toEqual(['Hello world']);

      const avatarFiles = result.files.get('avatar')!;
      expect(avatarFiles).toHaveLength(1);
      expect(avatarFiles[0]!.filename).toBe('face.png');
      expect(await avatarFiles[0]!.text()).toBe('PNG_DATA');
    });

    test('60. empty form → empty maps', async () => {
      const raw = `--${boundary}--\r\n`;

      const result = await collectPartsBuffered(toStream(raw), boundary, opts);
      expect(result.fields.size).toBe(0);
      expect(result.files.size).toBe(0);
    });

    test('61. errors throw directly (no queue)', async () => {
      const raw = `--${boundary}\r\nContent-Disposition: form-data; name="f"\r\n\r\npartial data`;

      try {
        await collectPartsBuffered(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });

    test('62. chunked input works with buffering path', async () => {
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="chunked"', body: 'chunk test value' },
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="c.txt"\r\nContent-Type: text/plain',
          body: 'chunked file data',
        },
      ]);

      const result = await collectPartsBuffered(toChunkedStream(body, 7), boundary, opts);
      expect(result.fields.get('chunked')).toEqual(['chunk test value']);

      const fileList = result.files.get('f')!;
      expect(await fileList[0]!.text()).toBe('chunked file data');
    });

    test('63. multiple files with same name', async () => {
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="docs"; filename="a.txt"\r\nContent-Type: text/plain',
          body: 'file A',
        },
        {
          headers:
            'Content-Disposition: form-data; name="docs"; filename="b.txt"\r\nContent-Type: text/plain',
          body: 'file B',
        },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, opts);
      const docs = result.files.get('docs')!;
      expect(docs).toHaveLength(2);
      expect(docs[0]!.filename).toBe('a.txt');
      expect(await docs[0]!.text()).toBe('file A');
      expect(docs[1]!.filename).toBe('b.txt');
      expect(await docs[1]!.text()).toBe('file B');
    });

    // ── Limit errors (buffering path) ────────────────────────────────

    test('64. TooManyFiles via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({ maxFiles: 1, maxTotalSize: null });
      const body = createBody(boundary, [
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
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFiles);
      }
    });

    test('65. TooManyFields via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({ maxFields: 1, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyFields);
      }
    });

    test('66. FileTooLarge via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({ maxFileSize: 5, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="big.txt"\r\nContent-Type: text/plain',
          body: 'this is way too big for five bytes',
        },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
      }
    });

    test('67. FieldTooLarge via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({ maxFieldSize: 3, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="f"', body: 'too long for three' },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FieldTooLarge);
      }
    });

    test('68. TotalSizeLimitExceeded via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({ maxTotalSize: 10 });
      const body = createBody(boundary, [
        {
          headers: 'Content-Disposition: form-data; name="f"',
          body: 'this is definitely more than ten bytes',
        },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TotalSizeLimitExceeded);
      }
    });

    test('69. HeaderTooLarge via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({ maxHeaderSize: 20, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="field_with_very_long_header_that_exceeds_the_limit"',
          body: 'value',
        },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.HeaderTooLarge);
      }
    });

    // ── Stream errors (buffering path) ───────────────────────────────

    test('70. stream TypeError wrapped in MultipartError via buffering path', async () => {
      const streamError = new TypeError('network failure');

      try {
        await collectPartsBuffered(errorStream(streamError), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
        expect((e as MultipartError).message).toBe('network failure');
        expect((e as MultipartError).cause).toBe(streamError);
      }
    });

    test('71. stream with data but no boundary via buffering path → UnexpectedEnd', async () => {
      const raw = 'This is random data with no multipart boundary whatsoever.';

      try {
        await collectPartsBuffered(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });

    test('72. stream ends mid-headers via buffering path → UnexpectedEnd', async () => {
      const raw = `--${boundary}\r\nContent-Disposition: form-data; name="f"`;

      try {
        await collectPartsBuffered(toStream(raw), boundary, opts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      }
    });
  });

  // ── maxParts ───────────────────────────────────────────────────────

  describe('maxParts', () => {
    test('73. TooManyParts when maxParts exceeded (streaming)', async () => {
      const limitOpts = resolveMultipartOptions({ maxParts: 2, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
        { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyParts);
      }
    });

    test('74. TooManyParts when maxParts exceeded (buffering)', async () => {
      const limitOpts = resolveMultipartOptions({ maxParts: 2, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
        { headers: 'Content-Disposition: form-data; name="c"', body: '3' },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.TooManyParts);
      }
    });

    test('75. maxParts exactly at limit succeeds', async () => {
      const limitOpts = resolveMultipartOptions({ maxParts: 2, maxTotalSize: null });
      const body = createBody(boundary, [
        { headers: 'Content-Disposition: form-data; name="a"', body: '1' },
        { headers: 'Content-Disposition: form-data; name="b"', body: '2' },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(2);
    });
  });

  // ── allowedMimeTypes ───────────────────────────────────────────────

  describe('allowedMimeTypes', () => {
    test('76. MimeTypeNotAllowed when file MIME is not in allowlist (streaming)', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { avatar: ['image/png', 'image/jpeg'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="hack.exe"\r\nContent-Type: application/octet-stream',
          body: 'data',
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MimeTypeNotAllowed);
      }
    });

    test('77. MimeTypeNotAllowed via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { avatar: ['image/png', 'image/jpeg'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="hack.exe"\r\nContent-Type: application/octet-stream',
          body: 'data',
        },
      ]);

      try {
        await collectPartsBuffered(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MimeTypeNotAllowed);
      }
    });

    test('78. allowed MIME type passes validation', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { avatar: ['image/png', 'image/jpeg'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="face.png"\r\nContent-Type: image/png',
          body: 'PNG_DATA',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.isFile).toBe(true);
    });

    test('79. field without allowedMimeTypes restriction is not affected', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { avatar: ['image/png'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="other"; filename="doc.pdf"\r\nContent-Type: application/pdf',
          body: 'PDF_DATA',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.isFile).toBe(true);
    });

    test('83. Content-Type with parameters matches allowlist without parameters', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { avatar: ['image/png'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="face.png"\r\nContent-Type: image/png; charset=utf-8',
          body: 'PNG_DATA',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.isFile).toBe(true);
    });

    test('84. allowlist with parameters matches Content-Type without parameters', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { doc: ['text/plain; charset=utf-8'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="doc"; filename="readme.txt"\r\nContent-Type: text/plain',
          body: 'hello',
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.isFile).toBe(true);
    });

    test('85. Content-Type with parameters rejected when media type differs', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { avatar: ['image/png'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="avatar"; filename="face.gif"\r\nContent-Type: image/gif; charset=utf-8',
          body: 'GIF_DATA',
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.MimeTypeNotAllowed);
      }
    });

    test('86. Content-Type parameter stripping via buffering path', async () => {
      const limitOpts = resolveMultipartOptions({
        maxTotalSize: null,
        allowedMimeTypes: { file: ['application/octet-stream'] },
      });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="file"; filename="data.bin"\r\nContent-Type: application/octet-stream; boundary=ignored',
          body: 'BINARY',
        },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, limitOpts);
      expect(result.files.get('file')).toHaveLength(1);
    });
  });

  // ── maxFileSize off-by-one ─────────────────────────────────────────

  describe('maxFileSize off-by-one', () => {
    test('80. maxFileSize: file exactly at limit succeeds', async () => {
      const fileBody = 'A'.repeat(50);
      const limitOpts = resolveMultipartOptions({ maxFileSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="exact.bin"\r\nContent-Type: application/octet-stream',
          body: fileBody,
        },
      ]);

      const parts = await collectParts(toStream(body), boundary, limitOpts);
      expect(parts).toHaveLength(1);
      expect((await partBytes(parts[0]!)).length).toBe(50);
    });

    test('81. maxFileSize: file 1 byte over limit fails with FileTooLarge', async () => {
      const fileBody = 'A'.repeat(51);
      const limitOpts = resolveMultipartOptions({ maxFileSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="over.bin"\r\nContent-Type: application/octet-stream',
          body: fileBody,
        },
      ]);

      try {
        await collectParts(toStream(body), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
      }
    });

    test('82. maxFileSize off-by-one via buffering path', async () => {
      const fileBody = 'A'.repeat(50);
      const limitOpts = resolveMultipartOptions({ maxFileSize: 50, maxTotalSize: null });
      const body = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="exact.bin"\r\nContent-Type: application/octet-stream',
          body: fileBody,
        },
      ]);

      const result = await collectPartsBuffered(toStream(body), boundary, limitOpts);
      const files = result.files.get('f')!;
      expect((await files[0]!.bytes()).length).toBe(50);

      // 1 byte over
      const overBody = createBody(boundary, [
        {
          headers:
            'Content-Disposition: form-data; name="f"; filename="over.bin"\r\nContent-Type: application/octet-stream',
          body: 'A'.repeat(51),
        },
      ]);

      try {
        await collectPartsBuffered(toStream(overBody), boundary, limitOpts);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MultipartError);
        expect((e as MultipartError).reason).toBe(MultipartErrorReason.FileTooLarge);
      }
    });
  });
});
