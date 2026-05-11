import { RESERVED_KEYS } from '../constants';
import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

/**
 * Detect prototype-pollution attacks on a user-supplied object.
 *
 * `{ __proto__: x }` literal sets the prototype rather than an own property,
 * so `Object.entries()` misses it. Inspect the prototype chain explicitly.
 *
 * @returns `true` when the chain is safe; `false` (and pushes a violation)
 * when an override is detected.
 */
export function checkPrototypeChain(
  obj: object,
  path: string,
  violations: ViolationDetail[],
): boolean {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype) {
    violations.push({
      reason: HelmetErrorReason.ReservedKeyDenied,
      path: `${path}.__proto__`,
      message: 'reserved key denied (__proto__ override on input object)',
    });
    return false;
  }
  return true;
}

/**
 * Check that an own property name is not a reserved key (`__proto__`,
 * `constructor`, `prototype`).
 *
 * @returns `true` when the name is safe; `false` (and pushes a violation)
 * when reserved.
 */
export function checkReservedKey(
  name: string,
  path: string,
  violations: ViolationDetail[],
): boolean {
  if (RESERVED_KEYS.has(name)) {
    violations.push({
      reason: HelmetErrorReason.ReservedKeyDenied,
      path,
      message: 'reserved key denied (prototype pollution guard)',
    });
    return false;
  }
  return true;
}
