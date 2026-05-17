/**
 * Unit specs for `segment-compile.ts` — the per-branch emit helpers
 * each return a plain JS string fragment. These specs assert the exact
 * substrings so a regression in any one fragment surfaces here instead
 * of through a downstream walker mismatch.
 */
import { describe, expect, it } from 'bun:test';

import {
  emitMultiWildcardTerminal,
  emitRootSlashTerminal,
  emitStrictTerminal,
  emitTesterCheck,
  emitWildcardStore,
} from './segment-compile';
import type { SegmentNode } from '../tree';
import { createSegmentNode } from '../tree';

describe('emitTesterCheck', () => {
  it('returns an empty string when there is no tester (testerIdx === -1)', () => {
    expect(emitTesterCheck(-1, 'pos0', 's0')).toBe('');
  });

  it('emits a `testers[i](decoder(...)) !== TESTER_PASS` guard when a tester is present', () => {
    const out = emitTesterCheck(3, 'pos0', 's0');
    expect(out).toContain('testers[3]');
    expect(out).toContain('decoder(url.substring(pos0, s0 === -1 ? len : s0))');
    expect(out).toContain('TESTER_PASS');
    expect(out).toContain('return false');
  });
});

const emptyCtx = () => ({ bail: false, testers: [], pendingParams: [] });

describe('emitStrictTerminal', () => {
  it('emits the end-of-URL strict terminal block with the supplied store index', () => {
    const out = emitStrictTerminal(emptyCtx(), 'pos0', 's0', '', 7);
    expect(out).toContain('s0 === -1 && pos0 < len');
    expect(out).toContain('state.handlerIndex = 7');
    expect(out).toContain('return true');
  });

  it('inlines the tester-check fragment into the strict-terminal body', () => {
    const tester = emitTesterCheck(2, 'pos0', 's0');
    const out = emitStrictTerminal(emptyCtx(), 'pos0', 's0', tester, 5);
    expect(out).toContain('testers[2]');
    expect(out).toContain('state.handlerIndex = 5');
  });
});

describe('emitMultiWildcardTerminal', () => {
  it('emits two paramOffsets writes for the leading param + multi tail', () => {
    const out = emitMultiWildcardTerminal(emptyCtx(), 'pos0', 's0', '', 11);
    expect(out).toContain('state.paramOffsets[0] = pos0');
    expect(out).toContain('state.paramOffsets[1] = s0');
    expect(out).toContain('state.paramOffsets[2] = s0 + 1');
    expect(out).toContain('state.paramOffsets[3] = len');
    expect(out).toContain('state.paramCount = 2');
    expect(out).toContain('state.handlerIndex = 11');
  });

  it('requires a non-empty tail (`s0 + 1 < len`) before matching', () => {
    const out = emitMultiWildcardTerminal(emptyCtx(), 'pos0', 's0', '', 11);
    expect(out).toContain('s0 + 1 < len');
  });
});

describe('emitWildcardStore', () => {
  it('emits the inclusive `<= len` guard for star-origin wildcards', () => {
    const node: SegmentNode = { ...createSegmentNode(), wildcardStore: 4, wildcardOrigin: 'star' };
    const out = emitWildcardStore(emptyCtx(), node, 'pos0');
    expect(out).toContain('pos0 <= len');
    expect(out).toContain('state.handlerIndex = 4');
  });

  it('emits the exclusive `< len` guard for multi-origin wildcards', () => {
    const node: SegmentNode = { ...createSegmentNode(), wildcardStore: 8, wildcardOrigin: 'multi' };
    const out = emitWildcardStore(emptyCtx(), node, 'pos0');
    expect(out).toContain('pos0 < len');
    expect(out).not.toContain('pos0 <= len');
  });
});

describe('emitRootSlashTerminal', () => {
  it('emits a store assignment when root carries a store', () => {
    const root = createSegmentNode();
    root.store = 12;
    const out = emitRootSlashTerminal(root);
    expect(out).toContain('state.handlerIndex = 12');
    expect(out).toContain('return true');
  });

  it('emits a star-wildcard capture when root has only a wildcard star', () => {
    const root = createSegmentNode();
    root.wildcardStore = 9;
    root.wildcardOrigin = 'star';
    const out = emitRootSlashTerminal(root);
    expect(out).toContain('state.paramOffsets[0] = 1');
    expect(out).toContain('state.paramOffsets[1] = 1');
    expect(out).toContain('state.paramCount = 1');
    expect(out).toContain('state.handlerIndex = 9');
  });

  it('emits `return false` when root has neither store nor a star wildcard', () => {
    const root = createSegmentNode();
    expect(emitRootSlashTerminal(root)).toContain('return false');
  });
});
