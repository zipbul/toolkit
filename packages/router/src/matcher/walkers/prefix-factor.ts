import type { SegmentNode, TenantFactor } from '../../tree';
import type { DecoderFn, MatchFn, MatchState } from '../../types';

import { detectTenantFactor, setTenantFactor } from '../../tree';
import { walkSharedSubtree } from './factored';

function detectPrefixedFactorDry(
  root: SegmentNode,
): { prefixSegs: string[]; factor: TenantFactor; deepNode: SegmentNode } | null {
  const prefixSegs: string[] = [];
  let cur: SegmentNode = root;

  for (let depth = 0; depth < 32; depth++) {
    if (cur.paramChild !== null || cur.wildcardStore !== null || cur.store !== null || cur.staticPrefix !== null) {
      break;
    }

    let onlyKey: string | null = null;
    let onlyChild: SegmentNode | null = null;
    let count = 0;

    if (cur.singleChildKey !== null && cur.singleChildNext !== null && cur.staticChildren === null) {
      onlyKey = cur.singleChildKey;
      onlyChild = cur.singleChildNext;
      count = 1;
    } else if (cur.staticChildren !== null) {
      for (const k in cur.staticChildren) {
        count++;
        if (count > 1) {
          break;
        }
        onlyKey = k;
        onlyChild = cur.staticChildren[k]!;
      }
    }

    if (count !== 1 || onlyKey === null || onlyChild === null) {
      break;
    }

    prefixSegs.push(onlyKey);
    cur = onlyChild;
  }

  if (prefixSegs.length === 0) {
    return null;
  }

  const factor = detectTenantFactor(cur);
  if (factor === null) {
    return null;
  }

  return { prefixSegs, factor, deepNode: cur };
}

function applyPrefixedFactor(deepNode: SegmentNode, factor: TenantFactor): void {
  setTenantFactor(deepNode, factor);
  deepNode.staticChildren = null;
  deepNode.singleChildKey = null;
  deepNode.singleChildNext = null;
}

function tryDetectPrefixedFactor(root: SegmentNode): { prefixSegs: string[]; factor: TenantFactor } | null {
  const dry = detectPrefixedFactorDry(root);
  if (dry === null) {
    return null;
  }
  applyPrefixedFactor(dry.deepNode, dry.factor);
  return { prefixSegs: dry.prefixSegs, factor: dry.factor };
}

function createPrefixedFactoredWalker(
  decoder: DecoderFn,
  prefixSegs: string[],
  keyToTerminal: Map<string, number>,
  sharedNext: SegmentNode,
): MatchFn {
  const prefixCount = prefixSegs.length;
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    const afterPrefix = consumeFixedPrefix(prefixSegs, prefixCount, url, 1, len);
    if (afterPrefix < 0 || afterPrefix >= len) {
      return false;
    }

    const keyEnd = scanSegmentEnd(url, afterPrefix, len);
    const seg = keyEnd === afterPrefix ? '' : url.substring(afterPrefix, keyEnd);
    const looked = keyToTerminal.get(seg);
    if (looked === undefined) {
      return false;
    }

    return walkSharedSubtree(sharedNext, url, keyEnd === len ? len : keyEnd + 1, len, looked, decoder, state);
  };
}

interface PrefixedFactorEntry {
  prefixSegs: string[];
  keyToTerminal: Map<string, number>;
  sharedNext: SegmentNode;
}

function tryDetectMultiPrefixFactor(root: SegmentNode): Map<string, PrefixedFactorEntry> | null {
  if (root.paramChild !== null || root.wildcardStore !== null || root.store !== null || root.staticPrefix !== null) {
    return null;
  }

  const childMap = root.staticChildren;
  if (childMap === null) {
    return null;
  }

  let keyCount = 0;
  for (const _k in childMap) {
    keyCount++;
    if (keyCount > 1) {
      break;
    }
  }
  if (keyCount < 2) {
    return null;
  }

  type Pending =
    | { type: 'prefixed'; key: string; deepNode: SegmentNode; factor: TenantFactor; prefixSegs: string[] }
    | { type: 'direct'; key: string; child: SegmentNode; factor: TenantFactor };
  const pending: Pending[] = [];
  for (const k in childMap) {
    const child = childMap[k]!;
    const dryPrefixed = detectPrefixedFactorDry(child);
    if (dryPrefixed !== null) {
      pending.push({
        type: 'prefixed',
        key: k,
        deepNode: dryPrefixed.deepNode,
        factor: dryPrefixed.factor,
        prefixSegs: dryPrefixed.prefixSegs,
      });
      continue;
    }
    const direct = detectTenantFactor(child);
    if (direct !== null) {
      pending.push({ type: 'direct', key: k, child, factor: direct });
      continue;
    }
    return null;
  }

  const out = new Map<string, PrefixedFactorEntry>();
  for (const p of pending) {
    if (p.type === 'prefixed') {
      applyPrefixedFactor(p.deepNode, p.factor);
      out.set(p.key, {
        prefixSegs: p.prefixSegs,
        keyToTerminal: p.factor.keyToTerminal,
        sharedNext: p.factor.sharedNext,
      });
    } else {
      applyPrefixedFactor(p.child, p.factor);
      out.set(p.key, {
        prefixSegs: [],
        keyToTerminal: p.factor.keyToTerminal,
        sharedNext: p.factor.sharedNext,
      });
    }
  }
  return out;
}

function createMultiPrefixFactoredWalker(decoder: DecoderFn, childMap: Map<string, PrefixedFactorEntry>): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    if (url === '/') {
      return false;
    }

    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) {
      slash1++;
    }
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const entry = childMap.get(firstSeg);
    if (entry === undefined) {
      return false;
    }

    const afterPrefix = consumeFixedPrefix(
      entry.prefixSegs,
      entry.prefixSegs.length,
      url,
      slash1 === len ? len : slash1 + 1,
      len,
    );
    if (afterPrefix < 0 || afterPrefix >= len) {
      return false;
    }

    const keyEnd = scanSegmentEnd(url, afterPrefix, len);
    const seg = keyEnd === afterPrefix ? '' : url.substring(afterPrefix, keyEnd);
    const looked = entry.keyToTerminal.get(seg);
    if (looked === undefined) {
      return false;
    }

    return walkSharedSubtree(entry.sharedNext, url, keyEnd === len ? len : keyEnd + 1, len, looked, decoder, state);
  };
}

function consumeFixedPrefix(
  prefixSegs: ReadonlyArray<string>,
  prefixCount: number,
  url: string,
  pos: number,
  len: number,
): number {
  for (let i = 0; i < prefixCount; i++) {
    const seg = prefixSegs[i]!;
    const segLen = seg.length;
    const after = pos + segLen;
    if (after > len) {
      return -1;
    }
    if (!url.startsWith(seg, pos)) {
      return -1;
    }
    if (after < len && url.charCodeAt(after) !== 47) {
      return -1;
    }
    pos = after === len ? len : after + 1;
  }
  return pos;
}

function scanSegmentEnd(url: string, pos: number, len: number): number {
  let end = pos;
  while (end < len && url.charCodeAt(end) !== 47) {
    end++;
  }
  return end;
}

export {
  consumeFixedPrefix,
  createMultiPrefixFactoredWalker,
  createPrefixedFactoredWalker,
  scanSegmentEnd,
  tryDetectMultiPrefixFactor,
  tryDetectPrefixedFactor,
};
