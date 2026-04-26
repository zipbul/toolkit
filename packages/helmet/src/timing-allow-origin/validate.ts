import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

const TAO_RE = /^(\*|null|https?:\/\/[^\s,]+)$/;

export function validateTimingAllowOrigin(
  values: readonly string[],
  path: string,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'string' || !TAO_RE.test(v)) {
      out.push({
        reason: HelmetErrorReason.InvalidTimingAllowOrigin,
        path: `${path}[${i}]`,
        message:
          "Timing-Allow-Origin entries must be '*', 'null', or a fully-qualified http(s) origin",
      });
    }
  }
  return out;
}
