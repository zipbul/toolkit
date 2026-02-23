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
  // 주의: hasOwnProperty 체크 필수 — 클래스 상속 시 ctor.__proto__ === ParentClass 이므로
  // ??= 연산자가 부모의 [RAW]를 찾아 자식의 필드를 부모 RAW에 저장하는 오염 발생 방지
  if (!Object.prototype.hasOwnProperty.call(ctor, RAW)) {
    (ctor as any)[RAW] = Object.create(null) as Record<string, RawPropertyMeta>;
  }
  const raw = (ctor as any)[RAW] as Record<string, RawPropertyMeta>;

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
