import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { seal, _resetForTesting, __testing__ } from './seal';
import { SealError } from '../errors';
import { RAW, SEALED } from '../symbols';
import { globalRegistry } from '../registry';
import { isString } from '../rules/typechecker';
import { isNumber } from '../rules/typechecker';
import { min, max } from '../rules/number';
import type { RawClassMeta, RuleDef } from '../types';

const { mergeInheritance } = __testing__;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const freeClasses: Function[] = [];

function registerClass(ctor: Function, raw?: RawClassMeta): void {
  if (raw !== undefined) {
    (ctor as any)[RAW] = raw;
  }
  globalRegistry.add(ctor);
  freeClasses.push(ctor);
}

function makeStringField(name: string, rules: RuleDef[] = []): RawClassMeta {
  return {
    [name]: {
      validation: rules.length > 0 ? rules : [{ rule: isString }],
      transform: [],
      expose: [],
      exclude: null,
      type: null,
      flags: {},
    },
  };
}

function makeEmptyMeta(): RawClassMeta {
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  for (const ctor of freeClasses) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[SEALED];
    delete (ctor as any)[RAW];
  }
  freeClasses.length = 0;
  _resetForTesting();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('seal', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should succeed on empty registry', () => {
    // Arrange — no classes registered (freeClasses empty)
    // Act / Assert
    expect(() => seal()).not.toThrow();
  });

  it('should set the SEALED symbol on the class after sealing', () => {
    // Arrange
    class UserDto {}
    registerClass(UserDto, makeStringField('name'));
    // Act
    seal();
    // Assert
    const sealed = (UserDto as any)[SEALED];
    expect(sealed).toBeDefined();
    expect(typeof sealed._deserialize).toBe('function');
    expect(typeof sealed._serialize).toBe('function');
  });

  it('should expose _resetForTesting to reset _sealed flag', () => {
    // Arrange
    seal();
    // Act — should throw before reset
    expect(() => seal()).toThrow(SealError);
    _resetForTesting();
    // Assert — succeeds after reset
    expect(() => seal()).not.toThrow();
  });

  it('should seal a DTO with @IsString field — _deserialize returns instance for valid input', () => {
    // Arrange
    class PersonDto {}
    registerClass(PersonDto, makeStringField('name'));
    seal();
    // Act
    const sealed = (PersonDto as any)[SEALED];
    const result = sealed._deserialize({ name: 'Alice' });
    // Assert
    expect(result).toBeInstanceOf(PersonDto);
    // @ts-ignore
    expect(result.name).toBe('Alice');
  });

  it('should seal a DTO with @IsString field — _deserialize returns error for invalid input', () => {
    // Arrange
    class PersonDto2 {}
    registerClass(PersonDto2, makeStringField('name'));
    seal();
    // Act
    const sealed = (PersonDto2 as any)[SEALED];
    const result = sealed._deserialize({ name: 42 });
    // Assert — should be Err (has .data property)
    expect((result as any).data).toBeDefined();
    expect(Array.isArray((result as any).data)).toBe(true);
  });

  it('should seal @Type nested DTO so nested class is also sealed', () => {
    // Arrange
    class AddressDto {}
    (AddressDto as any)[RAW] = makeStringField('city');
    globalRegistry.add(AddressDto);
    freeClasses.push(AddressDto);

    class OrderDto {}
    registerClass(OrderDto, {
      address: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => AddressDto as any },
        flags: { validateNested: true },
      },
    });
    // Act
    seal();
    // Assert — nested DTO also sealed
    expect((AddressDto as any)[SEALED]).toBeDefined();
  });

  it('should skip sealOne if class is already SEALED (prevents double-seal)', () => {
    // Arrange
    class DtoA {}
    const raw = makeStringField('x');
    registerClass(DtoA, raw);
    // Pre-seal DtoA
    (DtoA as any)[SEALED] = {
      _deserialize: () => 'pre-sealed',
      _serialize: () => ({}),
    };
    seal();
    // Assert — SEALED was not replaced (pre-sealed value preserved)
    const sealed = (DtoA as any)[SEALED];
    expect(sealed._deserialize()).toBe('pre-sealed');
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should throw SealError when seal() is called twice', () => {
    // Arrange
    seal();
    // Act / Assert
    expect(() => seal()).toThrow(SealError);
  });

  it('should throw SealError containing "already sealed" message on second call', () => {
    // Arrange
    seal();
    // Act / Assert
    expect(() => seal()).toThrow(/already sealed/);
  });

  it('should throw SealError when @Expose has both deserializeOnly and serializeOnly', () => {
    // Arrange
    class BadExposeDto {}
    registerClass(BadExposeDto, {
      field: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [{ deserializeOnly: true, serializeOnly: true }], // invalid
        exclude: null,
        type: null,
        flags: {},
      },
    });
    // Act / Assert
    expect(() => seal()).toThrow(SealError);
  });

  // ── State Transition ───────────────────────────────────────────────────────

  it('should allow seal() after _resetForTesting() (state transition)', () => {
    // Arrange
    seal();
    _resetForTesting();
    // Act / Assert
    expect(() => seal()).not.toThrow();
  });

  it('should allow re-sealing after SEALED symbols are cleared and _resetForTesting called', () => {
    // Arrange
    class DtoB {}
    registerClass(DtoB, makeStringField('val'));
    seal();
    // Simulate unseal
    delete (DtoB as any)[SEALED];
    _resetForTesting();
    // Act
    seal();
    // Assert
    expect((DtoB as any)[SEALED]).toBeDefined();
  });

  // ── Corner ─────────────────────────────────────────────────────────────────

  it('should handle circular @Type via placeholder without infinite recursion', () => {
    // Arrange — self-referencing DTO
    class TreeDto {}
    (TreeDto as any)[RAW] = {
      value: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
      child: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => TreeDto as any },
        flags: { validateNested: true },
      },
    };
    globalRegistry.add(TreeDto);
    freeClasses.push(TreeDto);
    // Act / Assert — should not throw or infinite loop
    expect(() => seal({ enableCircularCheck: false })).not.toThrow();
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should succeed when DTO has no fields (empty metadata)', () => {
    // Arrange
    class EmptyDto {}
    registerClass(EmptyDto, makeEmptyMeta());
    // Act / Assert
    expect(() => seal()).not.toThrow();
    expect((EmptyDto as any)[SEALED]).toBeDefined();
  });

  it('should not seal a class not in globalRegistry', () => {
    // Arrange — NotRegisteredDto NOT added to globalRegistry
    class NotRegisteredDto {}
    (NotRegisteredDto as any)[RAW] = makeStringField('x');
    // (not added to freeClasses or globalRegistry)
    seal();
    // Assert
    expect((NotRegisteredDto as any)[SEALED]).toBeUndefined();
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('should produce equivalent executors after seal → unseal → seal cycle', () => {
    // Arrange
    class IdempDto {}
    registerClass(IdempDto, makeStringField('name'));
    seal();
    const first = (IdempDto as any)[SEALED];
    const firstResult = first._deserialize({ name: 'Bob' });

    delete (IdempDto as any)[SEALED];
    _resetForTesting();
    seal();
    const second = (IdempDto as any)[SEALED];
    const secondResult = second._deserialize({ name: 'Bob' });
    // Assert — both produce instances with same values
    expect(firstResult).toBeInstanceOf(IdempDto);
    expect(secondResult).toBeInstanceOf(IdempDto);
    // @ts-ignore
    expect(firstResult.name).toBe(secondResult.name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeInheritance — __testing__ export 사용
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeInheritance', () => {
  it('should return own RAW only when class has no parent with RAW', () => {
    // Arrange
    class StandaloneDto {}
    const raw = makeStringField('name');
    (StandaloneDto as any)[RAW] = raw;
    // Act
    const merged = mergeInheritance(StandaloneDto);
    // Assert
    expect(merged.name).toBeDefined();
    expect(merged.name.validation.length).toBe(1);
  });

  it('should union-merge validation rules from parent and child', () => {
    // Arrange
    class BaseDto {}
    (BaseDto as any)[RAW] = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };

    class ChildDto extends BaseDto {}
    (ChildDto as any)[RAW] = {
      name: { validation: [{ rule: min(1) }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildDto);
    // Assert — both isString and min(1) should be present
    expect(merged.name.validation.length).toBe(2);
  });

  it('should ignore parent transform when child has its own transform', () => {
    // Arrange
    const parentFn = (v: any) => v.trim();
    (parentFn as any).emit = () => '';
    (parentFn as any).ruleName = 'trim';

    const childFn = (v: any) => v.toLowerCase();
    (childFn as any).emit = () => '';
    (childFn as any).ruleName = 'lower';

    class BaseTr {}
    (BaseTr as any)[RAW] = {
      name: { validation: [], transform: [{ fn: parentFn }], expose: [], exclude: null, type: null, flags: {} },
    };
    class ChildTr extends BaseTr {}
    (ChildTr as any)[RAW] = {
      name: { validation: [], transform: [{ fn: childFn }], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildTr);
    // Assert — only child transform
    expect(merged.name.transform.length).toBe(1);
    expect(merged.name.transform[0].fn).toBe(childFn);
  });

  it('should inherit parent transform when child has none', () => {
    // Arrange
    const parentFn2 = (v: any) => v;
    class BaseTr2 {}
    (BaseTr2 as any)[RAW] = {
      x: { validation: [], transform: [{ fn: parentFn2 }], expose: [], exclude: null, type: null, flags: {} },
    };
    class ChildTr2 extends BaseTr2 {}
    (ChildTr2 as any)[RAW] = {
      x: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildTr2);
    // Assert — parent transform inherited
    expect(merged.x.transform.length).toBe(1);
    expect(merged.x.transform[0].fn).toBe(parentFn2);
  });

  it('should override parent expose with child expose when child has @Expose', () => {
    // Arrange
    class BaseEx {}
    (BaseEx as any)[RAW] = {
      field: { validation: [], transform: [], expose: [{ name: 'parent_name' }], exclude: null, type: null, flags: {} },
    };
    class ChildEx extends BaseEx {}
    (ChildEx as any)[RAW] = {
      field: { validation: [], transform: [], expose: [{ name: 'child_name' }], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildEx);
    // Assert — child name used, not parent
    expect(merged.field.expose[0].name).toBe('child_name');
  });

  it('should inherit parent expose when child has no @Expose', () => {
    // Arrange
    class BaseEx2 {}
    (BaseEx2 as any)[RAW] = {
      field: { validation: [], transform: [], expose: [{ name: 'parent_exposed' }], exclude: null, type: null, flags: {} },
    };
    class ChildEx2 extends BaseEx2 {}
    (ChildEx2 as any)[RAW] = {
      field: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildEx2);
    // Assert — parent expose inherited
    expect(merged.field.expose.length).toBe(1);
    expect(merged.field.expose[0].name).toBe('parent_exposed');
  });

  it('should inherit parent exclude when child has no exclude', () => {
    // Arrange
    class BaseExcl {}
    (BaseExcl as any)[RAW] = {
      secret: { validation: [], transform: [], expose: [], exclude: { serializeOnly: true }, type: null, flags: {} },
    };
    class ChildExcl extends BaseExcl {}
    (ChildExcl as any)[RAW] = {
      secret: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildExcl);
    // Assert
    expect(merged.secret.exclude).toEqual({ serializeOnly: true });
  });

  it('should inherit parent type when child has no @Type', () => {
    // Arrange
    class NestedDto {}
    class BaseType {}
    (BaseType as any)[RAW] = {
      nested: { validation: [], transform: [], expose: [], exclude: null, type: { fn: () => NestedDto }, flags: {} },
    };
    class ChildType extends BaseType {}
    (ChildType as any)[RAW] = {
      nested: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildType);
    // Assert
    expect(merged.nested.type?.fn()).toBe(NestedDto);
  });

  it('should apply child-first flag merge (isOptional)', () => {
    // Arrange
    class BaseFlag {}
    (BaseFlag as any)[RAW] = {
      age: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: { isOptional: true } },
    };
    class ChildFlag extends BaseFlag {}
    (ChildFlag as any)[RAW] = {
      age: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildFlag);
    // Assert — parent flag inherited (child has none)
    expect(merged.age.flags.isOptional).toBe(true);
  });

  it('should not add duplicate validation rules during union merge', () => {
    // Arrange — same rule instance in both parent and child
    const sharedRule = isString;
    class BaseDup {}
    (BaseDup as any)[RAW] = {
      f: { validation: [{ rule: sharedRule }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    class ChildDup extends BaseDup {}
    (ChildDup as any)[RAW] = {
      f: { validation: [{ rule: sharedRule }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(ChildDup);
    // Assert — deduplicated
    expect(merged.f.validation.length).toBe(1);
  });

  it('should handle 3-level inheritance chain correctly', () => {
    // Arrange
    class GrandParent {}
    (GrandParent as any)[RAW] = {
      x: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    class ParentLevel extends GrandParent {}
    (ParentLevel as any)[RAW] = {
      x: { validation: [{ rule: min(1) }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    class Child3 extends ParentLevel {}
    (Child3 as any)[RAW] = {
      x: { validation: [{ rule: max(100) }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const merged = mergeInheritance(Child3);
    // Assert — all 3 rules in union
    expect(merged.x.validation.length).toBe(3);
  });
});
