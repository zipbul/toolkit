/* eslint-disable no-console */
/**
 * Reproduce C1: subtreeShapesEqual ignores `store` field.
 * Setup:
 *   - 1500 tenants register `/tenant-X/users/:id` only
 *   - tenant-5 additionally registers `/tenant-5/users` (terminal at users node)
 * Hypothesis: detectTenantFactor mistakenly applies because shapes compare
 * equal, and walker returns wrong handler indices.
 */
import { Router } from '../src/router';

const r = new Router<string>();
for (let i = 0; i < 1500; i++) r.add('GET', `/tenant-${i}/users/:id`, `param-${i}`);
r.add('GET', '/tenant-5/users', 'static-5');
r.build();

const tests: Array<[string, string | null, string]> = [
  ['/tenant-0/users/abc', 'param-0', 'tenant-0 :id should hit param-0'],
  ['/tenant-99/users/xyz', 'param-99', 'tenant-99 :id should hit param-99'],
  ['/tenant-5/users/abc', 'param-5', 'tenant-5 :id should hit param-5'],
  ['/tenant-5/users', 'static-5', 'tenant-5 /users static should hit static-5'],
  ['/tenant-99/users', null, 'tenant-99 /users (no static registered) should be null'],
  ['/tenant-1499/users/foo', 'param-1499', 'last tenant :id'],
  ['/tenant-1499/users', null, 'tenant-1499 /users (no static) should be null'],
];

let failed = 0;
for (const [path, expected, desc] of tests) {
  const got = r.match('GET', path);
  const gotVal = got === null ? null : got.value;
  const ok = gotVal === expected;
  console.log(`${ok ? 'OK ' : 'FAIL'}  GET ${path.padEnd(30)} → ${String(gotVal).padEnd(15)} (expected ${String(expected).padEnd(10)})  — ${desc}`);
  if (!ok) failed++;
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} of ${tests.length} failed`);
process.exit(failed === 0 ? 0 : 1);
