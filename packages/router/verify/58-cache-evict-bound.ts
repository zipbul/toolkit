/**
 * #58 — RouterCache.evict has no iteration bound. Verify it terminates
 *       when called under all-used scenario.
 */

import { RouterCache } from '../src/cache';

const cache = new RouterCache<{ v: number }>(4);

// Fill all slots with `used: true` (set sets used=true automatically).
for (let i = 0; i < 4; i++) cache.set(`k${i}`, { v: i });

// Now insert a 5th to trigger eviction. All entries used=true → first pass
// sets used=false → second pass evicts first.
const start = Date.now();
cache.set('k5', { v: 5 });
const elapsed = Date.now() - start;
console.log('evict path took', elapsed, 'ms');

// Verify state.
console.log('k0:', cache.get('k0'));
console.log('k5:', cache.get('k5'));

console.log('VERDICT:', elapsed < 50
  ? 'REFUTED — evict terminates promptly; no infinite loop'
  : 'REPRODUCED');
