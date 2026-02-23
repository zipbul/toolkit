import type { EmittableRule, EmitContext } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// createRule — 커스텀 검증 규칙 생성 Public API (§1.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateRuleOptions {
  /** 규칙 이름. 에러 코드로 사용됨. */
  name: string;
  /** 검증 함수 — true: 통과, false: 실패. async 함수 허용 (Promise<boolean> 반환 시 자동으로 async 루르로 등록). */
  validate: (value: unknown) => boolean | Promise<boolean>;
  /**
   * 기본 에러 메시지.
   * @phase2 — 현재는 수집만 하고 코드 생성에서 미사용.
   */
  defaultMessage?: string;
}

/**
 * 사용자 정의 검증 규칙을 생성한다.
 *
 * 반환된 EmittableRule은:
 * - 함수로 직접 호출 가능 (validate 위임)
 * - .emit()으로 인라인 코드 생성 지원
 * - 데코레이터/헬퍼 양쪽에서 사용 가능
 *
 * @example
 * const isEven = createRule({
 *   name: 'isEven',
 *   validate: (v) => typeof v === 'number' && v % 2 === 0,
 * });
 *
 * class Dto {
 *   @IsEven() count: number;
 * }
 */
export function createRule(options: CreateRuleOptions): EmittableRule {
  const { name, validate } = options;

  // async 함수 여부 자동 감지
  const isAsyncFn = validate.constructor.name === 'AsyncFunction';

  // 검증 함수 래퍼 — validate에 직접 위임
  const fn = function (value: unknown): boolean | Promise<boolean> {
    return validate(value);
  } as EmittableRule;

  // .emit() — refs 배열을 통한 함수 호출 코드 생성 (§4.8 Type C 방식이 아닌 refs 방식)
  // @Transform 사용자 함수와 동일하게 _refs[i] 슬롯에 등록
  fn.emit = function (varName: string, ctx: EmitContext): string {
    const i = ctx.addRef(validate);
    // async rule: await 삽입 (caller(desert-builder)는 async function 생성을 보장)
    if (isAsyncFn) {
      return `if(!(await _refs[${i}](${varName}))) ${ctx.fail(name)};`;
    }
    return `if(!_refs[${i}](${varName})) ${ctx.fail(name)};`;
  };

  // ruleName — 에러 코드로 사용
  (fn as any).ruleName = name;
  // isAsync 플래그 — deserialize-builder가 async function 생성 여부 판단에 사용
  (fn as any).isAsync = isAsyncFn;

  return fn;
}
