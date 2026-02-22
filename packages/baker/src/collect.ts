import { RAW } from './symbols';
import { globalRegistry } from './registry';
import type { RawPropertyMeta, RuleDef, TransformDef, ExposeDef, ExcludeDef, TypeDef } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// ensureMeta — 내부 유틸 (§3.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ctor에 대한 propertyKey의 RawPropertyMeta를 반환한다.
 * - 존재하지 않으면 기본값으로 생성한다.
 * - 전역 레지스트리에 ctor를 자동 등록한다 (데코레이터가 1개라도 있으면 등록).
 */
export function ensureMeta(ctor: Function, key: string): RawPropertyMeta {
  // 전역 레지스트리에 자동 등록
  globalRegistry.add(ctor);

  // Class[RAW] 없으면 생성 (null prototype 사용 — 프로토타입 체인 간섭 0)
  const raw = ((ctor as any)[RAW] ??= Object.create(null) as Record<string, RawPropertyMeta>);

  // key 없으면 기본 meta 생성
  return (raw[key] ??= {
    validation: [],
    transform: [],
    expose: [],
    exclude: null,
    type: null,
    flags: {},
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// collect* — 카테고리별 수집 함수 (§3.1)
// ─────────────────────────────────────────────────────────────────────────────

export function collectValidation(target: object, key: string, ruleDef: RuleDef): void {
  const meta = ensureMeta((target as any).constructor, key);
  meta.validation.push(ruleDef);
}

export function collectTransform(target: object, key: string, transformDef: TransformDef): void {
  const meta = ensureMeta((target as any).constructor, key);
  meta.transform.push(transformDef);
}

export function collectExpose(target: object, key: string, exposeDef: ExposeDef): void {
  const meta = ensureMeta((target as any).constructor, key);
  meta.expose.push(exposeDef);
}

export function collectExclude(target: object, key: string, excludeDef: ExcludeDef): void {
  const meta = ensureMeta((target as any).constructor, key);
  meta.exclude = excludeDef;
}

export function collectType(target: object, key: string, typeDef: TypeDef): void {
  const meta = ensureMeta((target as any).constructor, key);
  meta.type = typeDef;
}
