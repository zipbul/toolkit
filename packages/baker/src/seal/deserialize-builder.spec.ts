import { describe, it, expect } from 'bun:test';
import { buildDeserializeCode } from './deserialize-builder';
import { isErr, err } from '@zipbul/result';
import { SEALED } from '../symbols';
import { isString } from '../rules/typechecker';
import { isNumber } from '../rules/typechecker';
import { min, max } from '../rules/number';
import { minLength } from '../rules/string';
import type { RawClassMeta, SealedExecutors } from '../types';
import type { SealOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function run<T>(
  Class: new (...a: any[]) => T,
  merged: RawClassMeta,
  options?: SealOptions,
  input?: unknown,
) {
  const exec = buildDeserializeCode<T>(Class, merged, options, false);
  return exec(input !== undefined ? input : {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDeserializeCode', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should return class instance when @IsString field receives valid string', async () => {
    // Arrange
    class NameDto { name!: string; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const result = await run(NameDto, merged, undefined, { name: 'Alice' });
    // Assert
    expect(result).toBeInstanceOf(NameDto);
    expect((result as NameDto).name).toBe('Alice');
  });

  it('should return invalidInput error when input is null', async () => {
    // Arrange
    class NullDto {}
    const merged: RawClassMeta = {};
    const exec = buildDeserializeCode(NullDto, merged, undefined, false);
    // Act
    const result = await exec(null);
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].path).toBe('');
    expect(errs[0].code).toBe('invalidInput');
  });

  it('should return invalidInput error when input is an array', async () => {
    // Arrange
    class ArrDto {}
    const merged: RawClassMeta = {};
    const exec = buildDeserializeCode(ArrDto, merged, undefined, false);
    // Act
    const result = await exec([1, 2, 3]);
    // Assert
    expect(isErr(result)).toBe(true);
    expect((result as any).data[0].code).toBe('invalidInput');
  });

  it('should skip optional field when value is undefined (@IsOptional)', async () => {
    // Arrange
    class OptDto { age?: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [{ rule: isNumber() }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    // Act
    const result = await run(OptDto, merged, undefined, {});
    // Assert — success, age is not validated (undefined skipped)
    expect(result).toBeInstanceOf(OptDto);
    expect(isErr(result)).toBe(false);
  });

  it('should use class default value when exposeDefaultValues:true and key is absent from input', async () => {
    // Arrange
    class DefaultDto { name: string = 'anonymous'; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(DefaultDto, merged, { exposeDefaultValues: true }, false);
    // Act — no 'name' in input
    const result = await exec({});
    // Assert — uses default 'anonymous', passes isString validation
    expect(result).toBeInstanceOf(DefaultDto);
    expect((result as DefaultDto).name).toBe('anonymous');
  });

  it('should extract from mapped key when field has deserializeOnly @Expose name', async () => {
    // Arrange
    class MappedDto { displayName!: string; }
    const merged: RawClassMeta = {
      displayName: {
        validation: [],
        transform: [],
        expose: [{ name: 'user_name', deserializeOnly: true }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    // Act
    const result = await run(MappedDto, merged, undefined, { user_name: 'Bob' });
    // Assert
    expect((result as MappedDto).displayName).toBe('Bob');
  });

  it('should collect all errors when stopAtFirstError is false (default)', async () => {
    // Arrange
    class MultiDto { name!: string; age!: number; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
      age: { validation: [{ rule: isNumber() }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(MultiDto, merged, { stopAtFirstError: false }, false);
    // Act — both fields invalid
    const result = await exec({ name: 42, age: 'not-a-number' });
    // Assert — collects both errors
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });

  it('should return only first error when stopAtFirstError is true', async () => {
    // Arrange
    class StopDto { name!: string; age!: number; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
      age: { validation: [{ rule: isNumber() }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(StopDto, merged, { stopAtFirstError: true }, false);
    // Act — both fields invalid
    const result = await exec({ name: 42, age: 'bad' });
    // Assert — early return with 1 error
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs.length).toBe(1);
  });

  it('should validate @IsNumber + @Min + @Max and assign when all pass', async () => {
    // Arrange
    class NumDto { age!: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [{ rule: isNumber() }, { rule: min(0) }, { rule: max(150) }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    // Act
    const result = await run(NumDto, merged, undefined, { age: 25 });
    // Assert
    expect((result as NumDto).age).toBe(25);
  });

  it('should include sourceURL comment referencing class name in generated code', () => {
    // Arrange
    class SourceUrlDto {}
    const exec = buildDeserializeCode(SourceUrlDto, {}, undefined, false);
    // Assert — function toString contains sourceURL
    const src = exec.toString();
    expect(src).toContain('SourceUrlDto');
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should produce error with correct path and code when @IsString field is invalid', async () => {
    // Arrange
    class PathDto { email!: string; }
    const merged: RawClassMeta = {
      email: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(PathDto, merged, undefined, false);
    // Act
    const result = await exec({ email: 123 });
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].path).toBe('email');
    expect(errs[0].code).toBe('isString');
  });

  it('should return error when required field is absent from input', async () => {
    // Arrange
    class ReqDto { name!: string; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(ReqDto, merged, undefined, false);
    // Act
    const result = await exec({});
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs.some((e: any) => e.path === 'name')).toBe(true);
  });

  it('should treat @IsDefined as overriding @IsOptional (undefined still fails)', async () => {
    // Arrange
    class IsDef { val!: string; }
    const merged: RawClassMeta = {
      val: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true, isDefined: true }, // IsDefined wins
      },
    };
    const exec = buildDeserializeCode(IsDef, merged, undefined, false);
    // Act — undefined should fail (no optional guard when isDefined)
    const result = await exec({});
    // Assert
    expect(isErr(result)).toBe(true);
  });

  // ── Corner ─────────────────────────────────────────────────────────────────

  it('should use optional guard only (not exposeDefault guard) when @IsOptional + exposeDefaultValues', async () => {
    // Arrange
    class OptDefault { name?: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    const exec = buildDeserializeCode(OptDefault, merged, { exposeDefaultValues: true }, false);
    // Act — key absent + isOptional → skip (not error)
    const result = await exec({});
    // Assert — no error (optional guard subsumes exposeDefault guard)
    expect(isErr(result)).toBe(false);
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should return empty instance when DTO has no fields', async () => {
    // Arrange
    class EmptyDto {}
    const exec = buildDeserializeCode(EmptyDto, {}, undefined, false);
    // Act
    const result = await exec({});
    // Assert
    expect(result).toBeInstanceOf(EmptyDto);
    expect(isErr(result)).toBe(false);
  });
});

  // ── message/context ────────────────────────────────────────────────────────

  it('should include string message in BakerError when validation fails', async () => {
    // Arrange
    class MsgDto { name!: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString, message: '이름은 문자열이어야 합니다' }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act
    const result = await run(MsgDto, merged, undefined, { name: 42 });
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].message).toBe('이름은 문자열이어야 합니다');
  });

  it('should include function message result in BakerError when validation fails', async () => {
    // Arrange
    class FnMsgDto { age!: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [{
          rule: isNumber(),
          message: (args: { property: string; value: unknown }) => `${args.property} must be a number, got ${typeof args.value}`,
        }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act
    const result = await run(FnMsgDto, merged, undefined, { age: 'hello' });
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].message).toContain('age must be a number');
  });

  it('should include context in BakerError when validation fails', async () => {
    // Arrange
    class CtxDto { name!: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString, context: { httpStatus: 400, extra: 'info' } }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act
    const result = await run(CtxDto, merged, undefined, { name: 99 });
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].context).toEqual({ httpStatus: 400, extra: 'info' });
  });

  it('should not include message/context when not set (backward compat)', async () => {
    // Arrange
    class NoMsgDto { name!: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act
    const result = await run(NoMsgDto, merged, undefined, { name: 42 });
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].message).toBeUndefined();
    expect(errs[0].context).toBeUndefined();
  });

  // ── each: true with Set ────────────────────────────────────────────────────

  it('should validate each element when value is a Set and each:true', async () => {
    // Arrange
    class SetDto { names!: Set<string>; }
    const merged: RawClassMeta = {
      names: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act — invalid: Set contains non-string
    const result = await run(SetDto, merged, undefined, { names: new Set(['hello', 42, 'world']) });
    // Assert
    expect(isErr(result)).toBe(true);
  });

  it('should pass when Set contains all valid elements with each:true', async () => {
    // Arrange
    class SetDto2 { names!: Set<string>; }
    const merged: RawClassMeta = {
      names: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act — valid: all elements are strings
    const result = await run(SetDto2, merged, undefined, { names: new Set(['hello', 'world']) });
    // Assert
    expect(isErr(result)).toBe(false);
  });

  // ── each: true with Map ────────────────────────────────────────────────────

  it('should validate each value when input is a Map and each:true', async () => {
    // Arrange
    class MapDto { tags!: Map<string, string>; }
    const merged: RawClassMeta = {
      tags: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act — invalid: Map value is not string
    const result = await run(MapDto, merged, undefined, { tags: new Map([['k1', 'v1'], ['k2', 42]]) });
    // Assert
    expect(isErr(result)).toBe(true);
  });

  it('should pass when Map has all valid values with each:true', async () => {
    // Arrange
    class MapDto2 { tags!: Map<string, string>; }
    const merged: RawClassMeta = {
      tags: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    // Act — valid: all Map values are strings
    const result = await run(MapDto2, merged, undefined, { tags: new Map([['k1', 'v1'], ['k2', 'v2']]) });
    // Assert
    expect(isErr(result)).toBe(false);
  });

// ─── stopAtFirstError: true — each:true with Set/Map (covers L507-528) ────────

  it('should fail at first error with Set and each:true when stopAtFirstError:true', async () => {
    class SetStopDto { names!: Set<string>; }
    const merged: RawClassMeta = {
      names: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    const exec = buildDeserializeCode<SetStopDto>(SetStopDto, merged, { stopAtFirstError: true }, false, false);
    const result = await exec({ names: new Set(['hello', 42 as any]) });
    expect(isErr(result)).toBe(true);
  });

  it('should pass with Set and each:true when stopAtFirstError:true and all valid', async () => {
    class SetStopDto2 { names!: Set<string>; }
    const merged: RawClassMeta = {
      names: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    const exec = buildDeserializeCode<SetStopDto2>(SetStopDto2, merged, { stopAtFirstError: true }, false, false);
    const result = await exec({ names: new Set(['a', 'b']) });
    expect(isErr(result)).toBe(false);
  });

  it('should fail with Map and each:true when stopAtFirstError:true', async () => {
    class MapStopDto { tags!: Map<string, string>; }
    const merged: RawClassMeta = {
      tags: {
        validation: [{ rule: isString, each: true }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    const exec = buildDeserializeCode<MapStopDto>(MapStopDto, merged, { stopAtFirstError: true }, false, false);
    const result = await exec({ tags: new Map([['k1', 'v1'], ['k2', 42 as any]]) });
    expect(isErr(result)).toBe(true);
  });

// ─── @ValidateIf flag (covers L183-184, L233) ─────────────────────────────────

  it('should skip validation when @ValidateIf returns false', async () => {
    class ConditionalDto { age?: number; }
    const validateIfFn = (input: object) => (input as any).checkAge === true;
    const merged: RawClassMeta = {
      age: {
        validation: [{ rule: isNumber() }],
        transform: [], expose: [], exclude: null, type: null,
        flags: { validateIf: validateIfFn, isOptional: true },
      },
    };
    const exec = buildDeserializeCode<ConditionalDto>(ConditionalDto, merged, undefined, false, false);
    const result = await exec({ checkAge: false, age: 'notanumber' as any });
    expect(isErr(result)).toBe(false);
  });

  it('should run validation when @ValidateIf returns true', async () => {
    class ConditionalDto2 { age?: number; }
    const validateIfFn = (input: object) => (input as any).checkAge === true;
    const merged: RawClassMeta = {
      age: {
        validation: [{ rule: isNumber() }],
        transform: [], expose: [], exclude: null, type: null,
        flags: { validateIf: validateIfFn, isOptional: true },
      },
    };
    const exec = buildDeserializeCode<ConditionalDto2>(ConditionalDto2, merged, undefined, false, false);
    const result = await exec({ checkAge: true, age: 'notanumber' as any });
    expect(isErr(result)).toBe(true);
  });

// ─── needsCircularCheck: true (covers L79-82) ─────────────────────────────────

  it('should generate circular-check code when needsCircularCheck is true', async () => {
    class CircularDto { name!: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    const exec = buildDeserializeCode<CircularDto>(CircularDto, merged, undefined, true, false);
    const result = await exec({ name: 'Alice' });
    expect(isErr(result)).toBe(false);
  });

// ─── exclude: deserializeOnly skip (covers L162-163) ─────────────────────────

  it('should skip field when exclude is set without serializeOnly (deserializeOnly)', async () => {
    class ExcludeDto { name!: string; secret?: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
      secret: {
        validation: [],
        transform: [], expose: [], exclude: { serializeOnly: false }, type: null, flags: {},
      },
    };
    const exec = buildDeserializeCode<ExcludeDto>(ExcludeDto, merged, undefined, false, false);
    const result = await exec({ name: 'Alice', secret: 'hidden' });
    expect(isErr(result)).toBe(false);
    expect((result as any).secret).toBeUndefined();
  });

// ─── expose.every(serializeOnly) skip (covers L167-168) ──────────────────────

  it('should skip field where all exposures are serializeOnly', async () => {
    class ExposeOnlyDto { name!: string; outOnly?: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
      outOnly: {
        validation: [],
        transform: [],
        expose: [{ serializeOnly: true }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildDeserializeCode<ExposeOnlyDto>(ExposeOnlyDto, merged, undefined, false, false);
    const result = await exec({ name: 'Alice', outOnly: 'ignored' });
    expect(isErr(result)).toBe(false);
    expect((result as any).outOnly).toBeUndefined();
  });

// ─── stopAtFirstError + message extras (covers L330) ─────────────────────────

  it('should include message extras in error when stopAtFirstError:true', async () => {
    class MsgDto { name!: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString, message: 'Must be a string' }],
        transform: [], expose: [], exclude: null, type: null, flags: {},
      },
    };
    const exec = buildDeserializeCode<MsgDto>(MsgDto, merged, { stopAtFirstError: true }, false, false);
    const result = await exec({ name: 42 as any });
    expect(isErr(result)).toBe(true);
  });

// ─── nested type (covers L598-609, L623-627) ─────────────────────────────────

  it('should deserialize nested DTO field when sealed executor is provided', async () => {
    class AddressDto { street!: string; }
    (AddressDto as any)[SEALED] = {
      _deserialize: (input: unknown) => {
        const i = input as any;
        if (typeof i?.street === 'string') {
          const a = new AddressDto();
          a.street = i.street;
          return a;
        }
        return err([{ path: 'street', code: 'isString' }]);
      },
      _serialize: () => ({}),
      _isAsync: false,
      _isSerializeAsync: false,
    } satisfies SealedExecutors<AddressDto>;

    class PersonDto { address!: AddressDto; }
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
    const exec = buildDeserializeCode<PersonDto>(PersonDto, merged, undefined, false, false);
    const result = await exec({ address: { street: '123 Main St' } });
    expect(isErr(result)).toBe(false);
    expect((result as PersonDto).address.street).toBe('123 Main St');
  });

  it('should return error when nested DTO deserialization fails', async () => {
    class PhoneDto { number!: string; }
    (PhoneDto as any)[SEALED] = {
      _deserialize: (input: unknown) => {
        const i = input as any;
        if (typeof i?.number === 'string') {
          const p = new PhoneDto();
          p.number = i.number;
          return p;
        }
        return err([{ path: 'number', code: 'isString' }]);
      },
      _serialize: () => ({}),
      _isAsync: false,
      _isSerializeAsync: false,
    } satisfies SealedExecutors<PhoneDto>;

    class ContactDto { phone!: PhoneDto; }
    const merged: RawClassMeta = {
      phone: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => PhoneDto as any },
        flags: { validateNested: true },
      },
    };
    const exec = buildDeserializeCode<ContactDto>(ContactDto, merged, undefined, false, false);
    // phone.number is not a string → nested error
    const result = await exec({ phone: { number: 42 } });
    expect(isErr(result)).toBe(true);
  });

  it('should return nested error when stopAtFirstError:true (covers L623-627)', async () => {
    class CityDto { name!: string; }
    (CityDto as any)[SEALED] = {
      _deserialize: (input: unknown) => {
        const i = input as any;
        if (typeof i?.name === 'string') {
          const c = new CityDto();
          c.name = i.name;
          return c;
        }
        return err([{ path: 'name', code: 'isString' }]);
      },
      _serialize: () => ({}),
      _isAsync: false,
      _isSerializeAsync: false,
    } satisfies SealedExecutors<CityDto>;

    class LocationDto { city!: CityDto; }
    const merged: RawClassMeta = {
      city: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => CityDto as any },
        flags: { validateNested: true },
      },
    };
    const exec = buildDeserializeCode<LocationDto>(LocationDto, merged, { stopAtFirstError: true }, false, false);
    // city.name is missing → nested error propagation
    const result = await exec({ city: { name: 42 } });
    expect(isErr(result)).toBe(true);
  });

// ─── nested hasEach (covers L582-596) ─────────────────────────────────────────

  it('should deserialize array of nested DTOs when each:true (hasEach path)', async () => {
    class TagDto { label!: string; }
    (TagDto as any)[SEALED] = {
      _deserialize: (input: unknown) => {
        const i = input as any;
        if (typeof i?.label === 'string') {
          const t = new TagDto();
          t.label = i.label;
          return t;
        }
        return err([{ path: 'label', code: 'isString' }]);
      },
      _serialize: () => ({}),
      _isAsync: false,
      _isSerializeAsync: false,
    } satisfies SealedExecutors<TagDto>;

    // A no-op rule to trigger hasEach:true path without failing validation
    const alwaysPass = ((v: unknown) => true) as any;
    alwaysPass.emit = (_varName: string, _ctx: any) => '';
    alwaysPass.ruleName = 'alwaysPass';

    class PostDto { tags!: TagDto[]; }
    const merged: RawClassMeta = {
      tags: {
        validation: [{ rule: alwaysPass, each: true }],
        transform: [],
        expose: [],
        exclude: null,
        type: { fn: () => TagDto as any },
        flags: { validateNested: true },
      },
    };
    const exec = buildDeserializeCode<PostDto>(PostDto, merged, undefined, false, false);
    const result = await exec({ tags: [{ label: 'ts' }, { label: 'js' }] });
    expect(isErr(result)).toBe(false);
  });
