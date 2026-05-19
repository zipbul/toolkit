import type { SegmentNode } from '../tree';

import { WildcardOrigin } from '../tree';

export interface WildCodegenEntry {
  prefix: string;
  wildcardOrigin: WildcardOrigin;
  wildcardName: string;
  wildcardStore: number;
}

export function detectWildCodegenSpec(root: SegmentNode): WildCodegenEntry[] | null {
  if (root.paramChild !== null || root.wildcardStore !== null || root.store !== null) {
    return null;
  }
  if (root.staticChildren === null) {
    return null;
  }

  const entries: WildCodegenEntry[] = [];

  for (const key in root.staticChildren) {
    const child = root.staticChildren[key]!;

    if (child.staticChildren !== null) {
      return null;
    }
    if (child.paramChild !== null) {
      return null;
    }
    if (child.store !== null) {
      return null;
    }
    if (child.wildcardStore === null) {
      return null;
    }

    entries.push({
      prefix: key,
      wildcardOrigin: child.wildcardOrigin!,
      wildcardName: child.wildcardName!,
      wildcardStore: child.wildcardStore,
    });
  }

  if (entries.length === 0) {
    return null;
  }

  return entries;
}
