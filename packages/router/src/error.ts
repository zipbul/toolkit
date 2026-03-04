import type { RouterErrData } from './types';

export class RouterError extends Error {
  readonly data: RouterErrData;

  constructor(data: RouterErrData) {
    super(data.message);
    this.name = 'RouterError';
    this.data = data;
  }
}
