import type { ProcessorContext } from '../context';

export function toLowerCase(ctx: ProcessorContext): void {
  for (let i = 0; i < ctx.segments.length; i++) {
    const segment = ctx.segments[i];

    if (typeof segment === 'string' && segment.length > 0) {
      ctx.segments[i] = segment.toLowerCase();
    }
  }
}
