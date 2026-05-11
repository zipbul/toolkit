import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { MultipartError } from '../../src/interfaces';
import { Multipart } from '../../src/multipart';

// ── Server Setup ─────────────────────────────────────────────────────

const mp = Multipart.create({ maxFileSize: 10 * 1024 * 1024 });

let server: Server;

function startServer(): Server {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      try {
        const parts: Array<{
          name: string;
          filename?: string;
          size: number;
          contentType: string;
        }> = [];

        for await (const part of mp.parse(request)) {
          if (part.isFile) {
            const data = await part.bytes();
            parts.push({
              name: part.name,
              filename: part.filename,
              size: data.length,
              contentType: part.contentType,
            });
          } else {
            parts.push({
              name: part.name,
              filename: undefined,
              size: part.bytes().length,
              contentType: part.contentType,
            });
          }
        }

        return Response.json({ parts, count: parts.length });
      } catch (e) {
        if (e instanceof MultipartError) {
          return Response.json({ error: e.reason }, { status: 400 });
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

describe('multipart e2e streaming', () => {
  test('stream-parse a 1MB file', async () => {
    const size = 1024 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const form = new FormData();
    form.append('bigfile', new Blob([data], { type: 'application/octet-stream' }), 'oneMB.bin');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.count).toBe(1);
    expect(json.parts[0].name).toBe('bigfile');
    expect(json.parts[0].filename).toBe('oneMB.bin');
    expect(json.parts[0].size).toBe(size);
    expect(json.parts[0].contentType).toBe('application/octet-stream');
  });

  test('stream-parse multiple files (3 files)', async () => {
    const form = new FormData();
    form.append('alpha', new Blob(['aaa'], { type: 'text/plain' }), 'alpha.txt');
    form.append('beta', new Blob(['bbbb'], { type: 'text/plain' }), 'beta.txt');
    form.append('gamma', new Blob(['ccccc'], { type: 'image/png' }), 'gamma.png');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.count).toBe(3);

    expect(json.parts[0].name).toBe('alpha');
    expect(json.parts[0].filename).toBe('alpha.txt');
    expect(json.parts[0].size).toBe(3);
    expect(json.parts[0].contentType).toStartWith('text/plain');

    expect(json.parts[1].name).toBe('beta');
    expect(json.parts[1].filename).toBe('beta.txt');
    expect(json.parts[1].size).toBe(4);
    expect(json.parts[1].contentType).toStartWith('text/plain');

    expect(json.parts[2]).toEqual({
      name: 'gamma',
      filename: 'gamma.png',
      size: 5,
      contentType: 'image/png',
    });
  });

  test('stream-parse mixed fields and files', async () => {
    const form = new FormData();
    form.append('username', 'bob');
    form.append('avatar', new Blob(['img-data'], { type: 'image/jpeg' }), 'avatar.jpg');
    form.append('bio', 'Hello there');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.count).toBe(3);

    const fieldParts = json.parts.filter(
      (p: { filename?: string }) => p.filename === undefined || p.filename === null,
    );
    const fileParts = json.parts.filter(
      (p: { filename?: string }) => p.filename !== undefined && p.filename !== null,
    );

    expect(fieldParts.length).toBe(2);
    expect(fileParts.length).toBe(1);

    expect(fileParts[0].name).toBe('avatar');
    expect(fileParts[0].filename).toBe('avatar.jpg');
    expect(fileParts[0].size).toBe(8);
  });

  test('handles aborted request gracefully', async () => {
    const controller = new AbortController();
    const form = new FormData();
    form.append(
      'file',
      new Blob(['x'.repeat(1024 * 100)], { type: 'text/plain' }),
      'big.txt',
    );

    try {
      const promise = fetch(url('/'), {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 1);

      await promise;
    } catch {
      // AbortError expected on client side
    }

    // Verify server is still operational after the aborted request
    const healthForm = new FormData();
    healthForm.append('ping', 'pong');

    const res = await fetch(url('/'), { method: 'POST', body: healthForm });

    expect(res.status).toBe(200);
  });

  test('large file with many chunks (500KB)', async () => {
    const size = 500 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const form = new FormData();
    form.append(
      'chunked',
      new Blob([data], { type: 'application/octet-stream' }),
      'halfMB.bin',
    );

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.count).toBe(1);
    expect(json.parts[0].name).toBe('chunked');
    expect(json.parts[0].size).toBe(size);
    expect(json.parts[0].filename).toBe('halfMB.bin');
  });

  test('stream-parse empty form returns 0 parts', async () => {
    const form = new FormData();

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = await res.json();

    expect(json.count).toBe(0);
    expect(json.parts).toEqual([]);
  });
});
