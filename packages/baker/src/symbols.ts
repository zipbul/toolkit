/**
 * 2개의 Symbol — 외부 저장소 0, 글로벌 오염 0
 * Symbol.for 사용: AOT 코드와 런타임 코드가 동일 Symbol을 공유할 수 있도록 global registry 사용
 */

/** Tier 1 수집 메타데이터 (데코레이터가 Class에 저장) */
export const RAW = Symbol.for('baker:raw');

/** Tier 2 봉인 결과 (seal()이 Class에 저장하는 dual executor) */
export const SEALED = Symbol.for('baker:sealed');
