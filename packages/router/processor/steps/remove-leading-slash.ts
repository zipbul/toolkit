import type { ProcessorContext } from '../context';

export function removeLeadingSlash(ctx: ProcessorContext): void {
  if (ctx.path.charCodeAt(0) === 47) {
    ctx.path = ctx.path.slice(1);
  }
}
