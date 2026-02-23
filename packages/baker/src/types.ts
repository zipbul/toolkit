import type { ValidationOptions } from './interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// EmitContext — 코드 생성 컨텍스트 (§4.7)
// ─────────────────────────────────────────────────────────────────────────────

export interface EmitContext {
  /** RegExp 참조 배열에 등록, 인덱스 반환 */
  addRegex(re: RegExp): number;
  /** 함수 참조 배열에 등록, 인덱스 반환 — @Transform, @ValidateIf 조건 함수 등 */
  addRef(fn: Function): number;
  /** SealedExecutors 객체 참조 배열에 등록 — 중첩 @Type DTO용 */
  addExecutor(executor: SealedExecutors<unknown>): number;
  /** 에러 코드로 실패 처리 코드 문자열 생성 — path는 builder가 바인딩 */
  fail(code: string): string;
  /** 에러 수집 모드 여부 (= !stopAtFirstError) */
  collectErrors: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// EmittableRule — 검증 함수 + .emit() (§4.7, §4.8)
// ─────────────────────────────────────────────────────────────────────────────

export interface EmittableRule {
  (value: unknown): boolean | Promise<boolean>;
  emit(varName: string, ctx: EmitContext): string;
  readonly ruleName: string;
  /**
   * builder가 typeof 가드 삽입 여부를 판단하는 메타.
   * 해당 타입을 전제하는 rule만 설정 (예: isEmail → 'string').
   * @IsString 자체는 undefined (자체 typeof 포함).
   */
  readonly requiresType?: 'string' | 'number';
  /** async validate 함수 사용 시 true — deserialize-builder가 await 코드를 생성 */
  readonly isAsync?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// RuleDef / TransformDef / ExposeDef / ExcludeDef / TypeDef (§2.1)
// ─────────────────────────────────────────────────────────────────────────────

/** 사용자 정의 메시지 콜백 인자 */
export interface MessageArgs {
  property: string;
  value: unknown;
  constraints: unknown[];
}

export interface RuleDef {
  rule: EmittableRule;
  each?: boolean;
  groups?: string[];
  /** 검증 실패 시 BakerError.message에 포함할 값 */
  message?: string | ((args: MessageArgs) => string);
  /** 검증 실패 시 BakerError.context에 포함할 임의 값 */
  context?: unknown;
}

/** @Transform 콜백 시그니처 */
export type TransformFunction = (params: TransformParams) => unknown;

export interface TransformParams {
  value: unknown;
  key: string;
  /** deserialize: input 원본 객체, serialize: class 인스턴스 */
  obj: Record<string, unknown>;
  type: 'deserialize' | 'serialize';
}

export interface TransformDef {
  fn: TransformFunction;
  options?: {
    groups?: string[];
    deserializeOnly?: boolean;
    serializeOnly?: boolean;
  };
}

export interface ExposeDef {
  name?: string;
  groups?: string[];
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

export interface ExcludeDef {
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

export interface TypeDef {
  fn: () => new (...args: any[]) => any;
  discriminator?: {
    property: string;
    subTypes: { value: Function; name: string }[];
  };
  keepDiscriminatorProperty?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PropertyFlags — @IsOptional, @IsDefined, @ValidateIf, @ValidateNested (§2.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface PropertyFlags {
  /** @IsOptional() — undefined/null 시 validation 전체 skip */
  isOptional?: boolean;
  /** @IsDefined() — null/undefined 불허. isOptional과 동시 시 IsDefined 우선 */
  isDefined?: boolean;
  /** @ValidateIf(cond) — false 시 필드 전체 검증 skip */
  validateIf?: (obj: any) => boolean;
  /** @ValidateNested() — 중첩 DTO 재귀 검증 트리거. @Type과 함께 사용 */
  validateNested?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// RawPropertyMeta — Class[RAW][propertyKey]에 저장되는 수집 데이터 (§2.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawPropertyMeta {
  validation: RuleDef[];
  transform: TransformDef[];
  expose: ExposeDef[];
  exclude: ExcludeDef | null;
  type: TypeDef | null;
  flags: PropertyFlags;
}

export interface RawClassMeta {
  [propertyKey: string]: RawPropertyMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// SealedExecutors — Class[SEALED]에 저장되는 dual executor (§2.1)
// ─────────────────────────────────────────────────────────────────────────────

import type { RuntimeOptions } from './interfaces';
import type { BakerError } from './errors';

export interface SealedExecutors<T> {
  /** 내부 executor — Result 패턴. deserialize()가 감싸서 throw로 변환 */
  _deserialize(input: unknown, options?: RuntimeOptions): (T | import('@zipbul/result').Err<BakerError[]>) | Promise<T | import('@zipbul/result').Err<BakerError[]>>;
  /** 내부 executor — 항상 성공. serialize는 무검증 전제 */
  _serialize(instance: T, options?: RuntimeOptions): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** deserialize 방향에 async 규칙/transform/nested가 있으면 true */
  _isAsync: boolean;
  /** serialize 방향에 async transform/nested가 있으면 true */
  _isSerializeAsync: boolean;
  /** debug: true 시 생성된 executor 소스코드 저장 */
  _source?: { deserialize: string; serialize: string };
}

// Re-export for convenience
export type { ValidationOptions } from './interfaces';
