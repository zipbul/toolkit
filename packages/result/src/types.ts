/**
 * 에러 타입.
 * 마커 프로퍼티는 타입에 포함하지 않는다.
 * error() 함수가 런타임에 마커를 동적 추가하며,
 * isError() 타입 가드를 통해서만 판별한다.
 *
 * @template E - 에러에 첨부할 추가 데이터의 타입. 기본값은 빈 객체.
 */
export type Error<E extends object = Record<string, never>> = {
  stack: string;
  cause: unknown;
  data: E;
};

/**
 * 성공(T) 또는 에러(E)를 표현하는 유니온 타입.
 * wrapper 클래스가 아닌 plain union으로, 런타임 오버헤드가 없다.
 *
 * @template T - 성공값 타입
 * @template E - 에러 타입. 기본값은 Error<Record<string, never>>
 */
export type Result<T, E extends object = Error<Record<string, never>>> = T | E;
