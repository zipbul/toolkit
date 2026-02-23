// ─────────────────────────────────────────────────────────────────────────────
// ValidationOptions — 데코레이터 공통 옵션 (§2.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationOptions {
  /** true: 배열의 각 원소에 규칙 적용 */
  each?: boolean;
  /** 이 규칙이 속하는 그룹 목록 */
  groups?: string[];
  /** 사용자 정의 에러 메시지 — 검증 실패 시 BakerError.message에 포함 */
  message?: string | ((args: { property: string; value: unknown; constraints: unknown[] }) => string);
  /** 검증 실패 시 BakerError.context에 포함할 임의 값 */
  context?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// SealOptions — seal() 글로벌 옵션 (§1.4)
// ─────────────────────────────────────────────────────────────────────────────

export interface SealOptions {
  /**
   * validation 데코레이터를 타입 힌트로 활용한 자동 변환.
   * @default false
   */
  enableImplicitConversion?: boolean;
  /**
   * 순환 참조 감지.
   * 'auto' = 정적 분석으로 필요한 DTO만 WeakSet 삽입.
   * @default 'auto'
   */
  enableCircularCheck?: boolean | 'auto';
  /**
   * input에 해당 키가 없을 때 클래스 기본값을 사용.
   * @default false
   */
  exposeDefaultValues?: boolean;
  /**
   * true: 첫 에러 즉시 반환. false(기본): 전체 에러 수집.
   * @default false
   */
  stopAtFirstError?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// RuntimeOptions — deserialize/serialize 런타임 옵션 (§5.3)
// ─────────────────────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  /** 요청별 groups — 요청마다 다를 수 있으므로 런타임에 전달 */
  groups?: string[];
}
