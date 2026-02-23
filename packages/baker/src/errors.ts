// ─────────────────────────────────────────────────────────────────────────────
// BakerError — 개별 필드 에러 (§12.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 개별 필드 에러 — 최소 계약(minimum contract).
 *
 * 예약 에러 코드:
 * - 'invalidInput': input이 null, 비객체, 배열일 때 (path='')
 * - 'isObject': 중첩 @Type 필드의 값이 객체가 아닐 때
 * - 'isArray': 배열 중첩 (each:true) 필드의 값이 배열이 아닐 때
 * - 'invalidDiscriminator': discriminator 값이 subTypes에 없을 때
 *
 * 향후 확장 필드(message, expected, actual 등)는 반드시 Optional로 추가.
 */
export interface BakerError {
  readonly path: string;
  readonly code: string;
  /** 사용자 정의 에러 메시지 — 데코레이터 message 옵션이 설정된 경우에만 포함 */
  readonly message?: string;
  /** 사용자 정의 컨텍스트 — 데코레이터 context 옵션이 설정된 경우에만 포함 */
  readonly context?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// BakerValidationError — Public API throw 에러 (§12.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * deserialize() 검증 실패 시 throw되는 에러.
 * errors 배열에 모든 필드 에러가 담겨 있다.
 */
export class BakerValidationError extends Error {
  readonly errors: BakerError[];

  constructor(errors: BakerError[]) {
    super(`Validation failed: ${errors.length} error(s)`);
    this.name = 'BakerValidationError';
    this.errors = errors;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SealError — 봉인 관련 에러 (§12.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 봉인 관련 에러:
 * - seal() 2회 이상 호출 시
 * - 미봉인 클래스에 deserialize()/serialize() 호출 시
 */
export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}
