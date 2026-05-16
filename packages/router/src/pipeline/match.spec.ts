/**
 * Unit spec for `match.ts`. Drives `MatchLayer.allowedMethods` directly
 * with hand-built MatchLayerDeps fixtures so each code path (static-mask
 * branch, dynamic walker branch, preprocess wiring) is exercised in
 * isolation — no Router.
 */
import { describe, expect, it } from 'bun:test';

import type { PathNormalizer } from '../codegen';
import { createMatchState } from '../matcher/match-state';
import type { MatchFn } from '../types';
import { MatchLayer } from './match';

interface LayerInput {
  normalize?: PathNormalizer;
  active?: ReadonlyArray<readonly [string, number]>;
  trees?: Array<MatchFn | null>;
  mask?: Record<string, number>;
}

function makeLayer(input: LayerInput = {}): MatchLayer {
  return new MatchLayer({
    normalizePath: input.normalize ?? ((path: string) => path),
    matchState: createMatchState(2),
    activeMethodCodes: input.active ?? [],
    trees: input.trees ?? [],
    staticPathMethodMask: input.mask ?? (Object.create(null) as Record<string, number>),
  });
}

describe('allowedMethods — static-mask branch', () => {
  it('returns the methods encoded in staticPathMethodMask for a known path', () => {
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = (1 << 0) | (1 << 2);
    const layer = makeLayer({
      mask,
      active: [['GET', 0] as const, ['POST', 1] as const, ['DELETE', 2] as const],
    });
    expect([...layer.allowedMethods('/x')].sort()).toEqual(['DELETE', 'GET']);
  });

  it('iterates bits in low-to-high order via lowest-set-bit extraction', () => {
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = (1 << 1) | (1 << 3) | (1 << 5);
    const layer = makeLayer({
      mask,
      active: [
        ['A', 0] as const,
        ['B', 1] as const,
        ['C', 2] as const,
        ['D', 3] as const,
        ['E', 4] as const,
        ['F', 5] as const,
      ],
    });
    expect([...layer.allowedMethods('/x')].sort()).toEqual(['B', 'D', 'F']);
  });

  it('returns [] when the mask is absent for the queried path', () => {
    const layer = makeLayer();
    expect(layer.allowedMethods('/unknown')).toEqual([]);
  });

  it('skips bits whose code does not appear in activeMethodCodes', () => {
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = (1 << 0) | (1 << 7);
    const layer = makeLayer({
      mask,
      active: [['GET', 0] as const],
    });
    expect(layer.allowedMethods('/x')).toEqual(['GET']);
  });
});

describe('allowedMethods — dynamic walker branch', () => {
  it('returns methods whose tree walker accepts the path', () => {
    const acceptingWalker: MatchFn = () => true;
    const rejectingWalker: MatchFn = () => false;
    const trees: Array<MatchFn | null> = [];
    trees[0] = acceptingWalker;
    trees[1] = rejectingWalker;
    const layer = makeLayer({
      trees,
      active: [['GET', 0] as const, ['POST', 1] as const],
    });
    expect(layer.allowedMethods('/dynamic/path')).toEqual(['GET']);
  });

  it('skips methods whose code lacks a tree (null or undefined)', () => {
    const trees: Array<MatchFn | null> = [];
    trees[1] = () => true;
    const layer = makeLayer({
      trees,
      active: [['GET', 0] as const, ['POST', 1] as const],
    });
    expect(layer.allowedMethods('/x')).toEqual(['POST']);
  });

  it('skips methods already represented in the static mask (no duplicate output)', () => {
    const acceptingWalker: MatchFn = () => true;
    const trees: Array<MatchFn | null> = [];
    trees[0] = acceptingWalker;
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = 1 << 0;
    const layer = makeLayer({
      trees,
      mask,
      active: [['GET', 0] as const],
    });
    expect(layer.allowedMethods('/x')).toEqual(['GET']);
  });
});

describe('allowedMethods — normalize preprocessing wiring', () => {
  it('applies normalizePath to the input before mask + walker dispatch', () => {
    const recorded: string[] = [];
    const normalize: PathNormalizer = (path) => {
      recorded.push(path);
      return path.toLowerCase();
    };
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = 1 << 0;
    const layer = makeLayer({
      normalize,
      mask,
      active: [['GET', 0] as const],
    });
    expect(layer.allowedMethods('/X')).toEqual(['GET']);
    expect(recorded).toEqual(['/X']);
  });
});

describe('allowedMethods — combined branches', () => {
  it('combines static-mask methods with dynamic-walker methods without duplicates', () => {
    const acceptingWalker: MatchFn = () => true;
    const trees: Array<MatchFn | null> = [];
    trees[1] = acceptingWalker;
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = 1 << 0;
    const layer = makeLayer({
      trees,
      mask,
      active: [['GET', 0] as const, ['POST', 1] as const],
    });
    expect([...layer.allowedMethods('/x')].sort()).toEqual(['GET', 'POST']);
  });
});
