import type { Result } from '@zipbul/result';

import { err, isErr } from '@zipbul/result';

import type { RouterErrorData } from './types';

import { validateMethodToken } from './builder';
import { RouterErrorKind } from './types';

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

interface MethodRegistrySnapshot {
  entries: Array<readonly [string, number]>;
  nextOffset: number;
}

export class MethodRegistry {
  private codeMap: Record<string, number> = Object.create(null) as Record<string, number>;
  private nextOffset: number;
  private codeCount = 0;

  constructor() {
    for (const [method, offset] of DEFAULT_METHODS) {
      this.codeMap[method] = offset;
      this.codeCount++;
    }
    this.nextOffset = DEFAULT_METHODS.length;
  }

  getOrCreate(method: string): Result<number, RouterErrorData> {
    const existing = this.codeMap[method];
    if (existing !== undefined) {
      return existing;
    }

    const tokenCheck = validateMethodToken(method);
    if (isErr(tokenCheck)) {
      return tokenCheck;
    }

    if (this.nextOffset >= MAX_METHODS) {
      return err({
        kind: RouterErrorKind.MethodLimit,
        message: `Maximum of ${MAX_METHODS} HTTP methods exceeded. Cannot register method '${method}'.`,
        method,
        suggestion: `Reduce the number of distinct HTTP methods in this router (limit is ${MAX_METHODS}) or split routes across multiple Router instances.`,
      });
    }

    const offset = this.nextOffset++;
    this.codeMap[method] = offset;
    this.codeCount++;
    return offset;
  }

  get(method: string): number | undefined {
    return this.codeMap[method];
  }

  get size(): number {
    return this.codeCount;
  }

  getAllCodes(): ReadonlyArray<readonly [string, number]> {
    const out: Array<readonly [string, number]> = [];
    for (const k in this.codeMap) {
      out.push([k, this.codeMap[k]!] as const);
    }
    return out;
  }

  getCodeMap(): Readonly<Record<string, number>> {
    return this.codeMap;
  }

  snapshot(): MethodRegistrySnapshot {
    const entries: Array<readonly [string, number]> = [];
    for (const k in this.codeMap) {
      entries.push([k, this.codeMap[k]!]);
    }
    return { entries, nextOffset: this.nextOffset };
  }

  restore(snapshot: MethodRegistrySnapshot): void {
    const fresh = Object.create(null) as Record<string, number>;
    let count = 0;
    for (const [method, offset] of snapshot.entries) {
      fresh[method] = offset;
      count++;
    }
    this.codeMap = fresh;
    this.codeCount = count;
    this.nextOffset = snapshot.nextOffset;
  }
}
