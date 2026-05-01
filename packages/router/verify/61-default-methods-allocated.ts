/**
 * #61 — DEFAULT_METHODS (7 entries) registered eagerly in MethodRegistry constructor.
 */

import { MethodRegistry } from '../src/method-registry';

const m = new MethodRegistry();
console.log('initial size (default methods):', m.size);
console.log('GET    code:', m.get('GET'));
console.log('HEAD   code:', m.get('HEAD'));
console.log('CUSTOM code:', m.get('CUSTOM'));   // not registered

console.log('VERDICT:', m.size === 7 && m.get('GET') === 0 && m.get('HEAD') === 6
  ? 'REPRODUCED — 7 standard methods always allocated'
  : 'PARTIAL');
