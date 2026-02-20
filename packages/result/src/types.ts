/**
 * 에러 타입.
 * 마커 프로퍼티는 타입에 포함하지 않는다.
 * err() 함수가 런타임에 마커를 동적 추가하며,
 * isErr() 타입 가드를 통해서만 판별한다.
 *
 * @template E - 에러에 첨부할 추가 데이터의 타입. 기본값은 never.
 */
export type Err<E = never> = {
  stack: string;
  data: E;
};

/**
 * 성공(T) 또는 에러(Err<E>)를 표현하는 유니온 타입.
 * wrapper 클래스가 아닌 plain union으로, 런타임 오버헤드가 없다.
 *
 * @template T - 성공값 타입
 * @template E - 에러 데이터 타입. 기본값은 never.
 */
export type Result<T, E = never> = T | Err<E>;
