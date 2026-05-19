import type { RouterErrorData } from './types';

/**
 * Error thrown by the router for every registration / build / option
 * failure. `match()` never throws; misses return `null`.
 *
 * The structured payload lives on {@link RouterError.data} as a
 * {@link RouterErrorData} discriminated union — narrow on `data.kind`
 * to access the kind-specific fields. `error.message` mirrors
 * `data.message` so the default `Error` toString remains useful.
 */
export class RouterError extends Error {
  /**
   * Structured failure payload. Use `instanceof RouterError` to guard,
   * then narrow on `data.kind` (a {@link import('./types').RouterErrorKind}
   * value) to read kind-specific fields.
   */
  readonly data: RouterErrorData;

  constructor(data: RouterErrorData) {
    super(data.message);
    this.name = 'RouterError';
    this.data = data;
  }
}
