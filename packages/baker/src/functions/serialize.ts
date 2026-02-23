import { SEALED } from '../symbols';
import { SealError } from '../errors';
import type { RuntimeOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// serialize — Public API (§5.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Class 인스턴스 → plain 객체 변환.
 * - 무검증 전제 — 항상 Record<string, unknown> 반환 (또는 Promise)
 * - async @Transform 사용 시 Promise<Record<string, unknown>> 반환
 * - 미봉인: SealError throw
 */
export async function serialize<T>(
  instance: T,
  options?: RuntimeOptions,
): Promise<Record<string, unknown>> {
  const Class = (instance as any).constructor as Function;
  const sealed = (Class as any)[SEALED];
  if (!sealed) {
    throw new SealError(`not sealed: ${Class.name}. Call seal() before serialize()`);
  }

  return await sealed._serialize(instance, options) as Record<string, unknown>;
}
