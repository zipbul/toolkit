import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import {
  ArrayContains, ArrayNotContains, ArrayMinSize, ArrayMaxSize,
  ArrayUnique, ArrayNotEmpty,
} from './array';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsArray {};
  createdCtors.push(ctor);
  return ctor as any;
}

function getRaw(ctor: Function, key: string): any {
  return (ctor as any)[RAW]?.[key];
}

afterEach(() => {
  for (const ctor of createdCtors) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[RAW];
  }
  createdCtors.length = 0;
});

describe('array decorators — metadata collection', () => {
  it('@ArrayContains registers rule with ruleName "arrayContains"', () => {
    const Cls = makeClass();
    ArrayContains(['a'])(Cls.prototype, 'tags');
    expect(getRaw(Cls, 'tags').validation[0].rule.ruleName).toBe('arrayContains');
  });

  it('@ArrayNotContains registers rule with ruleName "arrayNotContains"', () => {
    const Cls = makeClass();
    ArrayNotContains(['x'])(Cls.prototype, 'tags');
    expect(getRaw(Cls, 'tags').validation[0].rule.ruleName).toBe('arrayNotContains');
  });

  it('@ArrayMinSize registers rule with ruleName "arrayMinSize"', () => {
    const Cls = makeClass();
    ArrayMinSize(1)(Cls.prototype, 'items');
    expect(getRaw(Cls, 'items').validation[0].rule.ruleName).toBe('arrayMinSize');
  });

  it('@ArrayMinSize rule passes for array with >= min elements', () => {
    const Cls = makeClass();
    ArrayMinSize(2)(Cls.prototype, 'items');
    const rule = getRaw(Cls, 'items').validation[0].rule;
    expect(rule([1, 2])).toBe(true);
    expect(rule([1])).toBe(false);
  });

  it('@ArrayMaxSize registers rule with ruleName "arrayMaxSize"', () => {
    const Cls = makeClass();
    ArrayMaxSize(5)(Cls.prototype, 'items');
    expect(getRaw(Cls, 'items').validation[0].rule.ruleName).toBe('arrayMaxSize');
  });

  it('@ArrayMaxSize rule passes for array with <= max elements', () => {
    const Cls = makeClass();
    ArrayMaxSize(3)(Cls.prototype, 'items');
    const rule = getRaw(Cls, 'items').validation[0].rule;
    expect(rule([1, 2, 3])).toBe(true);
    expect(rule([1, 2, 3, 4])).toBe(false);
  });

  it('@ArrayUnique registers rule with ruleName "arrayUnique"', () => {
    const Cls = makeClass();
    ArrayUnique()(Cls.prototype, 'ids');
    expect(getRaw(Cls, 'ids').validation[0].rule.ruleName).toBe('arrayUnique');
  });

  it('@ArrayNotEmpty registers rule with ruleName "arrayNotEmpty"', () => {
    const Cls = makeClass();
    ArrayNotEmpty()(Cls.prototype, 'list');
    expect(getRaw(Cls, 'list').validation[0].rule.ruleName).toBe('arrayNotEmpty');
  });

  it('@ArrayNotEmpty forwards message option', () => {
    const Cls = makeClass();
    ArrayNotEmpty({ message: 'must not be empty array' })(Cls.prototype, 'list');
    expect(getRaw(Cls, 'list').validation[0].message).toBe('must not be empty array');
  });
});
