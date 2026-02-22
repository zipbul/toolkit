import { describe, it, expect, afterEach } from 'bun:test';
import {
  ensureMeta,
  collectValidation,
  collectTransform,
  collectExpose,
  collectExclude,
  collectType,
} from './collect';
import { globalRegistry } from './registry';

const RAW = Symbol.for('baker:raw');

// 테스트에서 생성한 클래스를 추적하여 afterEach에서 globalRegistry를 정리한다.
const createdCtors: Function[] = [];
function tracked<T extends new (...args: any[]) => any>(ctor: T): T {
  createdCtors.push(ctor);
  return ctor;
}

describe('collect', () => {
  afterEach(() => {
    for (const ctor of createdCtors) {
      globalRegistry.delete(ctor);
      delete (ctor as any)[RAW];
    }
    createdCtors.length = 0;
  });

  it('should create RAW property on ctor when calling ensureMeta for the first time', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    // Act
    ensureMeta(TestClass, 'prop');
    // Assert
    expect((TestClass as any)[RAW]).toBeDefined();
  });

  it('should reuse the existing RAW object when calling ensureMeta on an already-decorated class', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    ensureMeta(TestClass, 'prop');
    const rawBefore = (TestClass as any)[RAW];
    // Act
    ensureMeta(TestClass, 'other');
    // Assert
    expect((TestClass as any)[RAW]).toBe(rawBefore);
  });

  it('should create default meta for key when calling ensureMeta with a new key', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    // Act
    const meta = ensureMeta(TestClass, 'newProp');
    // Assert
    expect(meta).toBeDefined();
    expect(meta.validation).toEqual([]);
  });

  it('should return the same meta object when calling ensureMeta with an already-registered key', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const first = ensureMeta(TestClass, 'prop');
    // Act
    const second = ensureMeta(TestClass, 'prop');
    // Assert
    expect(first).toBe(second);
  });

  it('should register ctor in globalRegistry when calling ensureMeta', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    // Act
    ensureMeta(TestClass, 'prop');
    // Assert
    expect(globalRegistry.has(TestClass)).toBe(true);
  });

  it('should have correct default shape when inspecting meta returned by ensureMeta', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    // Act
    const meta = ensureMeta(TestClass, 'prop');
    // Assert
    expect(meta.validation).toEqual([]);
    expect(meta.transform).toEqual([]);
    expect(meta.expose).toEqual([]);
    expect(meta.exclude).toBeNull();
    expect(meta.type).toBeNull();
    expect(meta.flags).toEqual({});
  });

  it('should append ruleDef to meta.validation when calling collectValidation', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const ruleDef = { rule: {} as any, each: false };
    // Act
    collectValidation({ constructor: TestClass } as any, 'prop', ruleDef);
    // Assert
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.validation).toContain(ruleDef);
  });

  it('should append transformDef to meta.transform when calling collectTransform', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const transformDef = { fn: () => 'x' };
    // Act
    collectTransform({ constructor: TestClass } as any, 'prop', transformDef as any);
    // Assert
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.transform).toContain(transformDef);
  });

  it('should append exposeDef to meta.expose when calling collectExpose', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const exposeDef = { name: 'myProp' };
    // Act
    collectExpose({ constructor: TestClass } as any, 'prop', exposeDef);
    // Assert
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.expose).toContain(exposeDef);
  });

  it('should set meta.exclude when calling collectExclude', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const excludeDef = { deserializeOnly: true };
    // Act
    collectExclude({ constructor: TestClass } as any, 'prop', excludeDef);
    // Assert
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.exclude).toBe(excludeDef);
  });

  it('should set meta.type when calling collectType', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const NestedClass = tracked(class NestedClass {});
    const typeDef = { fn: () => NestedClass };
    // Act
    collectType({ constructor: TestClass } as any, 'prop', typeDef as any);
    // Assert
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.type).toBe(typeDef);
  });

  it('should return the same meta object reference when calling ensureMeta twice with the same arguments', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    // Act
    const a = ensureMeta(TestClass, 'prop');
    const b = ensureMeta(TestClass, 'prop');
    // Assert
    expect(a).toBe(b);
  });

  it('should accumulate ruleDefs in order when calling collectValidation multiple times', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const rule1 = { rule: {} as any };
    const rule2 = { rule: {} as any };
    const rule3 = { rule: {} as any };
    // Act
    collectValidation({ constructor: TestClass } as any, 'prop', rule1 as any);
    collectValidation({ constructor: TestClass } as any, 'prop', rule2 as any);
    collectValidation({ constructor: TestClass } as any, 'prop', rule3 as any);
    // Assert
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.validation).toEqual([rule1, rule2, rule3]);
  });

  it('should reflect call order in meta.validation when collectValidation is called in a specific order', () => {
    // Arrange
    const TestClass = tracked(class TestClass {});
    const ruleA = { rule: { ruleName: 'A' } as any };
    const ruleB = { rule: { ruleName: 'B' } as any };
    // Act — B first, then A
    collectValidation({ constructor: TestClass } as any, 'prop', ruleB as any);
    collectValidation({ constructor: TestClass } as any, 'prop', ruleA as any);
    // Assert: B precedes A in the array
    const meta = ensureMeta(TestClass, 'prop');
    expect(meta.validation[0]).toBe(ruleB);
    expect(meta.validation[1]).toBe(ruleA);
  });
});
