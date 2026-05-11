import { describe, test, expect } from 'bun:test';

import { Multipart } from '../../src/multipart';
import { MultipartError } from '../../src/interfaces';
import { MultipartErrorReason } from '../../src/enums';
import type { MultipartPart } from '../../src/interfaces';
import { BufferedMultipartFile } from '../../src/parser/streaming-part';

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

async function consumeAll(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const part of gen) {
    // For file parts, we need to consume the stream to avoid backpressure deadlock
    if (part && typeof part === 'object' && 'isFile' in part && (part as MultipartPart).isFile) {
      await ((part as MultipartPart) as import('../../src/interfaces').MultipartFile).bytes();
    }
  }
}

async function collectParts(gen: AsyncGenerator<MultipartPart>): Promise<MultipartPart[]> {
  const parts: MultipartPart[] = [];

  for await (const part of gen) {
    if (part.isFile) {
      // Consume stream immediately to avoid TransformStream backpressure deadlock
      const data = await part.bytes();
      parts.push(new BufferedMultipartFile(part.name, part.filename, part.contentType, data));
    } else {
      parts.push(part);
    }
  }

  return parts;
}

async function partText(part: MultipartPart): Promise<string> {
  if (part.isFile) return part.text();
  return part.text();
}

async function partBytes(part: MultipartPart): Promise<Uint8Array> {
  if (part.isFile) return part.bytes();
  return part.bytes();
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Multipart — edge cases', () => {
  const mp = Multipart.create();

  test('handles boundary with special characters (WebKit-style)', async () => {
    const boundary = '----WebKitFormBoundaryABC123xyz_-.';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="field"', body: 'ok' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('ok');
  });

  test('handles empty form (just final boundary)', async () => {
    const boundary = 'empty-form';
    const body = `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(0);
  });

  test('handles whitespace-only body value', async () => {
    const boundary = 'ws-boundary';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="space"', body: '   \n\t  ' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('   \n\t  ');
  });

  test('boundary-like string in body with CRLF prefix is a delimiter, without is not', async () => {
    const boundary = 'tricky';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="data"', body: 'some --tricky-- text' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('some --tricky-- text');
  });

  test('handles quoted boundary in Content-Type', async () => {
    const boundary = 'quoted-bound';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="f"', body: 'val' },
    ]);

    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary="${boundary}"` },
      body,
    });

    const parts = await collectParts(mp.parse(request));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('val');
  });

  test('throws MissingBody for null body', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=abc' },
    });

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MissingBody);
    }
  });

  test('throws InvalidContentType for wrong Content-Type', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.InvalidContentType);
    }
  });

  test('throws MissingBoundary when boundary param is absent', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'data',
    });

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MissingBoundary);
    }
  });

  test('handles very long field names (200 chars)', async () => {
    const boundary = 'long-name';
    const longName = 'a'.repeat(200);
    const body = buildBody(boundary, [
      { headers: `Content-Disposition: form-data; name="${longName}"`, body: 'val' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe(longName);
    expect(parts[0]!.name.length).toBe(200);
  });

  test('handles CRLF within field values', async () => {
    const boundary = 'crlf-val';
    const body = buildBody(boundary, [
      {
        headers: 'Content-Disposition: form-data; name="text"',
        body: 'line1\r\nline2\r\nline3',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('line1\r\nline2\r\nline3');
  });

  test('throws UnexpectedEnd on truncated stream', async () => {
    const boundary = 'truncated';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="a"\r\n\r\n` +
      `ok\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="b"\r\n\r\n` +
      `cut off`;

    try {
      await consumeAll(mp.parse(createRequest(boundary, raw)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
    }
  });

  test('escaped quotes in filename are unescaped', async () => {
    const boundary = 'esc-quote';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="doc"; filename="file\\"name.txt"\r\n` +
      `Content-Type: text/plain\r\n` +
      `\r\n` +
      `content\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.filename).toBe('file"name.txt');
  });

  test('null bytes in filename are stripped', async () => {
    const boundary = 'null-byte';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="upload"; filename="evil.php\0.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.filename).toBe('evil.php.jpg');
  });

  test('empty name in Content-Disposition throws MalformedHeader', async () => {
    const boundary = 'empty-name';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name=""\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    try {
      await consumeAll(mp.parse(createRequest(boundary, raw)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  test('non form-data directive throws MalformedHeader', async () => {
    const boundary = 'bad-directive';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: attachment; name="x"\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    try {
      await consumeAll(mp.parse(createRequest(boundary, raw)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
    }
  });

  test('path traversal filename is preserved as-is (not sanitized)', async () => {
    const boundary = 'path-traversal';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename="../../etc/passwd"\r\nContent-Type: application/octet-stream',
        body: 'root:x:0:0',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.filename).toBe('../../etc/passwd');
  });

  test('boundary at max length (70 chars) works', async () => {
    const boundary = 'B'.repeat(70);
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="f"', body: 'ok' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('ok');
  });

  test('boundary too long (71 chars) throws error', async () => {
    const boundary = 'B'.repeat(71);
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="f"', body: 'ok' },
    ]);

    try {
      await consumeAll(mp.parse(createRequest(boundary, body)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MissingBoundary);
      expect((e as MultipartError).message).toContain('71');
      expect((e as MultipartError).message).toContain('70');
    }
  });

  test('stream error is wrapped as MultipartError', async () => {
    const errorRequest = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=abc' },
      body: new ReadableStream({
        start(controller) {
          controller.error(new TypeError('network error'));
        },
      }),
    });

    try {
      await consumeAll(mp.parse(errorRequest));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).message).toContain('network error');
    }
  });

  test('AfterBoundary garbage bytes over 128 limit throws MalformedHeader', async () => {
    const boundary = 'garbage';
    const garbage = 'X'.repeat(129);
    const raw =
      `--${boundary}${garbage}\r\n` +
      `Content-Disposition: form-data; name="f"\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    try {
      await consumeAll(mp.parse(createRequest(boundary, raw)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.MalformedHeader);
      expect((e as MultipartError).message).toContain('128');
    }
  });

  test('body containing exact \\r\\n line is not confused with delimiter', async () => {
    const boundary = 'crlf-safe';
    const body = buildBody(boundary, [
      {
        headers: 'Content-Disposition: form-data; name="content"',
        body: 'before\r\nafter',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('before\r\nafter');
  });

  test('concurrent parse calls on same instance both succeed independently', async () => {
    const boundary1 = 'concurrent-a';
    const body1 = buildBody(boundary1, [
      { headers: 'Content-Disposition: form-data; name="x"', body: 'alpha' },
    ]);

    const boundary2 = 'concurrent-b';
    const body2 = buildBody(boundary2, [
      { headers: 'Content-Disposition: form-data; name="y"', body: 'beta' },
      { headers: 'Content-Disposition: form-data; name="z"', body: 'gamma' },
    ]);

    const [result1, result2] = await Promise.all([
      mp.parseAll(createRequest(boundary1, body1)),
      mp.parseAll(createRequest(boundary2, body2)),
    ]);

    expect(result1.fields.get('x')).toEqual(['alpha']);
    expect(result2.fields.get('y')).toEqual(['beta']);
    expect(result2.fields.get('z')).toEqual(['gamma']);
  });

  test('filename*= is intentionally ignored (RFC 7578 compliance)', async () => {
    const boundary = 'filename-star';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="safe.png"; filename*=UTF-8''backdoor.php\r\n` +
      `Content-Type: image/png\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.filename).toBe('safe.png');
  });

  test('duplicate name= parameter: first-wins via regex', async () => {
    const boundary = 'dup-name';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="first"; name="second"\r\n` +
      `\r\n` +
      `value\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('first');
  });

  test('duplicate Content-Disposition headers: first-wins', async () => {
    const boundary = 'dup-cd';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="first"; filename="one.txt"\r\n` +
      `Content-Disposition: form-data; name="second"; filename="two.txt"\r\n` +
      `Content-Type: text/plain\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('first');
    expect(parts[0]!.filename).toBe('one.txt');
  });

  test('duplicate Content-Type headers: first-wins', async () => {
    const boundary = 'dup-ct';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Type: application/javascript\r\n` +
      `\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.contentType).toBe('text/plain');
  });

  test('stream with data but no boundary throws UnexpectedEnd', async () => {
    const boundary = 'no-boundary-in-body';
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: 'this is not multipart data at all',
    });

    try {
      await consumeAll(mp.parse(request));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
      expect((e as MultipartError).message).toContain('no multipart boundary was found');
    }
  });

  test('empty field value is correctly stored in parseAll', async () => {
    const boundary = 'empty-val';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="empty_field"', body: '' },
      { headers: 'Content-Disposition: form-data; name="filled"', body: 'hello' },
    ]);

    const { fields } = await mp.parseAll(createRequest(boundary, body));

    expect(fields.get('empty_field')).toEqual(['']);
    expect(fields.get('filled')).toEqual(['hello']);
  });

  test('epilogue after final boundary is ignored', async () => {
    const boundary = 'epilogue-test';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="field"\r\n` +
      `\r\n` +
      `value\r\n` +
      `--${boundary}--\r\n` +
      `This is epilogue text\r\nMore epilogue`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('field');
    expect(await partText(parts[0]!)).toBe('value');
  });

  test('stream ending in AfterBoundary state throws UnexpectedEnd', async () => {
    const boundary = 'abrupt-end';
    const raw = `--${boundary}`;

    try {
      await consumeAll(mp.parse(createRequest(boundary, raw)));
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(MultipartError);
      expect((e as MultipartError).reason).toBe(MultipartErrorReason.UnexpectedEnd);
    }
  });
});
