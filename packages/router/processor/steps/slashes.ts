import type { ProcessorContext } from '../context';

export function collapseSlashes(ctx: ProcessorContext): void {
  const result: string[] = [];

  for (let i = 0; i < ctx.segments.length; i++) {
    const segment = ctx.segments[i];

    if (segment !== undefined && segment !== '') {
      result.push(segment);
    }
  }

  ctx.segments = result;
}

export function handleTrailingSlashOptions(ctx: ProcessorContext): void {
  if (ctx.config.ignoreTrailingSlash === true && ctx.segments.length > 0 && ctx.segments[ctx.segments.length - 1] === '') {
    ctx.segments.pop();
  }
}
