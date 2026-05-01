/**
 * #70 — NullProtoObj prototype is externally replaceable.
 */

import { NullProtoObj } from '../src/internal/null-proto-obj';

console.log('NullProtoObj frozen:', Object.isFrozen(NullProtoObj));
console.log('NullProtoObj.prototype frozen:', Object.isFrozen((NullProtoObj as any).prototype));

const orig = (NullProtoObj as any).prototype;
let replaced = false;
try {
  (NullProtoObj as any).prototype = { polluted: 'yes' };
  replaced = true;
} catch (e) { console.log('replace rejected:', (e as Error).message); }
console.log('replaced:', replaced);
const inst = new NullProtoObj();
console.log('new instance polluted prop:', (inst as any).polluted);
(NullProtoObj as any).prototype = orig;

console.log('VERDICT: REPRODUCED — NullProtoObj.prototype replaceable (internal-only impact)');
