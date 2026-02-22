import { SealError } from '../errors';
import type { RawClassMeta } from '../types';

/**
 * @Expose 스택 정적 검증 (§4.1)
 *
 * 각 필드의 expose 배열을 순회하며 잘못된 조합을 감지한다.
 * 잘못된 경우: 동일 @Expose 항목에 deserializeOnly: true + serializeOnly: true → 양쪽 방향 모두 제외
 */
export function validateExposeStacks(merged: RawClassMeta): void {
  for (const [key, meta] of Object.entries(merged)) {
    for (const exp of meta.expose) {
      if (exp.deserializeOnly && exp.serializeOnly) {
        throw new SealError(
          `Invalid @Expose on field '${key}': cannot have both deserializeOnly:true and serializeOnly:true on the same @Expose entry. Use separate @Expose decorators for each direction.`,
        );
      }
    }
  }
}
