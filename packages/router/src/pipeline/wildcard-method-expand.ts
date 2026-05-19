import type { MethodRegistry } from '../method-registry';

const WILDCARD_METHOD = '*' as const;

interface MethodPending {
  method: string;
}

function expandWildcardMethodRoutes<T extends MethodPending>(pendingRoutes: T[], methodRegistry: MethodRegistry): void {
  let hasWildcardMethod = false;
  for (let i = 0; i < pendingRoutes.length; i++) {
    if (pendingRoutes[i]!.method === WILDCARD_METHOD) {
      hasWildcardMethod = true;
      break;
    }
  }
  if (!hasWildcardMethod) {
    return;
  }

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
      for (const m of sealMethods) {
        expanded.push({ ...r, method: m });
      }
    } else {
      expanded.push(r);
    }
  }

  pendingRoutes.length = expanded.length;
  for (let i = 0; i < expanded.length; i++) {
    pendingRoutes[i] = expanded[i]!;
  }
}

export { expandWildcardMethodRoutes, WILDCARD_METHOD };
