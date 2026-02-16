import type { ProcessorContext } from '../context';

export function splitPath(ctx: ProcessorContext): void {
  const segs = ctx.path.split('/');

  if (segs.length === 1 && segs[0] === '') {
    ctx.segments = [];
  } else {
    ctx.segments = segs;
  }
}
