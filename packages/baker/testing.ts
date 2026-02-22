import { globalRegistry } from './src/registry';
import { SEALED } from './src/symbols';
import { _resetForTesting } from './src/seal/seal';

/**
 * 테스트 전용: 봉인 상태를 초기화한다.
 * - 모든 Class[SEALED] 제거
 * - _sealed 플래그 false로 리셋
 * - 프로덕션에서 사용 금지
 */
export function unseal(): void {
  for (const Class of globalRegistry) {
    delete (Class as any)[SEALED];
  }
  _resetForTesting();
}
