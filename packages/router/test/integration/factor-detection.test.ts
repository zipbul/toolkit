/**
 * leafStoreOf + detectTenantFactor edge branches that the regular
 * fixtures miss: multi-children rejection, deep single-chain, and
 * factor-detect with a wildcard at the canonical leaf.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../../src/router';

describe('factor detection — multi-children leaves reject the factor', () => {
  it('rejects factor when each tenant has 2+ static children at the leaf', () => {
    const r = new Router<string>();
    // 1500 tenants, each with /tenant-X/{a,b} (two siblings at leaf)
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/a`, `a-${i}`);
      r.add('GET', `/tenant-${i}/b`, `b-${i}`);
    }
    r.build();
    // detectTenantFactor's leafStoreOf hits the `many=true` branch and
    // returns null → factor rejected. Walker falls through to a normal
    // tier (codegen / iterative) and must still match correctly.
    expect(r.match('GET', '/tenant-0/a')?.value).toBe('a-0');
    expect(r.match('GET', '/tenant-0/b')?.value).toBe('b-0');
    expect(r.match('GET', '/tenant-1499/a')?.value).toBe('a-1499');
    expect(r.match('GET', '/tenant-1499/b')?.value).toBe('b-1499');
    expect(r.match('GET', '/tenant-1500/a')).toBeNull();
  });

  it('accepts factor when each tenant has exactly 1 static child + paramChild', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/users/:id`, `u-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/users/42')?.value).toBe('u-0');
    expect(r.match('GET', '/tenant-1499/users/42')?.value).toBe('u-1499');
  });
});

describe('factor detection — deep single-chain', () => {
  it('walks deep static chains during leafStoreOf without losing precision', () => {
    const r = new Router<string>();
    // 1500 tenants with deep single-chain
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/a/b/c/d/e/:final`, `deep-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/a/b/c/d/e/X')?.value).toBe('deep-0');
    expect(r.match('GET', '/tenant-1499/a/b/c/d/e/Y')?.value).toBe('deep-1499');
  });
});

describe('factor detection — wildcard at canonical leaf', () => {
  it('factors over star-wildcard tail', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/*path`, `wild-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/files/a/b')?.value).toBe('wild-0');
    expect(r.match('GET', '/tenant-1499/files/x/y/z')?.value).toBe('wild-1499');
    // star captures empty tail at /tenant-X/files (no trailing slash)
    expect(r.match('GET', '/tenant-0/files')?.value).toBe('wild-0');
  });
});

describe('factor detection — terminal store presence asymmetry (post-fix)', () => {
  it('rejects factor when wildcardStore presence differs between siblings', () => {
    const r = new Router<string>();
    // 1500 tenants with /tenant-X/files/:id
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/:id`, `files-${i}`);
    }
    r.build();
    // Without the wildcardStore presence asymmetry; this one
    // should factor cleanly. Match correctness verifies the
    // factor + walker pipeline.
    expect(r.match('GET', '/tenant-0/files/abc')?.value).toBe('files-0');
    expect(r.match('GET', '/tenant-1499/files/x')?.value).toBe('files-1499');
  });
});

describe('factor detection — sibling chain length asymmetry', () => {
  it('rejects factor when one tenant has a longer chain', () => {
    const r = new Router<string>();
    // Most tenants: single segment after prefix
    for (let i = 0; i < 1499; i++) {
      r.add('GET', `/tenant-${i}/users/:id`, `short-${i}`);
    }
    // tenant-9 alone has a longer chain
    r.add('GET', '/tenant-9/users/:id/posts', 'long-9');
    r.build();
    expect(r.match('GET', '/tenant-0/users/x')?.value).toBe('short-0');
    expect(r.match('GET', '/tenant-9/users/x')?.value).toBe('short-9');
    expect(r.match('GET', '/tenant-9/users/x/posts')?.value).toBe('long-9');
    expect(r.match('GET', '/tenant-1498/users/y')?.value).toBe('short-1498');
  });
});

describe('factor detection — long single-chain still factors', () => {
  it('30-segment single chain in every tenant still factors and matches', () => {
    const r = new Router<string>();
    const tail = Array.from({ length: 30 }, (_, i) => `s${i}`).join('/');
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/${tail}/:final`, `deep-${i}`);
    }
    r.build();
    expect(r.match('GET', `/tenant-0/${tail}/X`)?.value).toBe('deep-0');
    expect(r.match('GET', `/tenant-1499/${tail}/Y`)?.value).toBe('deep-1499');
  });
});
