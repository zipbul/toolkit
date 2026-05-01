import type { RouterErrorData } from './types';

export class RouterError extends Error {
  readonly data: RouterErrorData;

  constructor(data: RouterErrorData) {
    super(data.message);
    this.name = 'RouterError';
    this.data = data;
  }
}
