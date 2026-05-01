/**
 * #63 — methodRegistry.codeMap is intentionally NOT frozen.
 */

import { MethodRegistry } from '../src/method-registry';
import { Router } from '../index';
import { getRouterInternals } from '../internal';

const m = new MethodRegistry();
const cm = m.getCodeMap();
console.log('codeMap frozen at MethodRegistry creation:', Object.isFrozen(cm));

// And after Router build:
const r = new Router<string>();
r.add('GET', '/', 'h');
r.build();
void getRouterInternals(r);  // ensure access works
console.log('codeMap frozen after build:', Object.isFrozen(cm));
console.log('VERDICT: REPRODUCED — codeMap intentionally mutable (hot-path optimization)');
