import type { ProcessorContext } from '../context';

export function resolveDotSegments(ctx: ProcessorContext): void {
  const stack: string[] = [];

  for (const seg of ctx.segments) {
    const lower = seg.toLowerCase();
    const isDot = lower === '.' || lower === '%2e';
    const isDotDot = lower === '..' || lower === '%2e%2e';

    if (isDot) {
      continue;
    }

    if (isDotDot) {
      if (stack.length > 0) {
        stack.pop();
      }

      continue;
    }

    stack.push(seg);
  }

  ctx.segments = stack;
}
