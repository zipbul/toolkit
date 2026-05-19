import type { Router, RouterInternals } from './src/router';

import { ROUTER_INTERNALS_KEY } from './src/router';

export type { RouterInternals } from './src/router';

export function getRouterInternals<T>(router: Router<T>): RouterInternals<T> {
  const internals = (router as unknown as Record<symbol, RouterInternals<T> | undefined>)[ROUTER_INTERNALS_KEY];
  if (internals === undefined) {
    throw new Error('Router internals slot missing — instance was not constructed by @zipbul/router');
  }
  return internals;
}
