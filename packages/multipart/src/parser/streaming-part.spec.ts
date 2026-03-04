import { describe, expect, test } from 'bun:test';

import { BufferedMultipartFile, MultipartFileImpl } from './streaming-part';

const encoder = new TextEncoder();

function makeStream(data: Uint8Array): {
  readable: ReadableStream<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
} {
  const ts = new TransformStream<Uint8Array, Uint8Array>();
  const writer = ts.writable.getWriter();

  return { readable: ts.readable, writer };
}

// ── MultipartFileImpl ─────────────────────────────────────────────────

describe('MultipartFileImpl', () => {
  test('stream() returns readable and can be consumed', async () => {
    const data = encoder.encode('hello streaming');
    const { readable, writer } = makeStream(data);

    void writer.write(data).then(() => writer.close());

    const file = new MultipartFileImpl('doc', 'test.txt', 'text/plain', readable);
    const stream = file.stream();

    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;

    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }

    expect(new TextDecoder().decode(result)).toBe('hello streaming');
  });

  test('stream() throws on second call', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    void writer.close();

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);

    file.stream(); // first call OK

    expect(() => file.stream()).toThrow('already been consumed');
  });

  test('bytes() reads entire stream', async () => {
    const data = encoder.encode('bytes test');
    const { readable, writer } = makeStream(data);

    void writer.write(data).then(() => writer.close());

    const file = new MultipartFileImpl('f', 'f.bin', 'application/octet-stream', readable);
    const bytes = await file.bytes();

    expect(new TextDecoder().decode(bytes)).toBe('bytes test');
  });

  test('text() decodes UTF-8', async () => {
    const data = encoder.encode('한국어 테스트');
    const { readable, writer } = makeStream(data);

    void writer.write(data).then(() => writer.close());

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);

    expect(await file.text()).toBe('한국어 테스트');
  });

  test('arrayBuffer() returns correct buffer', async () => {
    const data = encoder.encode('buffer');
    const { readable, writer } = makeStream(data);

    void writer.write(data).then(() => writer.close());

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);
    const ab = await file.arrayBuffer();

    expect(new TextDecoder().decode(ab)).toBe('buffer');
  });

  test('bytes() after stream() throws', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    void writer.close();

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);

    file.stream();

    try {
      await file.bytes();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('already been consumed');
    }
  });

  test('empty file produces empty bytes', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    void writer.close();

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);
    const bytes = await file.bytes();

    expect(bytes.length).toBe(0);
  });

  test('properties are set correctly', () => {
    const { readable } = makeStream(new Uint8Array(0));
    const file = new MultipartFileImpl('myfile', 'photo.jpg', 'image/jpeg', readable);

    expect(file.name).toBe('myfile');
    expect(file.filename).toBe('photo.jpg');
    expect(file.contentType).toBe('image/jpeg');
    expect(file.isFile).toBe(true);
  });

  test('drainIfUnconsumed() discards data and unblocks writer', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    const file = new MultipartFileImpl('f', 'f.bin', 'application/octet-stream', readable);

    // Writer pushes data — will block without a reader
    const writePromise = (async () => {
      await writer.write(encoder.encode('chunk1'));
      await writer.write(encoder.encode('chunk2'));
      await writer.close();
    })();

    // Drain instead of consuming normally
    file.drainIfUnconsumed();

    // Writer should complete without hanging
    await writePromise;
  });

  test('drainIfUnconsumed() is no-op after stream() was called', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    void writer.close();

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);

    file.stream(); // mark as consumed
    file.drainIfUnconsumed(); // should not throw
  });

  test('drainIfUnconsumed() is no-op after bytes() was called', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    void writer.write(encoder.encode('data')).then(() => writer.close());

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);

    await file.bytes(); // consume
    file.drainIfUnconsumed(); // should not throw
  });

  test('multi-chunk stream is assembled correctly', async () => {
    const { readable, writer } = makeStream(new Uint8Array(0));

    void (async () => {
      await writer.write(encoder.encode('chunk1'));
      await writer.write(encoder.encode('chunk2'));
      await writer.write(encoder.encode('chunk3'));
      await writer.close();
    })();

    const file = new MultipartFileImpl('f', 'f.txt', 'text/plain', readable);

    expect(await file.text()).toBe('chunk1chunk2chunk3');
  });
});

// ── BufferedMultipartFile ─────────────────────────────────────────────

describe('BufferedMultipartFile', () => {
  test('bytes() returns buffered data', async () => {
    const data = encoder.encode('buffered');
    const file = new BufferedMultipartFile('f', 'f.txt', 'text/plain', data);

    expect(await file.bytes()).toBe(data);
  });

  test('text() decodes UTF-8', async () => {
    const data = encoder.encode('안녕하세요');
    const file = new BufferedMultipartFile('f', 'f.txt', 'text/plain', data);

    expect(await file.text()).toBe('안녕하세요');
  });

  test('stream() can be called multiple times', async () => {
    const data = encoder.encode('repeat');
    const file = new BufferedMultipartFile('f', 'f.txt', 'text/plain', data);

    const stream1 = file.stream();
    const stream2 = file.stream();

    // Both should be readable
    const chunks1: Uint8Array[] = [];

    for await (const c of stream1) chunks1.push(c);

    const chunks2: Uint8Array[] = [];

    for await (const c of stream2) chunks2.push(c);

    expect(new TextDecoder().decode(chunks1[0]!)).toBe('repeat');
    expect(new TextDecoder().decode(chunks2[0]!)).toBe('repeat');
  });

  test('arrayBuffer() returns correct buffer', async () => {
    const data = encoder.encode('ab');
    const file = new BufferedMultipartFile('f', 'f.txt', 'text/plain', data);
    const ab = await file.arrayBuffer();

    expect(new TextDecoder().decode(ab)).toBe('ab');
  });

  test('properties are set correctly', () => {
    const file = new BufferedMultipartFile('upload', 'doc.pdf', 'application/pdf', new Uint8Array(0));

    expect(file.name).toBe('upload');
    expect(file.filename).toBe('doc.pdf');
    expect(file.contentType).toBe('application/pdf');
    expect(file.isFile).toBe(true);
  });
});
