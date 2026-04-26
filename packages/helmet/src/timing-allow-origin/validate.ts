import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

// Resource Timing §10.3: Timing-Allow-Origin entries are an ASCII serialised
// origin (scheme + "://" + host + optional ":port"), `*`, or `null`.
// Path, query, fragment, whitespace, comma are not allowed.
const TAO_RE = /^(?:\*|null|https?:\/\/[A-Za-z0-9.\-]+(?::\d{1,5})?)$/;

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
          "Timing-Allow-Origin entries must be '*', 'null', or a serialised origin (scheme://host[:port])",
      });
    }
  }
  return out;
}
