import { collectExpose, collectExclude, collectTransform, collectType } from '../collect';
import type { ExposeDef, TransformFunction, TypeDef } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Option Types (§1.2, §1.5 방향 옵션)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExposeOptions {
  /** 출력 측 키 매핑 이름. deserialize/serialize 방향에 따라 다르게 설정 가능. */
  name?: string;
  /** 이 @Expose가 적용되는 groups. */
  groups?: string[];
  /** true: deserialize 방향에만 적용 (class-transformer toClassOnly 대응) */
  deserializeOnly?: boolean;
  /** true: serialize 방향에만 적용 (class-transformer toPlainOnly 대응) */
  serializeOnly?: boolean;
}

export interface ExcludeOptions {
  /** true: deserialize 방향에만 제외 */
  deserializeOnly?: boolean;
  /** true: serialize 방향에만 제외 */
  serializeOnly?: boolean;
}

export interface TransformOptions {
  /** 이 @Transform이 적용되는 groups */
  groups?: string[];
  /** true: deserialize 방향에만 적용 */
  deserializeOnly?: boolean;
  /** true: serialize 방향에만 적용 */
  serializeOnly?: boolean;
}

export interface TypeOptions {
  /** discriminator 설정 — 다형성 지원 (§8) */
  discriminator?: {
    property: string;
    subTypes: { value: Function; name: string }[];
  };
  /** discriminator 프로퍼티를 결과 객체에 유지할지 여부 */
  keepDiscriminatorProperty?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform Decorators (§1.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 필드를 baker에 등록하고 선택적으로 name 매핑/groups/방향 제어를 수행.
 *
 * 복수 @Expose 스택 지원 — 방향별 다른 name 매핑에 활용:
 * @Expose({ name: 'user_name', deserializeOnly: true })
 * @Expose({ name: 'userName', serializeOnly: true })
 *
 * @Expose와 @Exclude 동시 적용 시 @Exclude 우선 (§1.2).
 */
export function Expose(options?: ExposeOptions): PropertyDecorator {
  return (target, key) => {
    collectExpose(target as object, key as string, (options ?? {}) as ExposeDef);
  };
}

/**
 * 필드를 serialize/deserialize 결과에서 제외.
 * @Exclude({ deserializeOnly: true }) — deserialize 방향만 제외
 * @Exclude({ serializeOnly: true }) — serialize 방향만 제외
 * @Exclude() — 양방향 제외
 *
 * @Expose와 동시 적용 시 @Exclude 우선 (§1.2).
 */
export function Exclude(options?: ExcludeOptions): PropertyDecorator {
  return (target, key) => {
    collectExclude(target as object, key as string, (options ?? {}) as ExcludeDef);
  };
}

/**
 * 커스텀 변환 함수 적용.
 * - TransformParams.type === 'deserialize' | 'serialize'로 방향 구분 가능
 * - 명시적 @Transform이 있으면 enableImplicitConversion 건너뜀 (§4.3 ⑤)
 */
export function Transform(fn: TransformFunction, options?: TransformOptions): PropertyDecorator {
  return (target, key) => {
    collectTransform(target as object, key as string, {
      fn,
      options: options ? {
        groups: options.groups,
        deserializeOnly: options.deserializeOnly,
        serializeOnly: options.serializeOnly,
      } : undefined,
    });
  };
}

/**
 * 중첩 객체의 타입을 지정. discriminator 다형성 지원.
 * @ValidateNested와 함께 사용 시 중첩 DTO 재귀 검증 활성화.
 * builder 트리거 조건: meta.type !== null && meta.flags.validateNested === true
 */
export function Type(fn: () => Function, options?: TypeOptions): PropertyDecorator {
  return (target, key) => {
    collectType(target as object, key as string, {
      fn: fn as TypeDef['fn'],
      discriminator: options?.discriminator,
      keepDiscriminatorProperty: options?.keepDiscriminatorProperty,
    });
  };
}
