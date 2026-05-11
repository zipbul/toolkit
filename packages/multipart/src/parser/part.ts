import type { MultipartField } from '../interfaces';

const decoder = new TextDecoder();

/**
 * Concrete implementation of {@link MultipartField}.
 *
 * Holds the raw bytes of a field body and provides synchronous `text()` and `bytes()` accessors.
 * Fields are always fully buffered since they are expected to be small.
 */
export class MultipartFieldImpl implements MultipartField {
  public readonly name: string;
  public readonly filename: undefined = undefined;
  public readonly contentType: string;
  public readonly isFile: false = false;

  private readonly data: Uint8Array;

  constructor(name: string, contentType: string, data: Uint8Array) {
    this.name = name;
    this.contentType = contentType;
    this.data = data;
  }

  /**
   * Returns the field body decoded as a UTF-8 string.
   *
   * Always uses UTF-8 regardless of the Content-Type charset parameter.
   * Invalid bytes are replaced with U+FFFD.
   */
  public text(): string {
    return decoder.decode(this.data);
  }

  /**
   * Returns the field body as raw bytes.
   */
  public bytes(): Uint8Array {
    return this.data;
  }
}
