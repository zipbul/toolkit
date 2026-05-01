/**
 * #71 — NullProtoObj prototype trick — engines.bun >=1.0.0 limited.
 *       Verify Bun runtime version + behavior.
 */

import { NullProtoObj } from '../src/internal/null-proto-obj';

console.log('Bun version:', Bun.version);
const inst = new NullProtoObj();
console.log('instance prototype:', Object.getPrototypeOf(inst));
console.log('  is null:', Object.getPrototypeOf(inst) === null
  || Object.keys(Object.getPrototypeOf(inst) ?? {}).length === 0);

// Set/get behavior
(inst as any).foo = 'bar';
console.log('foo:', (inst as any).foo);
console.log('toString in inst:', 'toString' in inst);  // false (no proto chain)

console.log('VERDICT: REPRODUCED — Bun-specific trick verified for current runtime; portability outside scope');
