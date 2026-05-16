import { describe, expect, it } from 'bun:test';
import { Router } from '../src/router';

/**
 * Branch-coverage tests for `walkSharedSubtree` (factored + prefix-factor
 * walkers). The shared subtree's per-node dispatch handles five shapes
 * (staticPrefix, singleChildKey, staticChildren Record, paramChild with
 * tester, wildcardStore) plus three end-of-URL terminals (store, multi
 * wildcard, star wildcard) — each requires a concrete tenant route to
 * exercise. The 1500-tenant minimum forces the factored tier; under that
 * threshold the iterative walker handles the same shape and these
 * branches stay dark.
 */
describe('factored walker shared-subtree shapes', () => {
  it('walks a paramChild + tester (regex-constrained) inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/users/:id(\\d+)`, `tenant-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/users/42')?.value).toBe('tenant-0');
    expect(r.match('GET', '/tenant-0/users/42')?.params.id).toBe('42');
    expect(r.match('GET', '/tenant-1499/users/9999')?.value).toBe('tenant-1499');
    // tester rejection — non-digit fails the regex inside the shared subtree
    expect(r.match('GET', '/tenant-0/users/abc')).toBeNull();
  });

  it('walks a multi-wildcard terminal inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/*tail+`, `multi-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/files/a/b/c')?.value).toBe('multi-0');
    expect(r.match('GET', '/tenant-0/files/a/b/c')?.params.tail).toBe('a/b/c');
    expect(r.match('GET', '/tenant-1499/files/x')?.value).toBe('multi-1499');
    // empty tail rejected by multi origin
    expect(r.match('GET', '/tenant-0/files')).toBeNull();
    expect(r.match('GET', '/tenant-0/files/')).toBeNull();
  });

  it('walks a star-wildcard terminal inside shared subtree (zero or more)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/assets/*path`, `star-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/assets/style.css')?.value).toBe('star-0');
    expect(r.match('GET', '/tenant-0/assets/a/b/c.css')?.params.path).toBe('a/b/c.css');
    // star tolerates empty tail
    const empty = r.match('GET', '/tenant-0/assets');
    expect(empty?.value).toBe('star-0');
    expect(empty?.params.path).toBe('');
  });

  it('walks a multi-static-children Record sibling group inside shared subtree', () => {
    const r = new Router<string>();
    // Each tenant has multiple static children at the same node so the
    // Record branch (staticChildren[seg]) is exercised, not just inline.
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/users/profile`, `profile-${i}`);
      r.add('GET', `/tenant-${i}/users/settings`, `settings-${i}`);
      r.add('GET', `/tenant-${i}/users/billing`, `billing-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/users/profile')?.value).toBe('profile-0');
    expect(r.match('GET', '/tenant-0/users/settings')?.value).toBe('settings-0');
    expect(r.match('GET', '/tenant-1499/users/billing')?.value).toBe('billing-1499');
    expect(r.match('GET', '/tenant-0/users/unknown')).toBeNull();
  });

  it('walks a deep singleChildKey chain inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/api/v1/items/:id`, `item-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/api/v1/items/42')?.value).toBe('item-0');
    expect(r.match('GET', '/tenant-1499/api/v1/items/x')?.value).toBe('item-1499');
    expect(r.match('GET', '/tenant-0/api/v1/items')).toBeNull();
    expect(r.match('GET', '/tenant-0/api/wrong/items/42')).toBeNull();
  });

  it('walks a staticPrefix-compacted chain inside shared subtree', () => {
    const r = new Router<string>();
    // Single chain `/api/v1/users/items` after the tenant key triggers
    // post-seal compaction — staticPrefix gets populated on the deepest
    // node and the walker takes the consumeStaticPrefix branch.
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/api/v1/users/items/:id`, `compact-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/api/v1/users/items/42')?.value).toBe('compact-0');
    expect(r.match('GET', '/tenant-0/api/v1/users/items/42')?.params.id).toBe('42');
    // Mismatch in the middle of the static prefix → consumeStaticPrefix
    // returns -1, walker falls out cleanly.
    expect(r.match('GET', '/tenant-0/api/v2/users/items/42')).toBeNull();
    // Truncated input — prefix can't fully consume → -1 path.
    expect(r.match('GET', '/tenant-0/api/v1/users')).toBeNull();
  });
});
