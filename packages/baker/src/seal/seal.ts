import { RAW, SEALED } from '../symbols';
import { globalRegistry } from '../registry';
import { SealError } from '../errors';
import { buildDeserializeCode } from './deserialize-builder';
import { buildSerializeCode } from './serialize-builder';
import { analyzeCircular } from './circular-analyzer';
import { validateExposeStacks } from './expose-validator';
import type { RawClassMeta, RawPropertyMeta, SealedExecutors } from '../types';
import type { SealOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// 봉인 상태 플래그
// ─────────────────────────────────────────────────────────────────────────────

let _sealed = false;

// ─────────────────────────────────────────────────────────────────────────────
// seal() — 전역 레지스트리 모든 DTO 봉인 (§4.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 전역 레지스트리에 등록된 **모든** DTO를 봉인한다.
 * - 2회 호출 시: SealError throw
 * - 순환 참조 DTO는 placeholder 패턴으로 안전하게 처리
 */
export function seal(options?: SealOptions): void {
  if (_sealed) throw new SealError('already sealed: seal() must be called exactly once');

  for (const Class of globalRegistry) {
    sealOne(Class, options);
  }

  _sealed = true;
}

/**
 * @internal 테스트 전용 — testing.ts의 unseal()에서 호출
 */
export function _resetForTesting(): void {
  _sealed = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// sealOne() — 개별 클래스 봉인 (§4.1)
// ─────────────────────────────────────────────────────────────────────────────

function sealOne<T>(Class: Function, options?: SealOptions): void {
  if (Object.prototype.hasOwnProperty.call(Class, SEALED)) return; // 이미 봉인됨 (순환 참조 중 재귀 방지)

  // 0. placeholder 등록 — 순환 참조 시 무한 재귀 방지
  const placeholder: SealedExecutors<T> = {
    _deserialize: () => { throw new Error('seal in progress'); },
    _serialize: () => { throw new Error('seal in progress'); },
  };
  (Class as any)[SEALED] = placeholder;

  // 1. 상속 메타데이터 병합
  const merged = mergeInheritance(Class);

  // 2. @Expose 스택 정적 검증 (실패 시 SealError throw)
  validateExposeStacks(merged);

  // 3. 순환 참조 정적 분석
  const needsCircularCheck = analyzeCircular(Class, merged, options);

  // 4. 중첩 @Type 참조 DTO 먼저 봉인 (재귀)
  for (const meta of Object.values(merged)) {
    if (meta.type?.fn) {
      const nested = meta.type.fn();
      sealOne(nested, options);
    }
    if (meta.type?.discriminator) {
      for (const sub of meta.type.discriminator.subTypes) {
        sealOne(sub.value, options);
      }
    }
  }

  // 5. deserialize executor 코드 생성
  const deserializeExecutor = buildDeserializeCode<T>(Class, merged, options, needsCircularCheck);

  // 6. serialize executor 코드 생성
  const serializeExecutor = buildSerializeCode<T>(Class, merged, options);

  // 7. placeholder를 실제 executor로 in-place 교체 (Object.assign으로 참조 무결성 보장)
  Object.assign(placeholder, {
    _deserialize: deserializeExecutor,
    _serialize: serializeExecutor,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeInheritance() — 상속 메타데이터 병합 (§4.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Class의 prototype chain을 따라 RAW 메타데이터를 child-first로 병합한다.
 *
 * 병합 규칙:
 * - validation: union merge (부모+자식 모두 적용, 중복 rule 제거)
 * - transform: 자식 우선, 자식에 없으면 부모 계승
 * - expose: 자식 우선, 자식에 없으면 부모 계승
 * - exclude: 자식 우선, 자식에 없으면 부모 계승
 * - type: 자식 우선, 자식에 없으면 부모 계승
 * - flags: 자식 우선, 자식에 없는 각 플래그만 부모에서 보충
 */
export function mergeInheritance(Class: Function): RawClassMeta {
  // prototype chain을 따라 RAW가 있는 클래스 수집 (array 순서: child first)
  const chain: Function[] = [];
  let current: Function | null = Class;
  while (current && current !== Object) {
    if ((current as any)[RAW]) chain.push(current);
    const proto = Object.getPrototypeOf(current);
    current = proto === current ? null : proto;
  }

  // child-first merge
  const merged: RawClassMeta = Object.create(null) as RawClassMeta;

  for (const ctor of chain) {
    const raw = (ctor as any)[RAW] as RawClassMeta;
    for (const [key, meta] of Object.entries(raw)) {
      if (!merged[key]) {
        // 필드 최초 등장 → shallow copy
        merged[key] = {
          validation: [...meta.validation],
          transform: [...meta.transform],
          expose: [...meta.expose],
          exclude: meta.exclude,
          type: meta.type,
          flags: { ...meta.flags },
        };
      } else {
        // 이미 자식에 존재 → 카테고리별 독립 병합 (§4.2)
        const m = merged[key];
        const p = meta;

        // validation: union merge (중복 rule 제거)
        for (const rd of p.validation) {
          if (!m.validation.some(d => d.rule === rd.rule)) {
            m.validation.push(rd);
          }
        }

        // transform: 자식에 없으면 부모 계승
        if (m.transform.length === 0 && p.transform.length > 0) {
          m.transform = [...p.transform];
        }

        // expose: 자식에 없으면 부모 계승
        if (m.expose.length === 0 && p.expose.length > 0) {
          m.expose = [...p.expose];
        }

        // exclude: 자식에 없으면 부모 계승
        if (m.exclude === null && p.exclude !== null) {
          m.exclude = p.exclude;
        }

        // type: 자식에 없으면 부모 계승
        if (m.type === null && p.type !== null) {
          m.type = p.type;
        }

        // flags: 자식 우선, 자식에 없는 플래그만 부모 보충
        const mf = m.flags;
        const pf = p.flags;
        if (pf.isOptional !== undefined && mf.isOptional === undefined) mf.isOptional = pf.isOptional;
        if (pf.isDefined !== undefined && mf.isDefined === undefined) mf.isDefined = pf.isDefined;
        if (pf.validateIf !== undefined && mf.validateIf === undefined) mf.validateIf = pf.validateIf;
        if (pf.validateNested !== undefined && mf.validateNested === undefined) mf.validateNested = pf.validateNested;
      }
    }
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// __testing__ — 테스트 전용 export (TST-ACCESS 준수)
// ─────────────────────────────────────────────────────────────────────────────

export const __testing__ = {
  mergeInheritance,
};
