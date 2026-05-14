import type { PathPart } from './path-parser';

import { OptionalParamDefaults } from './optional-param-defaults';

export interface ExpandedRoute {
  parts: PathPart[];
  handlerIndex: number;
  /**
   * True only for concrete routes produced by optional-segment dropping.
   * The all-present variant and routes with no optionals at all are false.
   * Drives prefix-index alias detection: alias success is permitted only in
   * the optional-expansion context.
   */
  isOptionalExpansion: boolean;
}

interface OptionalCollection {
  indices: number[];
  names: string[];
}

/**
 * Expand a route's optional params into the cartesian set of variants the
 * matcher must register. For `/:a?/:b?` this yields four variants — both
 * present, only `:a`, only `:b`, neither — all sharing one handlerIndex.
 *
 * Records the omitted-param names against `optionalDefaults` so the matcher
 * can fill them with the configured optional-default value at match time.
 */
export function expandOptional(
  parts: PathPart[],
  handlerIndex: number,
  optionalDefaults: OptionalParamDefaults,
): ExpandedRoute[] {
  // Fast path — overwhelmingly common: most paths carry no `?` optional.
  // Skip the OptionalCollection alloc entirely by scanning once and
  // bailing on the first hit.
  let firstOptional = -1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.type === 'param' && p.optional) { firstOptional = i; break; }
  }
  if (firstOptional === -1) {
    return [{ parts, handlerIndex, isOptionalExpansion: false }];
  }

  // Slow path — rebuild the full collection now that we know there is
  // at least one optional segment.
  const collection = collectOptionalIndices(parts, firstOptional);
  optionalDefaults.record(handlerIndex, collection.names);
  return enumerateExpansions(parts, handlerIndex, collection.indices);
}

/** Walk parts from `start` onward, recording every optional param. */
function collectOptionalIndices(parts: PathPart[], start: number): OptionalCollection {
  const indices: number[] = [];
  const names: string[] = [];

  for (let i = start; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'param' && part.optional) {
      indices.push(i);
      names.push(part.name);
    }
  }

  return { indices, names };
}

function createStaticPart(value: string): PathPart {
  // Re-calculate segments from the value. This ensures that even after
  // slash-trimming or merging, the segments array remains accurate.
  const body = value.length > 1 ? value.slice(1) : '';
  const segments = body === '' ? [] : body.split('/');

  return { type: 'static', value, segments };
}

/**
 * Emit one ExpandedRoute per subset of optionals to keep. Index 0 is the
 * "all-present" variant; subsequent indices iterate the 2^N - 1 non-empty
 * drop-subsets via bitmask. Empty results collapse to root `/`.
 */
function enumerateExpansions(
  parts: PathPart[],
  handlerIndex: number,
  optionalIndices: number[],
): ExpandedRoute[] {
  const result: ExpandedRoute[] = [];

  // Full path (all optionals present, marked as required for insertion).
  const fullParts = parts.map(p =>
    p.type === 'param' && p.optional ? { ...p, optional: false } : p,
  );
  result.push({ parts: fullParts, handlerIndex, isOptionalExpansion: false });

  // Iterate the 2^N - 1 non-empty subsets of "which optionals to drop".
  for (let bit = 1; bit < (1 << optionalIndices.length); bit++) {
    const filtered: PathPart[] = [];

    for (let i = 0; i < parts.length; i++) {
      let skip = false;

      for (let j = 0; j < optionalIndices.length; j++) {
        if (optionalIndices[j] === i && (bit & (1 << j))) {
          skip = true;
          break;
        }
      }

      if (skip) {
        // Invariant A — drop-time slash trim:
        // When a dropped optional follows a static that ends in `/`, the
        // trailing slash must be stripped so e.g. `/users/` + dropped `:id`
        // doesn't produce a route ending in `/users/`. This is *not*
        // redundant with the post-merge `//` collapse below — the two cover
        // disjoint cases (this one removes a single trailing `/`; the
        // collapse fixes `//` produced by concatenating two static parts).
        if (filtered.length > 0) {
          const prev = filtered[filtered.length - 1]!;

          if (prev.type === 'static' && prev.value.endsWith('/')) {
            const trimmed = prev.value.slice(0, -1);

            if (trimmed.length > 0) {
              filtered[filtered.length - 1] = createStaticPart(trimmed);
            } else {
              filtered.pop();
            }
          }
        }

        continue;
      }

      const part = parts[i]!;

      if (part.type === 'param' && part.optional) {
        filtered.push({ ...part, optional: false });
      } else {
        filtered.push(part);
      }
    }

    const merged = mergeStaticParts(filtered);

    if (merged.length > 0) {
      result.push({ parts: merged, handlerIndex, isOptionalExpansion: true });
    } else {
      // Every required segment was an optional that got dropped (e.g. `/:id?`
      // with `:id` omitted). The intended URL is `/`, not nothing — registering
      // an empty parts list would silently fail-match `/`.
      result.push({ parts: [createStaticPart('/')], handlerIndex, isOptionalExpansion: true });
    }
  }

  return result;
}

/**
 * Coalesce consecutive static parts into one and normalize any `//` produced
 * by the concatenation.
 *
 * Invariant B — post-merge `//` collapse:
 * Two static segments produced by `enumerateExpansions` (e.g. a leading `/`
 * + a trimmed prev that already ends `/`) can join into `…//…`. The replace
 * collapses every such double slash. This is *not* redundant with invariant A
 * (slash trim during drop) — that one fires before merge, this one fires
 * after, and the two together are property-tested in router.property.test.
 */
function mergeStaticParts(parts: PathPart[]): PathPart[] {
  const result: PathPart[] = [];

  for (const part of parts) {
    if (part.type === 'static' && result.length > 0) {
      const prev = result[result.length - 1]!;

      if (prev.type === 'static') {
        let merged = prev.value + part.value;

        merged = merged.replace(/\/\//g, '/');
        result[result.length - 1] = createStaticPart(merged);

        continue;
      }
    }

    result.push(part);
  }

  return result;
}
