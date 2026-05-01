/**
 * #62 — getOrCreate distinguishes 0 (GET code) from undefined (not registered).
 */

import { MethodRegistry } from '../src/method-registry';
import { isErr } from '@zipbul/result';

const m = new MethodRegistry();

const get = m.getOrCreate('GET');
console.log('getOrCreate GET (existing, code 0):', get);
console.log('  is Err:', isErr(get as any));

const custom1 = m.getOrCreate('CUSTOM');
console.log('getOrCreate CUSTOM (new):', custom1);

const custom2 = m.getOrCreate('CUSTOM');
console.log('getOrCreate CUSTOM (existing, code 7):', custom2);

const ok = !isErr(get as any) && (get as any) === 0
  && !isErr(custom1 as any) && (custom1 as any) === 7
  && (custom2 as any) === 7;
console.log('VERDICT:', ok
  ? 'REFUTED — code 0 (GET) and undefined correctly distinguished'
  : 'REPRODUCED');
