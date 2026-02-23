import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, IsString, IsNumber, IsBoolean, IsOptional, IsDefined, IsISIN, IsISSN, Min } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class SimpleDto {
  @IsString()
  name!: string;

  @IsNumber()
  age!: number;
}

class OptionalFieldDto {
  @IsString()
  required!: string;

  @IsOptional()
  @IsString()
  optional?: string;
}

class BooleanDto {
  @IsBoolean()
  active!: boolean;
}

class IsinDto {
  @IsISIN()
  isin!: string;
}

class IssnDto {
  @IsISSN()
  issn!: string;
}

// ── H1: 내부 변수명 충돌 DTOs ─────────────────────────────────────────────

class CollisionOutDto {
  @IsString()
  out!: string;
}

class CollisionErrorsDto {
  @IsString()
  errors!: string;
}

class CollisionGroupsDto {
  @IsString()
  groups!: string;
}

// ── C2: @IsDefined DTOs ───────────────────────────────────────────────────────

class IsDefinedStringDto {
  @IsDefined()
  @IsString()
  value!: string;
}

class IsDefinedOptionalDto {
  @IsDefined()
  @IsOptional()
  @IsString()
  value!: string;
}

class IsDefinedNumberDto {
  @IsDefined()
  @IsNumber()
  value!: number;
}

/** @IsDefined 단독 — 다른 validation 없음 */
class IsDefinedOnlyDto {
  @IsDefined()
  value!: any;
}

// ── C4: NaN/Infinity 게이트 DTOs ──────────────────────────────────────────────

class IsNumberOnlyDto {
  @IsNumber()
  value!: number;
}

class IsNumberAllowNaNDto {
  @IsNumber({ allowNaN: true })
  value!: number;
}

class IsNumberAllowInfinityDto {
  @IsNumber({ allowInfinity: true })
  value!: number;
}

class MinOnlyDto {
  @Min(0)
  value!: number;
}

class IsNumberAndMinDto {
  @IsNumber()
  @Min(0)
  value!: number;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('deserialize — integration', () => {
  it('should deserialize plain object → DTO instance with valid input', async () => {
    seal();
    const result = await deserialize<SimpleDto>(SimpleDto, { name: 'Alice', age: 30 });
    expect(result).toBeInstanceOf(SimpleDto);
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(30);
  });

  it('should throw BakerValidationError when required string is missing', async () => {
    seal();
    await expect(deserialize(SimpleDto, { age: 30 })).rejects.toThrow();
  });

  it('should throw BakerValidationError when type mismatch (number given as string)', async () => {
    seal();
    await expect(deserialize(SimpleDto, { name: 123, age: 30 })).rejects.toThrow();
  });

  it('should accept optional field when absent', async () => {
    seal();
    const result = await deserialize<OptionalFieldDto>(OptionalFieldDto, { required: 'hello' });
    expect(result.required).toBe('hello');
    expect(result.optional).toBeUndefined();
  });

  it('should accept optional field when present with valid value', async () => {
    seal();
    const result = await deserialize<OptionalFieldDto>(OptionalFieldDto, { required: 'hi', optional: 'world' });
    expect(result.optional).toBe('world');
  });

  it('should throw when unsealed class is passed to deserialize', async () => {
    // seal() not called
    await expect(deserialize(SimpleDto, { name: 'x', age: 1 })).rejects.toThrow();
  });

  it('should deserialize boolean field', async () => {
    seal();
    const result = await deserialize<BooleanDto>(BooleanDto, { active: true });
    expect(result.active).toBe(true);
  });

  it('should throw when boolean field receives string', async () => {
    seal();
    await expect(deserialize(BooleanDto, { active: 'yes' })).rejects.toThrow();
  });

  // ── C3: ISIN / ISSN checksum validation via compiled executor ──────────────

  it('should throw when @IsISIN field value passes regex but fails Luhn checksum', async () => {
    // US0378331006 matches ISIN format regex but has wrong check digit (valid: US0378331005)
    seal();
    await expect(deserialize(IsinDto, { isin: 'US0378331006' })).rejects.toThrow();
  });

  it('should accept valid ISIN that passes both regex and Luhn checksum', async () => {
    seal();
    const result = await deserialize<IsinDto>(IsinDto, { isin: 'US0378331005' });
    expect(result.isin).toBe('US0378331005');
  });

  it('should throw when @IsISSN field value passes regex but fails mod-11 checksum', async () => {
    // 0378-5950 matches ISSN format regex but has wrong check digit (valid: 0378-5955)
    seal();
    await expect(deserialize(IssnDto, { issn: '0378-5950' })).rejects.toThrow();
  });

  it('should accept valid ISSN that passes both regex and mod-11 checksum', async () => {
    seal();
    const result = await deserialize<IssnDto>(IssnDto, { issn: '0378-5955' });
    expect(result.issn).toBe('0378-5955');
  });

  // ── H1: 내부 변수명 충돌 필드 (var _out, var _errors, var _groups) ────────

  it('should deserialize DTO when field name collides with internal variable "out"', async () => {
    // Arrange — field 'out' previously caused `var _out` redeclaration (overwrote the output object)
    seal();
    // Act
    const result = await deserialize<CollisionOutDto>(CollisionOutDto, { out: 'value' });
    // Assert
    expect(result).toBeInstanceOf(CollisionOutDto);
    expect(result.out).toBe('value');
  });

  it('should deserialize DTO when field name collides with internal variable "errors"', async () => {
    // Arrange — field 'errors' previously caused `var _errors` redeclaration
    seal();
    const result = await deserialize<CollisionErrorsDto>(CollisionErrorsDto, { errors: 'none' });
    expect(result).toBeInstanceOf(CollisionErrorsDto);
    expect(result.errors).toBe('none');
  });

  it('should deserialize DTO when field name collides with internal variable "groups"', async () => {
    // Arrange — field 'groups' previously caused `var _groups` to be overwritten
    seal();
    const result = await deserialize<CollisionGroupsDto>(CollisionGroupsDto, { groups: 'g1' });
    expect(result).toBeInstanceOf(CollisionGroupsDto);
    expect(result.groups).toBe('g1');
  });

  // ── C2: @IsDefined 로직 ────────────────────────────────────────────────────

  it('should throw when @IsDefined-only field receives undefined', async () => {
    // Arrange — @IsDefined alone (no @IsString etc.): currently undefined passes silently
    seal();
    await expect(deserialize(IsDefinedOnlyDto, { value: undefined })).rejects.toThrow();
  });

  it('should throw when @IsDefined + @IsOptional field receives undefined', async () => {
    // Arrange — @IsDefined takes priority; optional guard must be suppressed
    seal();
    await expect(deserialize(IsDefinedOptionalDto, { value: undefined })).rejects.toThrow();
  });

  it('should emit isDefined error code (not isString) when @IsDefined+@IsString field is undefined', async () => {
    // Arrange — isDefined check fires before type gate
    seal();
    try {
      await deserialize(IsDefinedStringDto, { value: undefined });
    } catch (e: any) {
      expect(Array.isArray(e.errors)).toBe(true);
      expect(e.errors.some((err: any) => err.code === 'isDefined')).toBe(true);
    }
  });

  it('should pass when @IsDefined field receives null', async () => {
    // Arrange — null !== undefined; isDefined check passes, null flows to @IsString (fails)
    seal();
    try {
      await deserialize(IsDefinedStringDto, { value: null });
    } catch (e: any) {
      // Error should be 'isString' (from type gate), NOT 'isDefined'
      expect(e.errors?.[0]?.code).not.toBe('isDefined');
    }
  });

  it('should pass when @IsDefined field receives empty string', async () => {
    // Arrange — "" is not undefined; @IsString accepts ""
    seal();
    const result = await deserialize<IsDefinedStringDto>(IsDefinedStringDto, { value: '' });
    expect(result.value).toBe('');
  });

  it('should pass when @IsDefined + @IsNumber field receives 0', async () => {
    // Arrange — 0 !== undefined; @IsNumber accepts 0
    seal();
    const result = await deserialize<IsDefinedNumberDto>(IsDefinedNumberDto, { value: 0 });
    expect(result.value).toBe(0);
  });

  // ── C4: NaN/Infinity 게이트 ────────────────────────────────────────────────

  it('should throw when @IsNumber field receives NaN', async () => {
    // Arrange — NaN is typeof number but fails isNumber check (allowNaN default false)
    seal();
    await expect(deserialize(IsNumberOnlyDto, { value: NaN })).rejects.toThrow();
  });

  it('should throw when @IsNumber field receives Infinity', async () => {
    // Arrange — Infinity is typeof number but fails isNumber check (allowInfinity default false)
    seal();
    await expect(deserialize(IsNumberOnlyDto, { value: Infinity })).rejects.toThrow();
  });

  it('should pass when @IsNumber({ allowNaN: true }) field receives NaN', async () => {
    // Arrange — type gate must not reject NaN; isNumber emit respects allowNaN option
    seal();
    const result = await deserialize<IsNumberAllowNaNDto>(IsNumberAllowNaNDto, { value: NaN });
    expect(result.value).toBeNaN();
  });

  it('should pass when @IsNumber({ allowInfinity: true }) field receives Infinity', async () => {
    // Arrange — type gate must not reject Infinity; isNumber emit respects allowInfinity option
    seal();
    const result = await deserialize<IsNumberAllowInfinityDto>(IsNumberAllowInfinityDto, { value: Infinity });
    expect(result.value).toBe(Infinity);
  });

  it('should assign NaN when @Min(0) only field receives NaN (no @IsNumber gate)', async () => {
    // Arrange — without @IsNumber, type gate only checks typeof. NaN passes min check (NaN<0 is false)
    seal();
    const result = await deserialize<MinOnlyDto>(MinOnlyDto, { value: NaN });
    expect(result.value).toBeNaN();
  });

  it('should throw isNumber error when @IsNumber + @Min receives NaN', async () => {
    // Arrange — isNumber emit catches NaN after type gate passes
    seal();
    await expect(deserialize(IsNumberAndMinDto, { value: NaN })).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M4: validation groups 런타임 필터링
// ─────────────────────────────────────────────────────────────────────────────

class AdminOnlyDto {
  @IsString({ groups: ['admin'] })
  secret!: string;

  @IsNumber()
  id!: number;
}

describe('M4 — validation groups runtime filtering', () => {
  afterEach(() => unseal());

  it('rule with groups runs when no runtime groups provided (no filter)', async () => {
    seal();
    // 'secret' is 123 (not string). Rule groups: ['admin'], runtime: no groups → rule RUNS
    await expect(deserialize(AdminOnlyDto, { secret: 123, id: 1 })).rejects.toThrow();
  });

  it('rule with groups runs when runtime groups match', async () => {
    seal();
    await expect(
      deserialize(AdminOnlyDto, { secret: 123, id: 1 }, { groups: ['admin'] }),
    ).rejects.toThrow();
  });

  it('rule with groups skipped when runtime groups do not match — invalid value passes', async () => {
    seal();
    // runtime group 'viewer' doesn't match 'admin' → isString rule skipped → 123 passes unvalidated
    const result = await deserialize<AdminOnlyDto>(AdminOnlyDto, { secret: 123, id: 1 }, { groups: ['viewer'] });
    expect((result as any).secret).toBe(123);
  });

  it('rule without groups always runs even when runtime groups provided', async () => {
    seal();
    // @IsNumber on id has no groups — always validated
    await expect(
      deserialize(AdminOnlyDto, { secret: 'ok', id: 'not-a-number' as any }, { groups: ['viewer'] }),
    ).rejects.toThrow();
  });
});
