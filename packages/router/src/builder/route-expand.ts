import type { PathPart } from '../tree';

import { PathPartType } from '../tree';
import { OptionalParamDefaults } from './optional-param-defaults';

const MAX_OPTIONAL_SEGMENTS_PER_ROUTE = 4;

interface ExpandedRoute {
  parts: PathPart[];
  handlerIndex: number;
  isOptionalExpansion: boolean;
}

interface OptionalCollection {
  indices: number[];
  names: string[];
}

function expandOptional(parts: PathPart[], handlerIndex: number, optionalDefaults: OptionalParamDefaults): ExpandedRoute[] {
  let firstOptional = -1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.type === PathPartType.Param && p.optional) {
      firstOptional = i;
      break;
    }
  }
  if (firstOptional === -1) {
    return [{ parts, handlerIndex, isOptionalExpansion: false }];
  }

  const collection = collectOptionalIndices(parts, firstOptional);
  optionalDefaults.record(handlerIndex, collection.names);
  return enumerateExpansions(parts, handlerIndex, collection.indices);
}

function collectOptionalIndices(parts: PathPart[], start: number): OptionalCollection {
  const indices: number[] = [];
  const names: string[] = [];

  for (let i = start; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === PathPartType.Param && part.optional) {
      indices.push(i);
      names.push(part.name);
    }
  }

  return { indices, names };
}

function createStaticPart(value: string): PathPart {
  const body = value.length > 1 ? value.slice(1) : '';
  const segments = body === '' ? [] : body.split('/');

  return { type: PathPartType.Static, value, segments };
}

function enumerateExpansions(parts: PathPart[], handlerIndex: number, optionalIndices: number[]): ExpandedRoute[] {
  const result: ExpandedRoute[] = [];

  const fullParts = parts.map(p => (p.type === PathPartType.Param && p.optional ? { ...p, optional: false } : p));
  result.push({ parts: fullParts, handlerIndex, isOptionalExpansion: false });

  for (let bit = 1; bit < 1 << optionalIndices.length; bit++) {
    const filtered = filterDroppedSegments(parts, optionalIndices, bit);
    const merged = mergeStaticParts(filtered);
    const variantParts = merged.length > 0 ? merged : [createStaticPart('/')];
    result.push({ parts: variantParts, handlerIndex, isOptionalExpansion: true });
  }

  return result;
}

function filterDroppedSegments(parts: PathPart[], optionalIndices: number[], dropMask: number): PathPart[] {
  const filtered: PathPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (isDroppedAt(i, optionalIndices, dropMask)) {
      trimTrailingSlashOnDrop(filtered);
      continue;
    }
    const part = parts[i]!;
    filtered.push(part.type === PathPartType.Param && part.optional ? { ...part, optional: false } : part);
  }
  return filtered;
}

function isDroppedAt(partIndex: number, optionalIndices: number[], dropMask: number): boolean {
  for (let j = 0; j < optionalIndices.length; j++) {
    if (optionalIndices[j] === partIndex && dropMask & (1 << j)) {
      return true;
    }
  }
  return false;
}

function trimTrailingSlashOnDrop(filtered: PathPart[]): void {
  if (filtered.length === 0) {
    return;
  }
  const prev = filtered[filtered.length - 1]!;
  if (prev.type !== PathPartType.Static || !prev.value.endsWith('/')) {
    return;
  }
  const trimmed = prev.value.slice(0, -1);
  if (trimmed.length > 0) {
    filtered[filtered.length - 1] = createStaticPart(trimmed);
  } else {
    filtered.pop();
  }
}

function mergeStaticParts(parts: PathPart[]): PathPart[] {
  const result: PathPart[] = [];

  for (const part of parts) {
    if (part.type === PathPartType.Static && result.length > 0) {
      const prev = result[result.length - 1]!;

      if (prev.type === PathPartType.Static) {
        let merged = prev.value + part.value;

        merged = merged.replace(/\/\//g, '/');
        result[result.length - 1] = createStaticPart(merged);

        continue;
      }
    }

    result.push(part);
  }

  return result;
}

export { expandOptional, MAX_OPTIONAL_SEGMENTS_PER_ROUTE };
