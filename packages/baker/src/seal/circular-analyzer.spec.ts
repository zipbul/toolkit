import { describe, it, expect, afterEach } from 'bun:test';
import { analyzeCircular } from './circular-analyzer';
import { RAW } from '../symbols';
import type { RawClassMeta } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — RAW 메타 수동 설정
// ─────────────────────────────────────────────────────────────────────────────

function makeTypeMeta(fn: () => Function): RawClassMeta {
  return {
    field: {
      validation: [],
      transform: [],
      expose: [],
      exclude: null,
      type: { fn: fn as () => new (...args: any[]) => any },
      flags: {},
    },
  };
}

function makeDiscriminatorMeta(
  subTypes: { value: Function; name: string }[],
): RawClassMeta {
  return {
    field: {
      validation: [],
      transform: [],
      expose: [],
      exclude: null,
      type: {
        fn: () => subTypes[0].value as new (...args: any[]) => any,
        discriminator: { property: 'type', subTypes },
      },
      flags: {},
    },
  };
}

const emptyMerged: RawClassMeta = {};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeCircular', () => {
  afterEach(() => {
    // 테스트에서 설정한 RAW 제거
  });

  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should return false when DTO has no @Type fields', () => {
    // Arrange
    class NoTypeDto {}
    (NoTypeDto as any)[RAW] = {
      name: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const merged: RawClassMeta = {
      name: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const result = analyzeCircular(NoTypeDto, merged);
    // Assert
    expect(result).toBe(false);
  });

  it('should return false for linear A -> B chain with no cycle', () => {
    // Arrange
    class BDto {}
    (BDto as any)[RAW] = {};

    class ADto {}
    (ADto as any)[RAW] = makeTypeMeta(() => BDto);

    const merged = makeTypeMeta(() => BDto);
    // Act
    const result = analyzeCircular(ADto, merged);
    // Assert
    expect(result).toBe(false);
  });

  it('should return true when enableCircularCheck is true regardless of structure', () => {
    // Arrange
    class FlatDto {}
    (FlatDto as any)[RAW] = {};
    // Act
    const result = analyzeCircular(FlatDto, emptyMerged, { enableCircularCheck: true });
    // Assert
    expect(result).toBe(true);
  });

  it('should return false when enableCircularCheck is false regardless of structure', () => {
    // Arrange — circular setup
    class SelfDto {}
    (SelfDto as any)[RAW] = makeTypeMeta(() => SelfDto);
    // Act
    const result = analyzeCircular(SelfDto, makeTypeMeta(() => SelfDto), {
      enableCircularCheck: false,
    });
    // Assert
    expect(result).toBe(false);
  });

  it('should return false when referenced class has no RAW symbol', () => {
    // Arrange — B has no [RAW]
    class BNoRaw {}
    class ADto {}
    (ADto as any)[RAW] = makeTypeMeta(() => BNoRaw);
    const merged = makeTypeMeta(() => BNoRaw);
    // Act
    const result = analyzeCircular(ADto, merged);
    // Assert
    expect(result).toBe(false);
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should return true when class references itself (self-loop)', () => {
    // Arrange
    class SelfRefDto {}
    (SelfRefDto as any)[RAW] = makeTypeMeta(() => SelfRefDto);
    const merged = makeTypeMeta(() => SelfRefDto);
    // Act
    const result = analyzeCircular(SelfRefDto, merged);
    // Assert
    expect(result).toBe(true);
  });

  it('should return true for mutual reference A -> B -> A', () => {
    // Arrange
    class BDto2 {}
    class ADto2 {}

    (ADto2 as any)[RAW] = makeTypeMeta(() => BDto2);
    (BDto2 as any)[RAW] = makeTypeMeta(() => ADto2);

    const merged = makeTypeMeta(() => BDto2);
    // Act
    const result = analyzeCircular(ADto2, merged);
    // Assert
    expect(result).toBe(true);
  });

  it('should return true when discriminator subType cycles back', () => {
    // Arrange
    class ContentDto {}
    class ParentDto {}
    (ContentDto as any)[RAW] = makeTypeMeta(() => ParentDto);
    (ParentDto as any)[RAW] = makeDiscriminatorMeta([{ value: ContentDto, name: 'content' }]);

    const merged = makeDiscriminatorMeta([{ value: ContentDto, name: 'content' }]);
    // Act
    const result = analyzeCircular(ParentDto, merged);
    // Assert
    expect(result).toBe(true);
  });

  it('should detect cycle via second discriminator subType (covers discriminator loop body)', () => {
    // Arrange — A.fn → B (no cycle), A.discriminator.subTypes[1] → C → A (cycle)
    class BDto {}
    (BDto as any)[RAW] = {}; // no @Type, no cycle

    class CDto {}
    class ADto {}

    (CDto as any)[RAW] = makeTypeMeta(() => ADto); // C → A (creates cycle)
    (ADto as any)[RAW] = {
      field: {
        validation: [], transform: [], expose: [], exclude: null,
        type: {
          fn: () => BDto, // fn path goes to B → no cycle
          discriminator: {
            property: 'kind',
            subTypes: [
              { value: BDto, name: 'b' },
              { value: CDto, name: 'c' }, // ← discriminator path cycles via CDto→ADto
            ],
          },
        },
        flags: {},
      },
    };

    const merged = (ADto as any)[RAW];
    // Act
    const result = analyzeCircular(ADto, merged);
    // Assert
    expect(result).toBe(true);
  });

  // ── Corner ─────────────────────────────────────────────────────────────────

  it('should return true when enableCircularCheck is true even with no @Type fields', () => {
    // Arrange
    class SimpleDto {}
    (SimpleDto as any)[RAW] = {};
    // Act
    const result = analyzeCircular(SimpleDto, emptyMerged, { enableCircularCheck: true });
    // Assert
    expect(result).toBe(true);
  });

  it('should return false when enableCircularCheck is false even with a cycle', () => {
    // Arrange
    class CyclicDto {}
    (CyclicDto as any)[RAW] = makeTypeMeta(() => CyclicDto);
    const merged = makeTypeMeta(() => CyclicDto);
    // Act
    const result = analyzeCircular(CyclicDto, merged, { enableCircularCheck: false });
    // Assert
    expect(result).toBe(false);
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should return false when merged has no fields (empty object)', () => {
    // Arrange
    class EmptyDto {}
    (EmptyDto as any)[RAW] = {};
    // Act
    const result = analyzeCircular(EmptyDto, emptyMerged);
    // Assert
    expect(result).toBe(false);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('should return the same result on repeated calls (idempotent)', () => {
    // Arrange
    class IdemDto {}
    (IdemDto as any)[RAW] = {};
    // Act
    const first = analyzeCircular(IdemDto, emptyMerged);
    const second = analyzeCircular(IdemDto, emptyMerged);
    // Assert
    expect(first).toBe(second);
  });
});
