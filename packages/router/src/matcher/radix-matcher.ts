import type { RadixNode } from '../builder/radix-node';
import type { MatchState } from './match-state';

export type RadixMatchFn = (
  url: string,
  startIndex: number,
  state: MatchState,
) => boolean;

export function countNodes(root: RadixNode): number {
  let count = 1;

  if (root.inert !== null) {
    for (const key in root.inert) {
      count += countNodes(root.inert[key as unknown as number]!);
    }
  }

  let param = root.params;

  while (param !== null) {
    count++;

    if (param.inert !== null) {
      count += countNodes(param.inert);
    }

    param = param.next;
  }

  return count;
}
