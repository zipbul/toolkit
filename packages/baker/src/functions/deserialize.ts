import { isErr } from '@zipbul/result';
import { SEALED } from '../symbols';
import { SealError, BakerValidationError } from '../errors';
import type { BakerError } from '../errors';
import type { RuntimeOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// deserialize — Public API (throw 패턴) (§5.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * input → Class 인스턴스 변환 + 검증.
 * - 성공: Promise<T> 반환
 * - 검증 실패: BakerValidationError throw
 * - 미봉인: SealError throw
 */
export async function deserialize<T>(
  Class: new (...args: any[]) => T,
  input: unknown,
  options?: RuntimeOptions,
): Promise<T> {
  const sealed = (Class as any)[SEALED];
  if (!sealed) {
    throw new SealError(`not sealed: ${Class.name}. Call seal() before deserialize()`);
  }

  const result = await sealed._deserialize(input, options);
  if (isErr(result)) {
    throw new BakerValidationError(result.data as BakerError[]);
  }
  return result as T;
}
