import type { MultipartFile } from '../interfaces';

import { MultipartFieldImpl } from './part';
import type { PartQueue } from './part-queue';
import { noop } from '../constants';
import { MultipartFileImpl, BufferedMultipartFile } from './streaming-part';

// ── Interfaces ─────────────────────────────────────────────────────

/**
 * Write handle for a single file part's body data.
 *
 * - {@link BufferingCallbacks} returns a sync writer (void returns).
 * - {@link StreamingCallbacks} returns an async writer backed by TransformStream.
 */
export interface FileWriter {
  write(chunk: Buffer): Promise<void> | void;
  close(): Promise<void> | void;
  abort(reason?: unknown): void;
}

/**
 * Abstraction over the state-machine's output channel.
 *
 * The FSM calls these methods instead of touching PartQueue directly,
 * enabling two fast paths:
 * - `BufferingCallbacks` for `parseAll()` (sync, no TransformStream)
 * - `StreamingCallbacks` for `parse()` (async, TransformStream + PartQueue)
 */
export interface ParserCallbacks {
  onField(name: string, contentType: string, data: Buffer): void;
  onFileStart(name: string, filename: string, contentType: string): FileWriter;
  readonly abandoned: boolean;
}

// ── BufferingCallbacks (parseAll fast path) ────────────────────────

/**
 * Sync file writer that collects chunks into an array.
 * Used by {@link BufferingCallbacks} — no TransformStream overhead.
 */
class BufferingFileWriter implements FileWriter {
  private readonly chunks: Buffer[] = [];
  private readonly fieldName: string;
  private readonly filename: string;
  private readonly contentType: string;
  private readonly files: Map<string, MultipartFile[]>;

  constructor(
    fieldName: string,
    filename: string,
    contentType: string,
    files: Map<string, MultipartFile[]>,
  ) {
    this.fieldName = fieldName;
    this.filename = filename;
    this.contentType = contentType;
    this.files = files;
  }

  write(chunk: Buffer): void {
    this.chunks.push(chunk);
  }

  close(): void {
    let data: Uint8Array;

    if (this.chunks.length === 0) {
      data = new Uint8Array(0);
    } else if (this.chunks.length === 1) {
      data = this.chunks[0]!;
    } else {
      data = Buffer.concat(this.chunks);
    }

    const file = new BufferedMultipartFile(
      this.fieldName,
      this.filename,
      this.contentType,
      data,
    );

    const existing = this.files.get(this.fieldName);

    if (existing !== undefined) {
      existing.push(file);
    } else {
      this.files.set(this.fieldName, [file]);
    }
  }

  abort(): void {
    this.chunks.length = 0;
  }
}

/**
 * Callbacks for `parseAll()` — fully synchronous, no TransformStream, no PartQueue.
 * Fields are stored directly into Maps; files are buffered in memory.
 */
export class BufferingCallbacks implements ParserCallbacks {
  public readonly abandoned: boolean = false;

  constructor(
    private readonly fields: Map<string, string[]>,
    private readonly files: Map<string, MultipartFile[]>,
  ) {}

  onField(name: string, _contentType: string, data: Buffer): void {
    const text = data.toString('utf-8');
    const existing = this.fields.get(name);

    if (existing !== undefined) {
      existing.push(text);
    } else {
      this.fields.set(name, [text]);
    }
  }

  onFileStart(name: string, filename: string, contentType: string): FileWriter {
    return new BufferingFileWriter(name, filename, contentType, this.files);
  }
}

// ── StreamingCallbacks (parse streaming path) ──────────────────────

/**
 * File writer backed by a TransformStream writer.
 * Provides native backpressure when the consumer reads slowly.
 */
class StreamingFileWriter implements FileWriter {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;

  constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
    this.writer = writer;
  }

  write(chunk: Buffer): Promise<void> {
    return this.writer.write(chunk);
  }

  close(): Promise<void> {
    return this.writer.close();
  }

  abort(reason?: unknown): void {
    try { this.writer.abort(reason).catch(noop); } catch { /* already released */ }
  }
}

/**
 * Callbacks for `parse()` — creates TransformStream for files, pushes parts into a PartQueue.
 * The PartQueue bridges the parser task to the consumer's async iterator.
 */
export class StreamingCallbacks implements ParserCallbacks {
  constructor(private readonly queue: PartQueue) {}

  get abandoned(): boolean {
    return this.queue.abandoned;
  }

  onField(name: string, contentType: string, data: Buffer): void {
    this.queue.push(new MultipartFieldImpl(name, contentType, data));
  }

  onFileStart(name: string, filename: string, contentType: string): FileWriter {
    const transform = new TransformStream<Uint8Array, Uint8Array>();
    const writer = transform.writable.getWriter();

    const filePart = new MultipartFileImpl(
      name,
      filename,
      contentType,
      transform.readable,
    );

    this.queue.push(filePart);

    return new StreamingFileWriter(writer);
  }
}
