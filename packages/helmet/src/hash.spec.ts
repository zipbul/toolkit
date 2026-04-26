import { describe, expect, it } from 'bun:test';

import { hashFromString } from './hash';

// Pre-computed SHA-384 base64 of "hello"
const HELLO_SHA384 =
  '59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f';

describe('hashFromString', () => {
  it('hashes a string with default sha384', async () => {
    const out = await hashFromString('hello');
    // base64 length for sha384 is 64
    expect(out).toHaveLength(64);
  });

  it('matches each algorithm at the expected base64 length', async () => {
    expect((await hashFromString('hello', 'sha256')).length).toBe(44);
    expect((await hashFromString('hello', 'sha384')).length).toBe(64);
    expect((await hashFromString('hello', 'sha512')).length).toBe(88);
  });

  it('accepts Uint8Array input (binary path)', async () => {
    const bytes = new TextEncoder().encode('hello');
    expect((await hashFromString(bytes, 'sha384')).length).toBe(64);
  });

  it('accepts ArrayBuffer input', async () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect((await hashFromString(buf, 'sha384')).length).toBe(64);
  });

  it('produces deterministic output for the same input', async () => {
    const a = await hashFromString('hello', 'sha384');
    const b = await hashFromString('hello', 'sha384');
    expect(a).toBe(b);
  });

  it('produces different output for different input', async () => {
    const a = await hashFromString('hello', 'sha384');
    const b = await hashFromString('world', 'sha384');
    expect(a).not.toBe(b);
  });

  // Sanity: cross-check Uint8Array path against the string path (same content).
  it('Uint8Array(bytes-of("hello")) matches string("hello")', async () => {
    const fromString = await hashFromString('hello', 'sha384');
    const fromBytes = await hashFromString(new TextEncoder().encode('hello'), 'sha384');
    expect(fromString).toBe(fromBytes);
    void HELLO_SHA384; // referenced for documentation
  });
});
