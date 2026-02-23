import { describe, it, expect, mock } from 'bun:test';
import { buildSerializeCode } from './serialize-builder';
import { isString } from '../rules/typechecker';
import { SEALED } from '../symbols';
import type { RawClassMeta, SealedExecutors } from '../types';
import type { SealOptions } from '../interfaces';
import type { RuntimeOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSerializeCode', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should assign simple field value to output object', () => {
    // Arrange
    class SimpleDto { name = 'Alice'; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildSerializeCode(SimpleDto, merged, undefined);
    const instance = new SimpleDto();
    // Act
    const result = exec(instance);
    // Assert
    expect(result.name).toBe('Alice');
  });

  it('should omit field from output when @IsOptional field is undefined', () => {
    // Arrange
    class OptDto { age?: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    const exec = buildSerializeCode(OptDto, merged, undefined);
    const instance = new OptDto(); // age is undefined
    // Act
    const result = exec(instance);
    // Assert
    expect('age' in result).toBe(false);
  });

  it('should map field to @Expose name when serializeOnly name is set', () => {
    // Arrange
    class ExposedDto { displayName = 'Bob'; }
    const merged: RawClassMeta = {
      displayName: {
        validation: [],
        transform: [],
        expose: [{ name: 'userName', serializeOnly: true }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(ExposedDto, merged, undefined);
    const instance = new ExposedDto();
    // Act
    const result = exec(instance);
    // Assert — output key is 'userName', not 'displayName'
    expect(result['userName']).toBe('Bob');
    expect('displayName' in result).toBe(false);
  });

  it('should skip field when @Exclude(serializeOnly) is set', () => {
    // Arrange
    class ExclDto { secret = 'hidden'; }
    const merged: RawClassMeta = {
      secret: {
        validation: [],
        transform: [],
        expose: [],
        exclude: { serializeOnly: true },
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(ExclDto, merged, undefined);
    const instance = new ExclDto();
    // Act
    const result = exec(instance);
    // Assert
    expect('secret' in result).toBe(false);
  });

  it('should include admin-guarded field when groups includes admin', () => {
    // Arrange
    class GroupDto { adminField = 'adminVal'; }
    const merged: RawClassMeta = {
      adminField: {
        validation: [],
        transform: [],
        expose: [{ groups: ['admin'] }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(GroupDto, merged, undefined);
    const instance = new GroupDto();
    const opts: RuntimeOptions = { groups: ['admin'] };
    // Act
    const result = exec(instance, opts);
    // Assert
    expect(result.adminField).toBe('adminVal');
  });

  it('should exclude admin-guarded field when no groups provided', () => {
    // Arrange
    class GroupDto2 { adminField = 'adminVal'; }
    const merged: RawClassMeta = {
      adminField: {
        validation: [],
        transform: [],
        expose: [{ groups: ['admin'] }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(GroupDto2, merged, undefined);
    const instance = new GroupDto2();
    // Act — no groups in opts
    const result = exec(instance, {});
    // Assert
    expect('adminField' in result).toBe(false);
  });

  it('should call @Transform function and use its result', () => {
    // Arrange
    class TransDto { name = 'alice'; }
    const transformFn = mock(({ value }: any) => (value as string).toUpperCase());
    const merged: RawClassMeta = {
      name: {
        validation: [],
        transform: [{ fn: transformFn, options: { serializeOnly: true } }],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(TransDto, merged, undefined);
    const instance = new TransDto();
    // Act
    const result = exec(instance);
    // Assert
    expect(result.name).toBe('ALICE');
  });

  it('should apply all @Transform functions in order when multiple transforms are set (H5)', () => {
    // Arrange — two serialize transforms: uppercase then prepend prefix
    class MultiTransDto { name = 'alice'; }
    const upperFn = mock(({ value }: any) => (value as string).toUpperCase());
    const prefixFn = mock(({ value }: any) => 'PREFIX_' + (value as string));
    const merged: RawClassMeta = {
      name: {
        validation: [],
        transform: [
          { fn: upperFn },
          { fn: prefixFn },
        ],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(MultiTransDto, merged, undefined);
    const instance = new MultiTransDto();
    // Act
    const result = exec(instance);
    // Assert — both transforms applied in order: 'alice' → 'ALICE' → 'PREFIX_ALICE'
    expect(result.name).toBe('PREFIX_ALICE');
  });

  it('should apply all three @Transform functions in sequence (CO: three chained transforms)', () => {
    // Arrange — three serialize transforms
    class TriTransDto { tag = 'hello'; }
    const t1 = mock(({ value }: any) => (value as string).toUpperCase());        // 'HELLO'
    const t2 = mock(({ value }: any) => (value as string) + '!');               // 'HELLO!'
    const t3 = mock(({ value }: any) => '[' + (value as string) + ']');         // '[HELLO!]'
    const merged: RawClassMeta = {
      tag: {
        validation: [],
        transform: [{ fn: t1 }, { fn: t2 }, { fn: t3 }],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(TriTransDto, merged, undefined);
    // Act
    const result = exec(new TriTransDto());
    // Assert
    expect(result.tag).toBe('[HELLO!]');
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should return empty object when DTO has no fields', () => {
    // Arrange
    class NoFields {}
    const exec = buildSerializeCode(NoFields, {}, undefined);
    // Act
    const result = exec(new NoFields());
    // Assert
    expect(result).toEqual({});
  });

  it('should include field in output when it has validation only (no @Expose needed)', () => {
    // Arrange
    class ValidationOnlyDto { score = 42; }
    const merged: RawClassMeta = {
      score: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(ValidationOnlyDto, merged, undefined);
    const instance = new ValidationOnlyDto();
    // Act
    const result = exec(instance);
    // Assert — baker registers field if any decorator present
    expect(result.score).toBe(42);
  });

  // ── Corner ─────────────────────────────────────────────────────────────────

  it('should combine @Expose serializeOnly name with @IsOptional wrap', () => {
    // Arrange
    class ComboDto { alias?: string; }
    const merged: RawClassMeta = {
      alias: {
        validation: [],
        transform: [],
        expose: [{ name: 'aliasOut', serializeOnly: true }],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    const exec = buildSerializeCode(ComboDto, merged, undefined);
    const defInstance = new ComboDto(); // alias is undefined
    const valInstance = Object.assign(new ComboDto(), { alias: 'hello' });
    // Act
    const defResult = exec(defInstance); // undefined → omit
    const valResult = exec(valInstance); // 'hello' → map to 'aliasOut'
    // Assert
    expect('aliasOut' in defResult).toBe(false);
    expect(valResult['aliasOut']).toBe('hello');
  });

  // ── H4: Nested DTO serialize ────────────────────────────────────────────────

  it('should call nested DTO _serialize when @Type field has a sealed nested class (H4)', () => {
    // Arrange
    class AddressDto {}
    const mockNestedSerialize = mock((_instance: unknown, _opts?: RuntimeOptions) => ({ city: 'Seoul' }));
    (AddressDto as any)[SEALED] = {
      _deserialize: mock(() => {}),
      _serialize: mockNestedSerialize,
    } satisfies SealedExecutors<unknown>;

    class UserDto { address = new AddressDto(); }
    const merged: RawClassMeta = {
      address: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => AddressDto as any },
        flags: { validateNested: true },
      },
    };
    const exec = buildSerializeCode(UserDto, merged, undefined);
    const instance = new UserDto();
    // Act
    const result = exec(instance);
    // Assert — nested serialize was called and result used
    expect(mockNestedSerialize).toHaveBeenCalled();
    expect(result.address).toEqual({ city: 'Seoul' });
  });

  it('should map each array item through nested DTO _serialize for array @Type field (H4)', () => {
    // Arrange
    class ItemDto {}
    const mockItemSerialize = mock((_inst: unknown, _opts?: RuntimeOptions) => ({ id: 1 }));
    (ItemDto as any)[SEALED] = {
      _deserialize: mock(() => {}),
      _serialize: mockItemSerialize,
    } satisfies SealedExecutors<unknown>;

    class OrderDto { items: ItemDto[] = [new ItemDto(), new ItemDto()]; }
    const merged: RawClassMeta = {
      items: {
        validation: [{ rule: isString, each: true }],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => ItemDto as any },
        flags: { validateNested: true },
      },
    };
    const exec = buildSerializeCode(OrderDto, merged, undefined);
    const instance = new OrderDto();
    // Act
    const result = exec(instance);
    // Assert — serialize called for each item
    expect(mockItemSerialize).toHaveBeenCalledTimes(2);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('should omit optional nested field when value is undefined (H4 + @IsOptional)', () => {
    // Arrange
    class ProfileDto {}
    (ProfileDto as any)[SEALED] = {
      _deserialize: mock(() => {}),
      _serialize: mock(() => ({ bio: 'test' })),
    } satisfies SealedExecutors<unknown>;

    class MemberDto { profile?: ProfileDto; }
    const merged: RawClassMeta = {
      profile: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => ProfileDto as any },
        flags: { validateNested: true, isOptional: true },
      },
    };
    const exec = buildSerializeCode(MemberDto, merged, undefined);
    const instance = new MemberDto(); // profile is undefined
    // Act
    const result = exec(instance);
    // Assert — optional undefined field is omitted or null in output
    expect(result.profile).toBeUndefined();
  });
});
