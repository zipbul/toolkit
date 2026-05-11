import type { MultipartFile } from '../interfaces';

const decoder = new TextDecoder();

/**
 * Streaming file part backed by a TransformStream.
 *
 * The parser writes chunks into the writable side; the consumer reads
 * from the readable side via `stream()`. TransformStream provides native
 * backpressure — when the consumer is slow, `writer.write()` blocks the parser.
 *
 * Memory usage is O(chunk_size) rather than O(file_size).
 */
export class MultipartFileImpl implements MultipartFile {
  public readonly name: string;
  public readonly filename: string;
  public readonly contentType: string;
  public readonly isFile: true = true;

  private readonly readable: ReadableStream<Uint8Array>;
  private consumed = false;

  constructor(
    name: string,
    filename: string,
    contentType: string,
    readable: ReadableStream<Uint8Array>,
  ) {
    this.name = name;
    this.filename = filename;
    this.contentType = contentType;
    this.readable = readable;
  }

  /**
   * Returns the underlying ReadableStream.
   *
   * **Important:** The stream can only be consumed once. Calling `stream()`
   * after `bytes()`, `text()`, `arrayBuffer()`, or `saveTo()` will throw.
   */
  public stream(): ReadableStream<Uint8Array> {
    if (this.consumed) {
      throw new Error('File stream has already been consumed');
    }

    this.consumed = true;

    return this.readable;
  }

  /**
   * Reads the entire stream into a Uint8Array.
   */
  public async bytes(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalLen = 0;

    for await (const chunk of this.getStream()) {
      chunks.push(chunk);
      totalLen += chunk.length;
    }

    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0]!;

    const result = new Uint8Array(totalLen);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Reads the entire stream and decodes it as UTF-8.
   */
  public async text(): Promise<string> {
    return decoder.decode(await this.bytes());
  }

  /**
   * Reads the entire stream into an ArrayBuffer.
   */
  public async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();

    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  /**
   * Writes the file to disk using Bun.write.
   * @returns The number of bytes written.
   */
  public async saveTo(path: string): Promise<number> {
    return Bun.write(path, await new Response(this.getStream()).blob());
  }

  /**
   * Discards the file stream if the consumer never consumed it.
   * This unblocks the parser's TransformStream writer, preventing deadlock
   * when the consumer advances to the next part without reading the file.
   *
   * @internal Called by {@link Multipart.parse} between part yields.
   */
  drainIfUnconsumed(): void {
    if (this.consumed) return;
    this.consumed = true;

    const reader = this.readable.getReader();
    const pump = (): void => {
      reader.read().then(({ done }) => {
        if (!done) pump();
      }).catch(() => {});
    };

    pump();
  }

  private getStream(): ReadableStream<Uint8Array> {
    if (this.consumed) {
      throw new Error('File stream has already been consumed');
    }

    this.consumed = true;

    return this.readable;
  }
}

/**
 * A fully buffered file part, used by `parseAll()`.
 *
 * The stream has already been consumed and the data is held in memory.
 * All async methods resolve immediately from the buffer.
 */
export class BufferedMultipartFile implements MultipartFile {
  public readonly name: string;
  public readonly filename: string;
  public readonly contentType: string;
  public readonly isFile: true = true;

  private readonly data: Uint8Array;

  constructor(name: string, filename: string, contentType: string, data: Uint8Array) {
    this.name = name;
    this.filename = filename;
    this.contentType = contentType;
    this.data = data;
  }

  /**
   * Returns a new ReadableStream wrapping the buffered data.
   * Can be called multiple times since data is already in memory.
   */
  public stream(): ReadableStream<Uint8Array> {
    const data = this.data;

    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  public async bytes(): Promise<Uint8Array> {
    return this.data;
  }

  public async text(): Promise<string> {
    return decoder.decode(this.data);
  }

  public async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.buffer.slice(
      this.data.byteOffset,
      this.data.byteOffset + this.data.byteLength,
    ) as ArrayBuffer;
  }

  public async saveTo(path: string): Promise<number> {
    return Bun.write(path, this.data);
  }
}
