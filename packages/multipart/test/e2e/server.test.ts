import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { MultipartErrorReason } from '../../src/enums';
import { MultipartError } from '../../src/interfaces';
import { Multipart } from '../../src/multipart';

// ── Server Setup ─────────────────────────────────────────────────────

const mp = Multipart.create({ maxFileSize: 1024 * 1024, maxFiles: 5, maxFields: 20 });

let server: Server;

function startServer(): Server {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      try {
        const { fields, files } = await mp.parseAll(request);

        const result: Record<string, unknown> = {};

        for (const [key, values] of fields) {
          result[key] = values.length === 1 ? values[0] : values;
        }

        const fileInfo: Record<
          string,
          { filename: string | undefined; size: number; contentType: string }
        > = {};

        for (const [key, parts] of files) {
          const last = parts[parts.length - 1]!;
          const data = await last.bytes();
          fileInfo[key] = {
            filename: last.filename,
            size: data.length,
            contentType: last.contentType,
          };
        }

        result._files = fileInfo;

        return Response.json(result);
      } catch (e) {
        if (e instanceof MultipartError) {
          return Response.json({ error: e.reason, message: e.message }, { status: 400 });
        }

        return Response.json({ error: 'unknown' }, { status: 500 });
      }
    },
  });
}

server = startServer();

afterAll(() => {
  server.stop(true);
});

function url(path = '/'): string {
  return `http://localhost:${server.port}${path}`;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('multipart e2e server', () => {
  test('fields-only form submission', async () => {
    const form = new FormData();
    form.append('username', 'alice');
    form.append('email', 'alice@example.com');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.username).toBe('alice');
    expect(json.email).toBe('alice@example.com');
    expect(json._files).toEqual({});
  });

  test('file upload via FormData', async () => {
    const form = new FormData();
    const content = 'Hello, world!';
    form.append('file', new Blob([content], { type: 'text/plain' }), 'hello.txt');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json._files.file.filename).toBe('hello.txt');
    expect(json._files.file.size).toBe(content.length);
    expect(json._files.file.contentType).toStartWith('text/plain');
  });

  test('multiple file uploads', async () => {
    const form = new FormData();
    form.append('doc', new Blob(['file-a'], { type: 'text/plain' }), 'a.txt');
    form.append('image', new Blob(['file-b'], { type: 'image/png' }), 'b.png');
    form.append('data', new Blob(['file-c'], { type: 'application/json' }), 'c.json');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json._files.doc.filename).toBe('a.txt');
    expect(json._files.image.filename).toBe('b.png');
    expect(json._files.data.filename).toBe('c.json');
    expect(json._files.doc.size).toBe(6);
    expect(json._files.image.size).toBe(6);
    expect(json._files.data.size).toBe(6);
  });

  test('invalid Content-Type returns 400 with InvalidContentType', async () => {
    const res = await fetch(url('/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();

    expect(json.error).toBe(MultipartErrorReason.InvalidContentType);
  });

  test('empty form returns 200 with empty files', async () => {
    const form = new FormData();

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json._files).toEqual({});
  });

  test('binary file upload (PNG header bytes)', async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('avatar', new Blob([pngHeader], { type: 'image/png' }), 'avatar.png');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json._files.avatar).toEqual({
      filename: 'avatar.png',
      size: 8,
      contentType: 'image/png',
    });
  });

  test('large file upload (100KB) succeeds', async () => {
    const size = 100 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const form = new FormData();
    form.append('bigfile', new Blob([data], { type: 'application/octet-stream' }), 'big.bin');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json._files.bigfile.size).toBe(size);
    expect(json._files.bigfile.filename).toBe('big.bin');
  });

  test('exceeding maxFiles limit returns 400 TooManyFiles', async () => {
    const form = new FormData();

    for (let i = 0; i < 6; i++) {
      form.append(`file${i}`, new Blob([`content-${i}`], { type: 'text/plain' }), `f${i}.txt`);
    }

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(400);

    const json = await res.json();

    expect(json.error).toBe(MultipartErrorReason.TooManyFiles);
  });

  test('exceeding maxFields limit returns 400 TooManyFields', async () => {
    const form = new FormData();

    for (let i = 0; i < 21; i++) {
      form.append(`field${i}`, `value${i}`);
    }

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(400);

    const json = await res.json();

    expect(json.error).toBe(MultipartErrorReason.TooManyFields);
  });

  test('UTF-8 form fields (Korean text)', async () => {
    const form = new FormData();
    form.append('name', '김철수');
    form.append('greeting', '안녕하세요, 세계!');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.name).toBe('김철수');
    expect(json.greeting).toBe('안녕하세요, 세계!');
  });

  test('multiple values for same field name returns array', async () => {
    const form = new FormData();
    form.append('tag', 'javascript');
    form.append('tag', 'typescript');
    form.append('tag', 'bun');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.tag).toEqual(['javascript', 'typescript', 'bun']);
  });

  test('concurrent requests all succeed', async () => {
    const requests = Array.from({ length: 5 }, (_, i) => {
      const form = new FormData();
      form.append('index', String(i));
      form.append('file', new Blob([`data-${i}`], { type: 'text/plain' }), `file-${i}.txt`);

      return fetch(url('/'), { method: 'POST', body: form });
    });

    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const bodies = await Promise.all(responses.map((r) => r.json()));
    const indices = bodies.map((b) => b.index).sort();

    expect(indices).toEqual(['0', '1', '2', '3', '4']);

    for (const body of bodies) {
      expect(body._files.file).toBeDefined();
    }
  });
});
