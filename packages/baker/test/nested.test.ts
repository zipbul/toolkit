import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, serialize, IsString, IsNumber, ValidateNested, Type } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class AddressDto {
  @IsString()
  street!: string;

  @IsString()
  city!: string;
}

class UserWithAddressDto {
  @IsString()
  name!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

class UserWithOptionalAddressDto {
  @IsString()
  name!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('nested — integration', () => {
  it('should deserialize nested DTO with valid input', async () => {
    seal();
    const result = await deserialize<UserWithAddressDto>(UserWithAddressDto, {
      name: 'Alice',
      address: { street: '123 Main St', city: 'Springfield' },
    });
    expect(result).toBeInstanceOf(UserWithAddressDto);
    expect(result.address).toBeInstanceOf(AddressDto);
    expect(result.address.street).toBe('123 Main St');
    expect(result.address.city).toBe('Springfield');
  });

  it('should throw validation error for invalid nested field', async () => {
    seal();
    await expect(deserialize(UserWithAddressDto, {
      name: 'Bob',
      address: { street: 123, city: 'Shelbyville' }, // street should be string
    })).rejects.toThrow();
  });

  it('should throw when nested object has missing required field', async () => {
    seal();
    await expect(deserialize(UserWithAddressDto, {
      name: 'Carol',
      address: { city: 'Capital City' }, // missing street
    })).rejects.toThrow();
  });

  it('should serialize instance with nested DTO', () => {
    seal();
    const dto = Object.assign(new UserWithAddressDto(), {
      name: 'Dave',
      address: Object.assign(new AddressDto(), { street: '456 Elm St', city: 'Shelbyville' }),
    });
    const result = serialize(dto);
    expect(result['name']).toBe('Dave');
    expect((result['address'] as Record<string, unknown>)['street']).toBe('456 Elm St');
    expect((result['address'] as Record<string, unknown>)['city']).toBe('Shelbyville');
  });
});
