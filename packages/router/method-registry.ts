import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import type { RouterErrData } from './types';

const DEFAULT_METHODS: ReadonlyArray<readonly [string, number]> = [
  ['GET', 0],
  ['POST', 1],
  ['PUT', 2],
  ['PATCH', 3],
  ['DELETE', 4],
  ['OPTIONS', 5],
  ['HEAD', 6],
] as const;

const MAX_METHODS = 32;

export class MethodRegistry {
  private readonly methodToOffset = new Map<string, number>();
  private nextOffset: number;

  constructor() {
    for (const [method, offset] of DEFAULT_METHODS) {
      this.methodToOffset.set(method, offset);
    }

    this.nextOffset = DEFAULT_METHODS.length;
  }

  getOrCreate(method: string): Result<number, RouterErrData> {
    const existing = this.methodToOffset.get(method);

    if (existing !== undefined) {
      return existing;
    }

    if (this.nextOffset >= MAX_METHODS) {
      return err({
        kind: 'method-limit',
        message: `Maximum of ${MAX_METHODS} HTTP methods exceeded. Cannot register method '${method}'.`,
        method,
      });
    }

    const offset = this.nextOffset++;
    this.methodToOffset.set(method, offset);

    return offset;
  }

  get(method: string): number | undefined {
    return this.methodToOffset.get(method);
  }

  get size(): number {
    return this.methodToOffset.size;
  }
}
