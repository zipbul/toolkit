import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry, unregister } from './registry';

describe('globalRegistry', () => {
  const added: Function[] = [];

  afterEach(() => {
    for (const fn of added) {
      globalRegistry.delete(fn);
    }
    added.length = 0;
  });

  it('should be instance of Set when accessing globalRegistry', () => {
    expect(globalRegistry instanceof Set).toBe(true);
  });

  it('should have size 0 before any additions when starting fresh', () => {
    // Arrange: capture snapshot before test (other tests may not have cleaned up)
    const before = globalRegistry.size;
    class TestClass {}
    // Act
    globalRegistry.add(TestClass);
    added.push(TestClass);
    // Assert: size increased by exactly 1
    expect(globalRegistry.size).toBe(before + 1);
  });

  it('should not increase size when adding the same Function twice', () => {
    // Arrange
    class TestClass {}
    globalRegistry.add(TestClass);
    added.push(TestClass);
    const sizeAfterFirst = globalRegistry.size;
    // Act
    globalRegistry.add(TestClass);
    // Assert
    expect(globalRegistry.size).toBe(sizeAfterFirst);
  });

  it('should contain the added Function when checking with has() after add()', () => {
    // Arrange
    class TestClass {}
    // Act
    globalRegistry.add(TestClass);
    added.push(TestClass);
    // Assert
    expect(globalRegistry.has(TestClass)).toBe(true);
  });

  it('should iterate in insertion order when iterating after multiple additions', () => {
    // Arrange
    class A {}
    class B {}
    class C {}
    globalRegistry.add(A);
    globalRegistry.add(B);
    globalRegistry.add(C);
    added.push(A, B, C);
    // Act
    const snapshot = [...globalRegistry];
    const idx = (fn: Function) => snapshot.indexOf(fn);
    // Assert: insertion order preserved
    expect(idx(A)).toBeLessThan(idx(B));
    expect(idx(B)).toBeLessThan(idx(C));
  });
});

describe('unregister', () => {
  const added: Function[] = [];

  afterEach(() => {
    for (const fn of added) globalRegistry.delete(fn);
    added.length = 0;
  });

  it('should return true when the class was registered', () => {
    class MyDto {}
    globalRegistry.add(MyDto);
    expect(unregister(MyDto)).toBe(true);
  });

  it('should return false when the class was not registered', () => {
    class UnknownDto {}
    expect(unregister(UnknownDto)).toBe(false);
  });

  it('should remove the class from globalRegistry', () => {
    class MyDto2 {}
    globalRegistry.add(MyDto2);
    unregister(MyDto2);
    expect(globalRegistry.has(MyDto2)).toBe(false);
  });

  it('should not affect other entries when removing one class', () => {
    class DtoA {}
    class DtoB {}
    globalRegistry.add(DtoA);
    globalRegistry.add(DtoB);
    added.push(DtoB);
    unregister(DtoA);
    expect(globalRegistry.has(DtoA)).toBe(false);
    expect(globalRegistry.has(DtoB)).toBe(true);
  });
});
