import { SealError } from '../errors';
import type { RawClassMeta, ExposeDef } from '../types';

/**
 * @Expose 스택 정적 검증 (§4.1, §3.3)
 *
 * 검사 ①: 동일 @Expose 항목에 deserializeOnly: true + serializeOnly: true → 양쪽 방향 모두 제외
 * 검사 ②: 같은 방향에 2개 이상 @Expose가 있고 groups가 겹치면 SealError
 *          - 둘 다 groups=[] (ungrouped) → 겹침
 *          - 둘 다 non-empty groups이며 교집합 존재 → 겹침
 *          - 하나는 ungrouped, 다른 하나는 grouped → 겹치지 않음 (다른 적용 범위)
 */
export function validateExposeStacks(merged: RawClassMeta, className?: string): void {
  const prefix = className ? `${className}.` : '';
  for (const [key, meta] of Object.entries(merged)) {
    // ① single-entry check: deserializeOnly + serializeOnly 동시 금지
    for (const exp of meta.expose) {
      if (exp.deserializeOnly && exp.serializeOnly) {
        throw new SealError(
          `Invalid @Expose on field '${prefix}${key}': cannot have both deserializeOnly:true and serializeOnly:true on the same @Expose entry. Use separate @Expose decorators for each direction.`,
        );
      }
    }

    // ② multi-entry check per direction
    // deserialize direction: !serializeOnly (includes bidirectional + deserializeOnly)
    const desEntries = meta.expose.filter(e => !e.serializeOnly);
    // serialize direction: !deserializeOnly (includes bidirectional + serializeOnly)
    const serEntries = meta.expose.filter(e => !e.deserializeOnly);

    _checkDirectionOverlap(prefix + key, desEntries, 'deserializeOnly');
    _checkDirectionOverlap(prefix + key, serEntries, 'serializeOnly');
  }
}

/**
 * 같은 방향 내 @Expose entries 쌍마다 groups 겹침 검사
 */
function _checkDirectionOverlap(key: string, entries: ExposeDef[], dirLabel: string): void {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const aGroups = entries[i].groups ?? [];
      const bGroups = entries[j].groups ?? [];
      if (_groupsOverlap(aGroups, bGroups)) {
        const overlapping = aGroups.length === 0 ? [] : aGroups.filter(g => bGroups.includes(g));
        throw new SealError(
          `@Expose conflict on '${key}': 2 @Expose stacks with '${dirLabel}' direction and overlapping groups [${overlapping.join(', ')}]. Each direction must have at most one @Expose per group set.`,
        );
      }
    }
  }
}

/**
 * 두 groups 배열이 겹치는지 여부 판단.
 * - 둘 다 empty → 겹침 (동일 ungrouped 범위)
 * - 둘 다 non-empty이며 교집합 존재 → 겹침
 * - 하나 empty + 하나 non-empty → 겹치지 않음 (서로 다른 필터 범위)
 */
function _groupsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 && b.length === 0) return true;
  if (a.length === 0 || b.length === 0) return false;
  return a.some(g => b.includes(g));
}
