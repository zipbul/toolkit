import type { ProcessorContext } from '../context';

export function stripQuery(ctx: ProcessorContext): void {
  const queryIdx = ctx.path.indexOf('?');

  if (queryIdx !== -1) {
    ctx.path = ctx.path.slice(0, queryIdx);
  }
}
