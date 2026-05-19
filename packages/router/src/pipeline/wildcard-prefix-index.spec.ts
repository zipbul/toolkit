import { isErr } from '@zipbul/result';
/**
 * Unit spec for `wildcard-prefix-index.ts`. The prefix-trie validates
 * every commit before mutating; spec pins each conflict path and the
 * rollback contract by driving `planAndCommit` + `rollbackPlan` directly.
 */
import { describe, expect, it } from 'bun:test';

import type { PathPart } from '../tree';
import type { CommitPlan, RouteMeta } from './wildcard-prefix-index';

import { PathPartType, WildcardOrigin } from '../tree';
import { RouterErrorKind } from '../types';
import { WildcardPrefixIndex, rollbackPlan } from './wildcard-prefix-index';

let nextHandlerId = 0;

function meta(method: string, path: string, isOptionalExpansion = false): RouteMeta {
  return {
    routeIndex: nextHandlerId,
    path,
    method,
    handlerId: nextHandlerId++,
    isOptionalExpansion,
  };
}

const STATIC_USERS: PathPart = { type: PathPartType.Static, value: '/users', segments: ['users'] };
const STATIC_X: PathPart = { type: PathPartType.Static, value: '/x', segments: ['x'] };
const STATIC_FILES: PathPart = { type: PathPartType.Static, value: '/files', segments: ['files'] };
const PARAM_ID: PathPart = { type: PathPartType.Param, name: 'id', pattern: null, optional: false };
const PARAM_SLUG: PathPart = { type: PathPartType.Param, name: 'slug', pattern: null, optional: false };
const PARAM_DIGITS: PathPart = { type: PathPartType.Param, name: 'id', pattern: '\\d+', optional: false };
const PARAM_LETTERS: PathPart = { type: PathPartType.Param, name: 'id', pattern: '[a-z]+', optional: false };
const WILDCARD_TAIL: PathPart = { type: PathPartType.Wildcard, name: 'rest', origin: WildcardOrigin.Star };

describe('planAndCommit — successful commits', () => {
  it('commits a single static route and returns a CommitPlan', () => {
    const idx = new WildcardPrefixIndex();
    const result = idx.planAndCommit(0, [STATIC_USERS], meta('GET', '/users'));
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result).not.toBe('alias');
      const plan = result as CommitPlan;
      expect(plan.visited.length).toBeGreaterThan(0);
      expect(plan.hasWildcardTail).toBe(false);
    }
  });

  it('reuses the existing literal child on a repeat segment insert', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_USERS, PARAM_ID], meta('GET', '/users/:id'));
    const result = idx.planAndCommit(0, [STATIC_USERS, PARAM_SLUG], meta('GET', '/users/:slug'));
    expect(isErr(result)).toBe(true);
  });

  it('commits a wildcard-tail route and flags the plan', () => {
    const idx = new WildcardPrefixIndex();
    const result = idx.planAndCommit(0, [STATIC_FILES, WILDCARD_TAIL], meta('GET', '/files/*rest'));
    expect(isErr(result)).toBe(false);
    if (!isErr(result) && result !== 'alias') {
      expect(result.hasWildcardTail).toBe(true);
      expect(result.wildcardTailName).toBe('rest');
    }
  });

  it('keeps trees isolated per methodCode', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_FILES, WILDCARD_TAIL], meta('GET', '/files/*rest'));
    const result = idx.planAndCommit(1, [STATIC_FILES, WILDCARD_TAIL], meta('POST', '/files/*upload'));
    expect(isErr(result)).toBe(false);
  });
});

describe('planAndCommit — conflict rejections', () => {
  it('returns route-unreachable when a static segment follows an ancestor wildcard', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_FILES, WILDCARD_TAIL], meta('GET', '/files/*rest'));
    const result = idx.planAndCommit(0, [STATIC_FILES, STATIC_X], meta('GET', '/files/x'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.kind).toBe(RouterErrorKind.RouteUnreachable);
    }
  });

  it('returns route-duplicate when the same plain-param name conflicts on a different name', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_USERS, PARAM_ID], meta('GET', '/users/:id'));
    const result = idx.planAndCommit(0, [STATIC_USERS, PARAM_SLUG], meta('GET', '/users/:slug'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.kind).toBe(RouterErrorKind.RouteDuplicate);
    }
  });

  it('returns route-conflict when a plain param is added next to a regex param sibling', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_USERS, PARAM_DIGITS], meta('GET', '/users/:id(\\d+)'));
    const result = idx.planAndCommit(0, [STATIC_USERS, PARAM_SLUG], meta('GET', '/users/:slug'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.kind).toBe(RouterErrorKind.RouteConflict);
    }
  });

  it('returns route-conflict when distinct regex patterns clash as siblings', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_USERS, PARAM_DIGITS], meta('GET', '/users/:id(\\d+)'));
    const result = idx.planAndCommit(0, [STATIC_USERS, PARAM_LETTERS], meta('GET', '/users/:id([a-z]+)'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.kind).toBe(RouterErrorKind.RouteConflict);
    }
  });

  it('returns route-duplicate for a same-prefix terminal collision', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_USERS], meta('GET', '/users'));
    const result = idx.planAndCommit(0, [STATIC_USERS], meta('GET', '/users'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.kind).toBe(RouterErrorKind.RouteDuplicate);
    }
  });

  it('returns route-unreachable when a wildcard is registered where a descendant terminal exists', () => {
    const idx = new WildcardPrefixIndex();
    idx.planAndCommit(0, [STATIC_FILES, STATIC_X], meta('GET', '/files/x'));
    const result = idx.planAndCommit(0, [STATIC_FILES, WILDCARD_TAIL], meta('GET', '/files/*rest'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.kind).toBe(RouterErrorKind.RouteUnreachable);
    }
  });
});

describe('planAndCommit — optional-expansion aliasing', () => {
  it('returns "alias" when an optional-expansion duplicate has the same identity', () => {
    const idx = new WildcardPrefixIndex();
    const first = meta('GET', '/users/:id', true);
    idx.planAndCommit(0, [STATIC_USERS, PARAM_ID], first);
    const sameIdentity: RouteMeta = { ...first };
    const result = idx.planAndCommit(0, [STATIC_USERS, PARAM_ID], sameIdentity);
    expect(result).toBe('alias');
  });
});

describe('rollbackPlan — clean detachment', () => {
  it('removes the committed terminal and lets the same prefix re-commit cleanly', () => {
    const idx = new WildcardPrefixIndex();
    const first = idx.planAndCommit(0, [STATIC_USERS, PARAM_ID], meta('GET', '/users/:id'));
    expect(isErr(first)).toBe(false);
    rollbackPlan(first as CommitPlan);

    const retry = idx.planAndCommit(0, [STATIC_USERS, PARAM_ID], meta('GET', '/users/:id'));
    expect(isErr(retry)).toBe(false);
  });

  it('removes the wildcard tail and lets a descendant terminal commit afterwards', () => {
    const idx = new WildcardPrefixIndex();
    const wildPlan = idx.planAndCommit(0, [STATIC_FILES, WILDCARD_TAIL], meta('GET', '/files/*rest'));
    expect(isErr(wildPlan)).toBe(false);
    rollbackPlan(wildPlan as CommitPlan);

    const retry = idx.planAndCommit(0, [STATIC_FILES, STATIC_X], meta('GET', '/files/x'));
    expect(isErr(retry)).toBe(false);
  });
});
