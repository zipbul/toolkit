import { expect } from 'bun:test';

import type { Router } from '../src/router';
import type { RouterErrorData } from '../src/types';

import { getRouterInternals } from '../internal';
import { RouterError } from '../src/error';
import { RouterErrorKind } from '../src/types';

export function catchRouterError(fn: () => void): RouterError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RouterError);
    return e as RouterError;
  }
  throw new Error('Expected RouterError to be thrown');
}

export function firstBuildIssue<T>(router: Router<T>): RouterErrorData {
  const err = catchRouterError(() => router.build());
  expect(err.data.kind).toBe(RouterErrorKind.RouteValidation);
  if (err.data.kind !== RouterErrorKind.RouteValidation) {
    throw err;
  }
  return err.data.errors[0]!.error;
}

export function getRegistrationSnapshot<T>(router: Router<T>): {
  handlers: T[];
  terminalSlab: Int32Array;
  segmentTrees: ReadonlyArray<unknown>;
  staticByMethod: ReadonlyArray<unknown>;
} {
  const internals = getRouterInternals(router);
  const snap = (
    internals.registration as unknown as {
      snapshot: {
        handlers: T[];
        terminalSlab: Int32Array;
        segmentTrees: ReadonlyArray<unknown>;
        staticByMethod: ReadonlyArray<unknown>;
      } | null;
    }
  ).snapshot;
  if (snap === null) {
    throw new Error('Router not built — snapshot unavailable');
  }
  return snap;
}
