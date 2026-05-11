import type { MultipartPart } from '../interfaces';

/**
 * Async queue that connects the parser task to the consumer async iterator.
 *
 * The parser pushes parts (or errors) into the queue. The consumer pulls
 * parts via `for await (const part of queue)`. When the parser finishes,
 * it calls `finish()`. If the consumer breaks early, `abandoned` is set
 * to `true` so the parser can stop work.
 *
 * This decoupling allows the parser to run as a separate async task while
 * the consumer drives iteration at its own pace.
 */
export class PartQueue {
  private queue: MultipartPart[];
  private resolve: (() => void) | undefined;
  private done: boolean;
  private error: unknown;
  private _abandoned: boolean;

  constructor() {
    this.queue = [];
    this.resolve = undefined;
    this.done = false;
    this.error = undefined;
    this._abandoned = false;
  }

  /** True when the consumer has stopped iterating (break / return). */
  get abandoned(): boolean {
    return this._abandoned;
  }

  /** Push a parsed part into the queue. Wakes a waiting consumer. */
  push(part: MultipartPart): void {
    this.queue.push(part);
    this.wake();
  }

  /** Signal that parsing is complete — no more parts will be pushed. */
  finish(): void {
    this.done = true;
    this.wake();
  }

  /** Signal a parser error — the consumer's next iteration will throw. */
  fail(err: unknown): void {
    this.error = err;
    this.done = true;
    this.wake();
  }

  /** Mark the queue as abandoned (consumer broke out of the loop). */
  abandon(): void {
    this._abandoned = true;
    this.wake();
  }

  /**
   * Async iterator protocol.
   * The consumer calls `for await (const part of queue)`.
   */
  [Symbol.asyncIterator](): AsyncIterator<MultipartPart> {
    return {
      next: async (): Promise<IteratorResult<MultipartPart>> => {
        while (true) {
          if (this.queue.length > 0) {
            return { done: false, value: this.queue.shift()! };
          }

          if (this.error !== undefined) {
            throw this.error;
          }

          if (this.done) {
            return { done: true, value: undefined };
          }

          const { promise, resolve } = Promise.withResolvers<void>();
          this.resolve = resolve;
          await promise;
        }
      },

      return: async (): Promise<IteratorResult<MultipartPart>> => {
        this._abandoned = true;
        return { done: true, value: undefined };
      },
    };
  }

  private wake(): void {
    if (this.resolve !== undefined) {
      const r = this.resolve;
      this.resolve = undefined;
      r();
    }
  }
}
