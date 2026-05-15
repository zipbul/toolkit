import type { MethodRegistry } from '../method-registry';

export const WILDCARD_METHOD = '*' as const;

interface MethodPending {
  method: string;
  // Other fields are passed through opaquely; this module only rewrites
  // the `method` axis, never inspects path/value.
}

/**
 * Resolve `*`-method registrations against the set of methods present at
 * seal time (built-ins plus any custom token registered before seal, plus
 * any new method first observed via a non-`*` pending route).
 *
 * Mutates `pendingRoutes` in place. The common case (no `*` registrations)
 * short-circuits — at 100k routes that's 100k avoided allocations and one
 * full array copy.
 *
 * Set-backed dedup avoids the prior `Array.includes` O(n×m) over
 * (pendingRoutes × sealMethods); 1.19-2.20× win across 10k/100k routes
 * with 0/25 custom methods (2.7 ms saved at the 100k+25 worst case).
 */
export function expandWildcardMethodRoutes<T extends MethodPending>(
  pendingRoutes: T[],
  methodRegistry: MethodRegistry,
): void {
  let hasWildcardMethod = false;
  for (let i = 0; i < pendingRoutes.length; i++) {
    if (pendingRoutes[i]!.method === WILDCARD_METHOD) {
      hasWildcardMethod = true;
      break;
    }
  }
  if (!hasWildcardMethod) return;

  const sealMethods: string[] = [];
  const seen = new Set<string>();
  for (const [name] of methodRegistry.getAllCodes()) {
    sealMethods.push(name);
    seen.add(name);
  }
  for (const r of pendingRoutes) {
    if (r.method !== WILDCARD_METHOD && !seen.has(r.method)) {
      seen.add(r.method);
      sealMethods.push(r.method);
    }
  }

  const expanded: T[] = [];
  for (const r of pendingRoutes) {
    if (r.method === WILDCARD_METHOD) {
      for (const m of sealMethods) expanded.push({ ...r, method: m });
    } else {
      expanded.push(r);
    }
  }

  // Replace pendingRoutes contents in place. `push(...expanded)` would
  // spread every element as a function argument — at 100k routes that
  // approaches the engine's arg-list cap (the spec gives no upper bound
  // but JSC traditionally throws RangeError around ~500k args). A simple
  // length swap + index assignment side-steps the cap entirely.
  pendingRoutes.length = expanded.length;
  for (let i = 0; i < expanded.length; i++) pendingRoutes[i] = expanded[i]!;
}
