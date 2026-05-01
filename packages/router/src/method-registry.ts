import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import type { RouterErrorData } from './types';

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
  /** Insertion-ordered map — fed to callers that need to iterate `[name, code]`
   *  pairs (router build() walks this for activeMethodCodes). */
  private readonly methodToOffset = new Map<string, number>();
  /** Prototype-less object mirror of `methodToOffset`. router pre-A6 rebuilt
   *  this on every build() by walking the Map; carrying it as the registry's
   *  authoritative O(1) lookup table avoids the conversion. Created via
   *  `Object.create(null)` for the same reason router's NullProtoObj exists —
   *  no Object.prototype walk on every match. */
  private readonly codeMap: Record<string, number> = Object.create(null) as Record<string, number>;
  private nextOffset: number;

  constructor() {
    for (const [method, offset] of DEFAULT_METHODS) {
      this.methodToOffset.set(method, offset);
      this.codeMap[method] = offset;
    }

    this.nextOffset = DEFAULT_METHODS.length;
  }

  getOrCreate(method: string): Result<number, RouterErrorData> {
    const existing = this.methodToOffset.get(method);

    if (existing !== undefined) {
      return existing;
    }

    if (this.nextOffset >= MAX_METHODS) {
      return err({
        kind: 'method-limit',
        message: `Maximum of ${MAX_METHODS} HTTP methods exceeded. Cannot register method '${method}'.`,
        method,
        suggestion: `Reduce the number of distinct HTTP methods in this router (limit is ${MAX_METHODS}) or split routes across multiple Router instances.`,
      });
    }

    const offset = this.nextOffset++;
    this.methodToOffset.set(method, offset);
    this.codeMap[method] = offset;

    return offset;
  }

  get(method: string): number | undefined {
    return this.methodToOffset.get(method);
  }

  get size(): number {
    return this.methodToOffset.size;
  }

  getAllCodes(): ReadonlyMap<string, number> {
    return this.methodToOffset;
  }

  /**
   * Same data as `getAllCodes()` but as a prototype-less Record for hot-path
   * lookup. The returned object is the registry's internal table — callers
   * must not freeze or mutate it (router consumes it as a closure-captured
   * matchImpl input; freeze would tank JSC inline caches per F22 partition).
   */
  getCodeMap(): Readonly<Record<string, number>> {
    return this.codeMap;
  }
}
