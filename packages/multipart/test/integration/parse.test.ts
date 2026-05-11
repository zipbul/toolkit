import { describe, test, expect } from 'bun:test';

import { Multipart } from '../../src/multipart';
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

async function partText(part: MultipartPart): Promise<string> {
  if (part.isFile) return part.text();
  return part.text();
}

async function partBytes(part: MultipartPart): Promise<Uint8Array> {
  if (part.isFile) return part.bytes();
  return part.bytes();
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

// ── Tests ───────────────────────────────────────────────────────────

describe('Multipart.parse — integration', () => {
  const mp = Multipart.create();

  test('parses a single text field from a Request', async () => {
    const boundary = 'xyzzy';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="greeting"', body: 'hello world' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('greeting');
    expect(await partText(parts[0]!)).toBe('hello world');
    expect(parts[0]!.isFile).toBe(false);
    expect(parts[0]!.contentType).toBe('text/plain');
  });

  test('parses a single file upload from a Request', async () => {
    const boundary = 'file-boundary';
    const fileContent = 'console.log("hello");';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="script"; filename="app.js"\r\nContent-Type: application/javascript',
        body: fileContent,
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('script');
    expect(parts[0]!.filename).toBe('app.js');
    expect(parts[0]!.isFile).toBe(true);
    expect(parts[0]!.contentType).toBe('application/javascript');
    expect(await partText(parts[0]!)).toBe(fileContent);
  });

  test('parses mixed fields and files (4+ parts)', async () => {
    const boundary = 'mixed-boundary';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="username"', body: 'alice' },
      { headers: 'Content-Disposition: form-data; name="email"', body: 'alice@example.com' },
      {
        headers:
          'Content-Disposition: form-data; name="photo"; filename="avatar.jpg"\r\nContent-Type: image/jpeg',
        body: 'JFIF_DATA_HERE',
      },
      { headers: 'Content-Disposition: form-data; name="bio"', body: 'Hello, I am Alice.' },
      {
        headers:
          'Content-Disposition: form-data; name="resume"; filename="cv.pdf"\r\nContent-Type: application/pdf',
        body: '%PDF-1.4 fake content',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(5);
    expect(parts[0]!.name).toBe('username');
    expect(await partText(parts[0]!)).toBe('alice');
    expect(parts[0]!.isFile).toBe(false);
    expect(parts[1]!.name).toBe('email');
    expect(await partText(parts[1]!)).toBe('alice@example.com');
    expect(parts[2]!.name).toBe('photo');
    expect(parts[2]!.isFile).toBe(true);
    expect(parts[2]!.filename).toBe('avatar.jpg');
    expect(parts[3]!.name).toBe('bio');
    expect(parts[3]!.isFile).toBe(false);
    expect(parts[4]!.name).toBe('resume');
    expect(parts[4]!.isFile).toBe(true);
  });

  test('handles binary content in file parts', async () => {
    const boundary = 'bin-boundary';
    const binaryBytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x80, 0x7f, 0x89, 0x50, 0x4e, 0x47]);
    const headerStr = 'Content-Disposition: form-data; name="bin"; filename="data.bin"\r\nContent-Type: application/octet-stream';
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(`--${boundary}\r\n${headerStr}\r\n\r\n`);
    const trailerBytes = encoder.encode(`\r\n--${boundary}--\r\n`);

    const fullBody = new Uint8Array(headerBytes.length + binaryBytes.length + trailerBytes.length);
    fullBody.set(headerBytes, 0);
    fullBody.set(binaryBytes, headerBytes.length);
    fullBody.set(trailerBytes, headerBytes.length + binaryBytes.length);

    const parts = await collectParts(mp.parse(createRequest(boundary, fullBody)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.isFile).toBe(true);

    const resultBytes = await partBytes(parts[0]!);

    expect(resultBytes.length).toBe(binaryBytes.length);

    for (let i = 0; i < binaryBytes.length; i++) {
      expect(resultBytes[i]).toBe(binaryBytes[i]);
    }
  });

  test('handles UTF-8 content (Korean, emoji, Chinese)', async () => {
    const boundary = 'utf8-boundary';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="korean"', body: '한국어 테스트' },
      { headers: 'Content-Disposition: form-data; name="emoji"', body: '🎉🚀💻🌍' },
      { headers: 'Content-Disposition: form-data; name="chinese"', body: '中文测试内容' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(3);
    expect(await partText(parts[0]!)).toBe('한국어 테스트');
    expect(await partText(parts[1]!)).toBe('🎉🚀💻🌍');
    expect(await partText(parts[2]!)).toBe('中文测试内容');
  });

  test('handles empty filename', async () => {
    const boundary = 'empty-fn';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="file"; filename=""\r\nContent-Type: application/octet-stream',
        body: '',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.filename).toBe('');
    expect(parts[0]!.isFile).toBe(true);
    expect((await partBytes(parts[0]!)).length).toBe(0);
  });

  test('handles multiple files with same field name', async () => {
    const boundary = 'multi-file';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain',
        body: 'file a content',
      },
      {
        headers:
          'Content-Disposition: form-data; name="files"; filename="b.txt"\r\nContent-Type: text/plain',
        body: 'file b content',
      },
      {
        headers:
          'Content-Disposition: form-data; name="files"; filename="c.txt"\r\nContent-Type: text/plain',
        body: 'file c content',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(3);
    expect(parts[0]!.filename).toBe('a.txt');
    expect(await partText(parts[0]!)).toBe('file a content');
    expect(parts[1]!.filename).toBe('b.txt');
    expect(await partText(parts[1]!)).toBe('file b content');
    expect(parts[2]!.filename).toBe('c.txt');
    expect(await partText(parts[2]!)).toBe('file c content');
  });

  test('empty body (just final boundary) yields 0 parts', async () => {
    const boundary = 'empty-form';
    const body = `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(0);
  });

  test('preamble text before first boundary is ignored', async () => {
    const boundary = 'preamble-test';
    const preamble = 'This is the preamble. It should be ignored.\r\nMore preamble lines.\r\n';
    const partsRaw = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="field"', body: 'value' },
    ]);
    const body = preamble + partsRaw;

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('field');
    expect(await partText(parts[0]!)).toBe('value');
  });

  test('instance reuse: parse two different requests sequentially', async () => {
    const boundary1 = 'first-req';
    const body1 = buildBody(boundary1, [
      { headers: 'Content-Disposition: form-data; name="a"', body: 'first' },
    ]);

    const boundary2 = 'second-req';
    const body2 = buildBody(boundary2, [
      { headers: 'Content-Disposition: form-data; name="b"', body: 'second' },
      { headers: 'Content-Disposition: form-data; name="c"', body: 'third' },
    ]);

    const parts1 = await collectParts(mp.parse(createRequest(boundary1, body1)));

    expect(parts1).toHaveLength(1);
    expect(await partText(parts1[0]!)).toBe('first');

    const parts2 = await collectParts(mp.parse(createRequest(boundary2, body2)));

    expect(parts2).toHaveLength(2);
    expect(await partText(parts2[0]!)).toBe('second');
    expect(await partText(parts2[1]!)).toBe('third');
  });

  test('early break after first part does not error or hang', async () => {
    const boundary = 'early-break';
    const body = buildBody(boundary, [
      { headers: 'Content-Disposition: form-data; name="first"', body: 'one' },
      { headers: 'Content-Disposition: form-data; name="second"', body: 'two' },
      { headers: 'Content-Disposition: form-data; name="third"', body: 'three' },
    ]);

    let firstPart: MultipartPart | undefined;

    for await (const part of mp.parse(createRequest(boundary, body))) {
      firstPart = part;
      break;
    }

    expect(firstPart).toBeDefined();
    expect(firstPart!.name).toBe('first');
    expect(await partText(firstPart!)).toBe('one');
  });

  test('bare \\n headers (instead of \\r\\n between header lines) still parse', async () => {
    const boundary = 'bare-lf';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="doc"; filename="readme.md"\n` +
      `Content-Type: text/markdown\r\n` +
      `\r\n` +
      `# Hello\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('doc');
    expect(parts[0]!.filename).toBe('readme.md');
    expect(parts[0]!.contentType).toBe('text/markdown');
    expect(await partText(parts[0]!)).toBe('# Hello');
  });

  test('field value containing CRLF line breaks', async () => {
    const boundary = 'crlf-val';
    const body = buildBody(boundary, [
      {
        headers: 'Content-Disposition: form-data; name="text"',
        body: 'line1\r\nline2\r\nline3\r\n',
      },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(await partText(parts[0]!)).toBe('line1\r\nline2\r\nline3\r\n');
  });

  test('very long field name (200 chars)', async () => {
    const boundary = 'long-name';
    const longName = 'x'.repeat(200);
    const body = buildBody(boundary, [
      { headers: `Content-Disposition: form-data; name="${longName}"`, body: 'val' },
    ]);

    const parts = await collectParts(mp.parse(createRequest(boundary, body)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe(longName);
    expect(parts[0]!.name.length).toBe(200);
    expect(await partText(parts[0]!)).toBe('val');
  });

  test('part with Content-Transfer-Encoding header is ignored, body preserved as-is', async () => {
    const boundary = 'cte-test';
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="encoded"; filename="data.txt"\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `\r\n` +
      `SGVsbG8gV29ybGQ=\r\n` +
      `--${boundary}--\r\n`;

    const parts = await collectParts(mp.parse(createRequest(boundary, raw)));

    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('encoded');
    expect(await partText(parts[0]!)).toBe('SGVsbG8gV29ybGQ=');
  });

  test('unconsumed file stream does not deadlock (auto-drain)', async () => {
    const boundary = 'auto-drain';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="skipped"; filename="skip.bin"\r\nContent-Type: application/octet-stream',
        body: 'x'.repeat(1024),
      },
      {
        headers: 'Content-Disposition: form-data; name="after"',
        body: 'still works',
      },
    ]);

    const result: string[] = [];

    for await (const part of mp.parse(createRequest(boundary, body))) {
      // Intentionally skip the file part — do NOT consume stream
      if (!part.isFile) {
        result.push(part.text());
      }
    }

    expect(result).toEqual(['still works']);
  });

  test('multiple unconsumed file streams do not deadlock', async () => {
    const boundary = 'multi-drain';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="f1"; filename="a.bin"\r\nContent-Type: application/octet-stream',
        body: 'aaa',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f2"; filename="b.bin"\r\nContent-Type: application/octet-stream',
        body: 'bbb',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f3"; filename="c.bin"\r\nContent-Type: application/octet-stream',
        body: 'ccc',
      },
      {
        headers: 'Content-Disposition: form-data; name="last"',
        body: 'done',
      },
    ]);

    const names: string[] = [];

    for await (const part of mp.parse(createRequest(boundary, body))) {
      names.push(part.name);
      // Do NOT consume any file streams
    }

    expect(names).toEqual(['f1', 'f2', 'f3', 'last']);
  });

  test('partially consumed file followed by unconsumed file', async () => {
    const boundary = 'mixed-consume';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="consumed"; filename="yes.txt"\r\nContent-Type: text/plain',
        body: 'consumed data',
      },
      {
        headers:
          'Content-Disposition: form-data; name="skipped"; filename="no.txt"\r\nContent-Type: text/plain',
        body: 'skipped data',
      },
      {
        headers: 'Content-Disposition: form-data; name="field"',
        body: 'value',
      },
    ]);

    const result: string[] = [];

    for await (const part of mp.parse(createRequest(boundary, body))) {
      if (part.name === 'consumed' && part.isFile) {
        result.push(await part.text());
      } else if (part.name === 'field' && !part.isFile) {
        result.push(part.text());
      }
      // 'skipped' file is intentionally not consumed
    }

    expect(result).toEqual(['consumed data', 'value']);
  });

  test('consumer breaking early does not hang (abandoned)', async () => {
    const boundary = 'abandon-test';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="f1"; filename="a.txt"\r\nContent-Type: text/plain',
        body: 'file-data-1',
      },
      {
        headers:
          'Content-Disposition: form-data; name="f2"; filename="b.txt"\r\nContent-Type: text/plain',
        body: 'file-data-2',
      },
      {
        headers: 'Content-Disposition: form-data; name="field"',
        body: 'value',
      },
    ]);

    const names: string[] = [];

    for await (const part of mp.parse(createRequest(boundary, body))) {
      names.push(part.name);

      if (part.isFile) {
        await part.bytes();
      }

      // Break after first part — abandon the rest
      break;
    }

    expect(names).toEqual(['f1']);
  });

  test('consumer breaking during file stream does not hang', async () => {
    const boundary = 'abandon-mid-file';
    const body = buildBody(boundary, [
      {
        headers:
          'Content-Disposition: form-data; name="big"; filename="big.bin"\r\nContent-Type: application/octet-stream',
        body: 'x'.repeat(1000),
      },
      {
        headers: 'Content-Disposition: form-data; name="after"',
        body: 'unreachable',
      },
    ]);

    let count = 0;

    for await (const part of mp.parse(createRequest(boundary, body))) {
      count++;
      // Don't consume the file, just break
      break;
    }

    expect(count).toBe(1);
  });
});
