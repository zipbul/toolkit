/**
 * #24 — `if (posVar <= len)` in star-wildcard emit is trivially true.
 * Verify by inspecting emitted JS for the guard text.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/files/*p', 'wild');
r.build();

const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();

// Star wildcard at root would emit posVar <= len; actual emit may differ.
// Look for `<= len` in matchImpl source.
const hasLeLen = /pos\d+\s*<=\s*len/.test(src);
console.log('emit contains "posN <= len":', hasLeLen);
console.log('matchImpl preview:', src.slice(0, 600));
console.log('VERDICT:', hasLeLen
  ? 'REPRODUCED — trivially-true guard present'
  : 'REFUTED — guard not emitted in this shape');
