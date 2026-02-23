import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, serialize, IsString, IsNumber, ValidateNested, Type, BakerValidationError } from '../index';
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

  it('should serialize instance with nested DTO', async () => {
    seal();
    const dto = Object.assign(new UserWithAddressDto(), {
      name: 'Dave',
      address: Object.assign(new AddressDto(), { street: '456 Elm St', city: 'Shelbyville' }),
    });
    const result = await serialize(dto);
    expect(result['name']).toBe('Dave');
    expect((result['address'] as Record<string, unknown>)['street']).toBe('456 Elm St');
    expect((result['address'] as Record<string, unknown>)['city']).toBe('Shelbyville');
  });

  // ─── BUG-1: stopAtFirstError + nested array ────────────────────────────────

  it('should deserialize nested array with stopAtFirstError=true and valid items', async () => {
    class ItemDto {
      @IsString() name!: string;
    }
    class OrderDto {
      @ValidateNested({ each: true })
      @Type(() => ItemDto)
      items!: ItemDto[];
    }
    seal({ stopAtFirstError: true });
    const result = await deserialize<OrderDto>(OrderDto, {
      items: [{ name: 'A' }, { name: 'B' }],
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toBeInstanceOf(ItemDto);
    expect(result.items[0].name).toBe('A');
  });

  it('should return first error for nested array with stopAtFirstError=true and invalid items', async () => {
    class ItemDto {
      @IsString() name!: string;
    }
    class OrderDto {
      @ValidateNested({ each: true })
      @Type(() => ItemDto)
      items!: ItemDto[];
    }
    seal({ stopAtFirstError: true });
    try {
      await deserialize(OrderDto, {
        items: [{ name: 123 }, { name: 456 }],
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      const err = e as BakerValidationError;
      // stopAtFirstError → only first error returned
      expect(err.errors).toHaveLength(1);
      expect(err.errors[0].path).toBe('items[0].name');
      expect(err.errors[0].code).toBe('isString');
    }
  });

  it('should return isArray error for nested array with stopAtFirstError=true and non-array input', async () => {
    class ItemDto {
      @IsString() name!: string;
    }
    class OrderDto {
      @ValidateNested({ each: true })
      @Type(() => ItemDto)
      items!: ItemDto[];
    }
    seal({ stopAtFirstError: true });
    try {
      await deserialize(OrderDto, { items: 'not an array' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      const err = e as BakerValidationError;
      expect(err.errors[0].code).toBe('isArray');
    }
  });

  it('should handle empty nested array with stopAtFirstError=true', async () => {
    class ItemDto {
      @IsString() name!: string;
    }
    class OrderDto {
      @ValidateNested({ each: true })
      @Type(() => ItemDto)
      items!: ItemDto[];
    }
    seal({ stopAtFirstError: true });
    const result = await deserialize<OrderDto>(OrderDto, { items: [] });
    expect(result.items).toHaveLength(0);
  });

  // ─── PB-3: keepDiscriminatorProperty ──────────────────────────────────────

  it('should keep discriminator property in output when keepDiscriminatorProperty is true', async () => {
    class TextContent {
      @IsString() body!: string;
    }
    class ImageContent {
      @IsString() url!: string;
    }
    class NotificationDto {
      @ValidateNested()
      @Type(() => TextContent, {
        discriminator: {
          property: 'type',
          subTypes: [
            { value: TextContent, name: 'text' },
            { value: ImageContent, name: 'image' },
          ],
        },
        keepDiscriminatorProperty: true,
      })
      content!: TextContent | ImageContent;
    }
    seal();
    const result = await deserialize<NotificationDto>(NotificationDto, {
      content: { type: 'text', body: 'hello' },
    });
    expect(result.content).toBeInstanceOf(TextContent);
    expect((result.content as TextContent).body).toBe('hello');
    expect((result.content as any).type).toBe('text');
  });

  it('should NOT keep discriminator property when keepDiscriminatorProperty is false/undefined', async () => {
    class TextContent2 {
      @IsString() body!: string;
    }
    class NotificationDto2 {
      @ValidateNested()
      @Type(() => TextContent2, {
        discriminator: {
          property: 'type',
          subTypes: [
            { value: TextContent2, name: 'text' },
          ],
        },
        // keepDiscriminatorProperty not set
      })
      content!: TextContent2;
    }
    seal();
    const result = await deserialize<NotificationDto2>(NotificationDto2, {
      content: { type: 'text', body: 'world' },
    });
    expect(result.content).toBeInstanceOf(TextContent2);
    expect((result.content as any).type).toBeUndefined();
  });

  it('should throw invalidDiscriminator for unknown discriminator value', async () => {
    class TextContent3 {
      @IsString() body!: string;
    }
    class NotificationDto3 {
      @ValidateNested()
      @Type(() => TextContent3, {
        discriminator: {
          property: 'type',
          subTypes: [
            { value: TextContent3, name: 'text' },
          ],
        },
        keepDiscriminatorProperty: true,
      })
      content!: TextContent3;
    }
    seal();
    try {
      await deserialize(NotificationDto3, {
        content: { type: 'unknown', body: 'x' },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      const err = e as BakerValidationError;
      expect(err.errors.some(e => e.code === 'invalidDiscriminator')).toBe(true);
    }
  });

  // ─── PB-4: serialize null nested ────────────────────────────────────────────

  it('should handle null nested field in serialize without crashing', async () => {
    class ParentDto {
      @ValidateNested()
      @Type(() => AddressDto)
      address!: AddressDto | null;
    }
    seal();
    const dto = new ParentDto();
    dto.address = null;
    const result = await serialize(dto);
    expect(result['address']).toBeNull();
  });
});
