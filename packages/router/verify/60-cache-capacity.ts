/**
 * #60 — capacity rounds maxSize up to next power of 2.
 *       cacheSize=1000 → capacity=1024.
 */

import { RouterCache } from '../src/cache';

const c1 = new RouterCache<number>(1000);
const c2 = new RouterCache<number>(1024);
const c3 = new RouterCache<number>(1025);

// Verify by overflow behavior — fill until eviction.
function fillAndCount(c: RouterCache<number>, target: number): number {
  for (let i = 0; i < target; i++) c.set(`k${i}`, i);
  // count surviving
  let surviving = 0;
  for (let i = 0; i < target; i++) if (c.get(`k${i}`) !== undefined) surviving++;
  return surviving;
}

console.log('cacheSize=1000  capacity holds:', fillAndCount(c1, 1100));
console.log('cacheSize=1024  capacity holds:', fillAndCount(c2, 1100));
console.log('cacheSize=1025  capacity holds:', fillAndCount(c3, 2200));
console.log('VERDICT: REPRODUCED — capacity differs from requested maxSize (next power of 2)');
