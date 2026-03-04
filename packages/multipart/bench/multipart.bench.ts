import { bench, group, run } from 'mitata';

import { Multipart } from '../src/multipart';
import { parseMultipart, BufferingCallbacks, StreamingCallbacks, PartQueue } from '../src/parser';
import { resolveMultipartOptions } from '../src/options';
import type { MultipartFile } from '../src/interfaces';

// ── Helpers ─────────────────────────────────────────────────────────

function buildBody(
  boundary: string,
  parts: Array<{ headers: string; body: string }>,
): string {
  let raw = '';

  for (const part of parts) {
    raw += `--${boundary}\r\n${part.headers}\r\n\r\n${part.body}\r\n`;
  }

  raw += `--${boundary}--\r\n`;

  return raw;
}

function createRequest(boundary: string, body: string): Request {
  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

function toStream(data: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(data);

  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// ── Benchmarks ──────────────────────────────────────────────────────

const mp = Multipart.create();
const boundary = '----Benchmark';
const opts = resolveMultipartOptions();

// Small form: 3 fields
const smallBody = buildBody(boundary, [
  { headers: 'Content-Disposition: form-data; name="a"', body: 'hello' },
  { headers: 'Content-Disposition: form-data; name="b"', body: 'world' },
  { headers: 'Content-Disposition: form-data; name="c"', body: '12345' },
]);

// Medium form: 10 fields + 2 small files
const mediumParts = [];

for (let i = 0; i < 10; i++) {
  mediumParts.push({
    headers: `Content-Disposition: form-data; name="field${i}"`,
    body: `value${i}-${'x'.repeat(100)}`,
  });
}

mediumParts.push({
  headers: 'Content-Disposition: form-data; name="file1"; filename="small.txt"\r\nContent-Type: text/plain',
  body: 'x'.repeat(1024),
});

mediumParts.push({
  headers: 'Content-Disposition: form-data; name="file2"; filename="medium.txt"\r\nContent-Type: text/plain',
  body: 'y'.repeat(10 * 1024),
});

const mediumBody = buildBody(boundary, mediumParts);

// Large: single 1 MiB file
const largeBody = buildBody(boundary, [
  {
    headers: 'Content-Disposition: form-data; name="bigfile"; filename="big.bin"\r\nContent-Type: application/octet-stream',
    body: 'z'.repeat(1024 * 1024),
  },
]);

group('parseAll', () => {
  bench('small (3 fields)', async () => {
    await mp.parseAll(createRequest(boundary, smallBody));
  });

  bench('medium (10 fields + 2 files)', async () => {
    await mp.parseAll(createRequest(boundary, mediumBody));
  });

  bench('large (1 MiB file)', async () => {
    await mp.parseAll(createRequest(boundary, largeBody));
  });
});

group('parse (streaming)', () => {
  bench('small (3 fields)', async () => {
    for await (const part of mp.parse(createRequest(boundary, smallBody))) {
      if (part.isFile) await part.bytes();
    }
  });

  bench('medium (10 fields + 2 files)', async () => {
    for await (const part of mp.parse(createRequest(boundary, mediumBody))) {
      if (part.isFile) await part.bytes();
    }
  });

  bench('large (1 MiB file)', async () => {
    for await (const part of mp.parse(createRequest(boundary, largeBody))) {
      if (part.isFile) await part.bytes();
    }
  });
});

// Raw FSM benchmarks — measure parser core only, without public API overhead
// (boundary extraction, option resolution, Request.body stream creation).
// Not a fair comparison to parseAll/parse groups above; use to isolate FSM perf.

group('FSM + BufferingCallbacks (direct)', () => {
  bench('small (3 fields)', async () => {
    const fields = new Map<string, string[]>();
    const files = new Map<string, MultipartFile[]>();
    await parseMultipart(toStream(smallBody), boundary, opts, new BufferingCallbacks(fields, files));
  });

  bench('medium (10 fields + 2 files)', async () => {
    const fields = new Map<string, string[]>();
    const files = new Map<string, MultipartFile[]>();
    await parseMultipart(toStream(mediumBody), boundary, opts, new BufferingCallbacks(fields, files));
  });

  bench('large (1 MiB file)', async () => {
    const fields = new Map<string, string[]>();
    const files = new Map<string, MultipartFile[]>();
    await parseMultipart(toStream(largeBody), boundary, opts, new BufferingCallbacks(fields, files));
  });
});

group('FSM + StreamingCallbacks (direct)', () => {
  bench('small (3 fields)', async () => {
    const queue = new PartQueue();
    const callbacks = new StreamingCallbacks(queue);

    parseMultipart(toStream(smallBody), boundary, opts, callbacks)
      .then(() => queue.finish())
      .catch((error) => { if (!queue.abandoned) queue.fail(error); });

    for await (const part of queue) {
      if (part.isFile) await part.bytes();
    }
  });

  bench('medium (10 fields + 2 files)', async () => {
    const queue = new PartQueue();
    const callbacks = new StreamingCallbacks(queue);

    parseMultipart(toStream(mediumBody), boundary, opts, callbacks)
      .then(() => queue.finish())
      .catch((error) => { if (!queue.abandoned) queue.fail(error); });

    for await (const part of queue) {
      if (part.isFile) await part.bytes();
    }
  });

  bench('large (1 MiB file)', async () => {
    const queue = new PartQueue();
    const callbacks = new StreamingCallbacks(queue);

    parseMultipart(toStream(largeBody), boundary, opts, callbacks)
      .then(() => queue.finish())
      .catch((error) => { if (!queue.abandoned) queue.fail(error); });

    for await (const part of queue) {
      if (part.isFile) await part.bytes();
    }
  });
});

await run();
