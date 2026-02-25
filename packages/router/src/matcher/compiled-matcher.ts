import type { Result } from '@zipbul/result';
import type { BinaryRouterLayout } from '../schema';
import type { PatternTesterFn, RouteParams, RouterErrData } from '../types';
import type { DecoderFn } from '../processor/decoder';

import { err, isErr } from '@zipbul/result';
import {
  NODE_STRIDE,
  NODE_OFFSET_META,
  NODE_OFFSET_METHOD_MASK,
  NODE_OFFSET_MATCH_FUNC,
  NODE_OFFSET_STATIC_CHILD_PTR,
  NODE_OFFSET_STATIC_CHILD_COUNT,
  NODE_OFFSET_PARAM_CHILD_PTR,
  NODE_OFFSET_WILDCARD_CHILD_PTR,
  NODE_OFFSET_METHODS_PTR,
  NODE_MASK_METHOD_COUNT,
  NODE_SHIFT_METHOD_COUNT,
  NODE_MASK_PARAM_COUNT,
  NODE_SHIFT_PARAM_COUNT,
  NODE_MASK_WILDCARD_ORIGIN,
  NODE_SHIFT_WILDCARD_ORIGIN,
  PARAM_ENTRY_STRIDE,
} from '../schema';

/** 컴파일 매칭 결과. */
export interface CompiledMatchResult {
  handlerIndex: number;
  params: RouteParams;
}

/** 사전 컴파일된 매칭 함수 시그니처. */
export type CompiledMatchFn = (
  segments: string[],
  methodCode: number,
  segmentHints: Uint8Array | undefined,
  decodeParams: boolean,
  normalizedPath: string,
) => Result<CompiledMatchResult | null, RouterErrData>;

/** 내부 노드 매칭 함수 시그니처. */
type NodeMatchFn = (
  segments: string[],
  segIdx: number,
  methodCode: number,
  hints: Uint8Array | undefined,
  decodeParams: boolean,
  normalizedPath: string,
) => Result<CompiledMatchResult | null, RouterErrData>;

/** 와일드카드 노드 정보 (빌드 타임에 추출). */
interface WildcardInfo {
  readonly name: string;
  readonly origin: number;
  readonly methodHandlers: ReadonlyMap<number, number>;
  readonly methodMask: number;
}

/**
 * BinaryRouterLayout을 분석하여 클로저 트리 기반 매칭 함수를 생성한다.
 * 각 trie 노드가 하나의 클로저가 되며, TypedArray 오프셋 계산이 빌드 시점에 resolve된다.
 *
 * @param maxNodeCount 노드 수가 이 값을 초과하면 null을 반환한다.
 * @returns 컴파일된 매칭 함수. 노드 수 초과 시 null.
 */
export function buildMatchFunction(
  layout: BinaryRouterLayout,
  patternTesters: ReadonlyArray<PatternTesterFn | undefined>,
  decode: DecoderFn,
  maxNodeCount: number,
): CompiledMatchFn | null {
  const nodeCount = layout.nodeBuffer.length / NODE_STRIDE;

  if (nodeCount > maxNodeCount) {
    return null;
  }

  const rootMatch = compileNode(layout, layout.rootIndex, patternTesters, decode);

  return (segments, methodCode, hints, decodeParams, normalizedPath) =>
    rootMatch(segments, 0, methodCode, hints, decodeParams, normalizedPath);
}

/**
 * methodsBuffer에서 methodCode → handlerIndex 맵을 추출한다.
 * methodsPtr이 0이거나 메서드 수가 0이면 null을 반환한다.
 */
function extractMethodHandlers(
  methodsPtr: number,
  meta: number,
  methodsBuffer: Uint32Array,
): Map<number, number> | null {
  if (methodsPtr <= 0) {
    return null;
  }

  const count = (meta & NODE_MASK_METHOD_COUNT) >>> NODE_SHIFT_METHOD_COUNT;

  if (count === 0) {
    return null;
  }

  const map = new Map<number, number>();
  let ptr = methodsPtr;

  for (let i = 0; i < count; i++) {
    map.set(methodsBuffer[ptr]!, methodsBuffer[ptr + 1]!);
    ptr += 2;
  }

  return map;
}

/**
 * 단일 trie 노드를 클로저로 컴파일한다.
 * 자식 노드에 대해 재귀적으로 호출한다 (와일드카드 제외 — 와일드카드는 항상 터미널).
 */
function compileNode(
  layout: BinaryRouterLayout,
  nodeIdx: number,
  testers: ReadonlyArray<PatternTesterFn | undefined>,
  decode: DecoderFn,
): NodeMatchFn {
  const {
    nodeBuffer, staticChildrenBuffer, paramChildrenBuffer,
    paramsBuffer, methodsBuffer, decodedStrings,
  } = layout;

  const base = nodeIdx * NODE_STRIDE;
  const meta = nodeBuffer[base + NODE_OFFSET_META]!;
  const methodMask = nodeBuffer[base + NODE_OFFSET_METHOD_MASK]!;
  const methodsPtr = nodeBuffer[base + NODE_OFFSET_METHODS_PTR]!;

  // ── 터미널 핸들러 ──
  const methodHandlers = extractMethodHandlers(methodsPtr, meta, methodsBuffer);

  // ── 정적 자식 ──
  const staticCount = nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_COUNT]!;
  const staticSegments: string[] = [];
  const staticMatchers: NodeMatchFn[] = [];

  if (staticCount > 0) {
    const sPtr = nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_PTR]!;

    for (let i = 0; i < staticCount; i++) {
      const sID = staticChildrenBuffer[sPtr + i * 2]!;
      const childIdx = staticChildrenBuffer[sPtr + i * 2 + 1]!;

      staticSegments.push(decodedStrings[sID]!);
      staticMatchers.push(compileNode(layout, childIdx, testers, decode));
    }
  }

  // ── 파라미터 자식 ──
  const paramNodeCount = (meta & NODE_MASK_PARAM_COUNT) >>> NODE_SHIFT_PARAM_COUNT;
  const paramNames: string[] = [];
  const paramTesters: (PatternTesterFn | undefined)[] = [];
  const paramMatchers: NodeMatchFn[] = [];

  if (paramNodeCount > 0) {
    const pPtr = nodeBuffer[base + NODE_OFFSET_PARAM_CHILD_PTR]!;

    for (let i = 0; i < paramNodeCount; i++) {
      const childIdx = paramChildrenBuffer[pPtr + i]!;
      const childBase = childIdx * NODE_STRIDE;
      const paramInfoIdx = nodeBuffer[childBase + NODE_OFFSET_MATCH_FUNC]!;
      const pBase = paramInfoIdx * PARAM_ENTRY_STRIDE;
      const nameID = paramsBuffer[pBase]!;
      const patternID = paramsBuffer[pBase + 1]!;

      paramNames.push(decodedStrings[nameID]!);
      paramTesters.push(patternID !== 0xffffffff ? testers[patternID] : undefined);
      paramMatchers.push(compileNode(layout, childIdx, testers, decode));
    }
  }

  // ── 와일드카드 자식 (재귀 불필요 — 항상 터미널) ──
  const wildcardPtr = nodeBuffer[base + NODE_OFFSET_WILDCARD_CHILD_PTR]!;
  let wildcard: WildcardInfo | null = null;

  if (wildcardPtr !== 0) {
    const wBase = wildcardPtr * NODE_STRIDE;
    const wMeta = nodeBuffer[wBase + NODE_OFFSET_META]!;
    const wNameID = nodeBuffer[wBase + NODE_OFFSET_MATCH_FUNC]!;
    const wMethodsPtr = nodeBuffer[wBase + NODE_OFFSET_METHODS_PTR]!;
    const wMethodHandlers = extractMethodHandlers(wMethodsPtr, wMeta, methodsBuffer);

    if (wMethodHandlers) {
      wildcard = {
        name: decodedStrings[wNameID]!,
        origin: (wMeta & NODE_MASK_WILDCARD_ORIGIN) >>> NODE_SHIFT_WILDCARD_ORIGIN,
        methodHandlers: wMethodHandlers,
        methodMask: nodeBuffer[wBase + NODE_OFFSET_METHOD_MASK]!,
      };
    }
  }

  // ── 캐시된 길이 ──
  const sLen = staticSegments.length;
  const pLen = paramNames.length;

  // ── 매칭 클로저 ──
  return function matchNode(
    segments: string[],
    segIdx: number,
    methodCode: number,
    hints: Uint8Array | undefined,
    decodeParams: boolean,
    normalizedPath: string,
  ): Result<CompiledMatchResult | null, RouterErrData> {
    if (segIdx === segments.length) {
      // 터미널 체크: 모든 세그먼트를 소비한 경우
      if (methodHandlers !== null && (methodMask & (1 << methodCode))) {
        const idx = methodHandlers.get(methodCode);

        if (idx !== undefined) {
          return { handlerIndex: idx, params: {} };
        }
      }
      // 와일드카드로 폴스루
    } else {
      const seg = segments[segIdx]!;

      // 정적 자식 시도
      for (let i = 0; i < sLen; i++) {
        if (staticSegments[i] === seg) {
          const r = staticMatchers[i]!(segments, segIdx + 1, methodCode, hints, decodeParams, normalizedPath);

          if (isErr(r) || r !== null) {
            return r;
          }

          break;
        }
      }

      // 파라미터 자식 시도
      if (pLen > 0) {
        let value: string;

        if (decodeParams && hints !== undefined && hints[segIdx] !== 0) {
          const d = decode(seg);

          if (isErr(d)) {
            return d;
          }

          value = d;
        } else {
          value = seg;
        }

        for (let i = 0; i < pLen; i++) {
          const tester = paramTesters[i];

          if (tester !== undefined) {
            try {
              if (!tester(value)) {
                continue;
              }
            } catch (e) {
              return err<RouterErrData>({
                kind: 'regex-timeout',
                message: e instanceof Error ? e.message : String(e),
              });
            }
          }

          const r = paramMatchers[i]!(segments, segIdx + 1, methodCode, hints, decodeParams, normalizedPath);

          if (isErr(r)) {
            return r;
          }

          if (r !== null) {
            r.params[paramNames[i]!] = value;

            return r;
          }
        }
      }
      // 와일드카드로 폴스루
    }

    // 와일드카드 체크 — 세그먼트 소비 여부와 무관하게 도달
    if (wildcard !== null && (wildcard.methodMask & (1 << methodCode))) {
      let ptr = 1;

      for (let i = 0; i < segIdx; i++) {
        ptr += segments[i]!.length + 1;
      }

      const suffix = normalizedPath.substring(ptr);

      if (!(wildcard.origin === 1 && suffix.length === 0)) {
        const idx = wildcard.methodHandlers.get(methodCode);

        if (idx !== undefined) {
          return { handlerIndex: idx, params: { [wildcard.name]: suffix } };
        }
      }
    }

    return null;
  };
}
