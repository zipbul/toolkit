import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import {
  IsString, IsNumber, IsBoolean, IsDate, IsEnum, IsInt, IsArray, IsObject,
} from './typechecker';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorsTypechecker {};
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

describe('typechecker decorators — metadata collection', () => {
  it('@IsString registers rule with ruleName "isString"', () => {
    const Cls = makeClass();
    IsString()(Cls.prototype, 'name');
    expect(getRaw(Cls, 'name').validation[0].rule.ruleName).toBe('isString');
  });

  it('@IsNumber registers rule with ruleName "isNumber"', () => {
    const Cls = makeClass();
    IsNumber()(Cls.prototype, 'age');
    expect(getRaw(Cls, 'age').validation[0].rule.ruleName).toBe('isNumber');
  });

  it('@IsNumber passes options to rule', () => {
    const Cls = makeClass();
    IsNumber({ allowNaN: true, allowInfinity: false })(Cls.prototype, 'score');
    const rule = getRaw(Cls, 'score').validation[0].rule;
    expect(rule.ruleName).toBe('isNumber');
    // NaN should pass with allowNaN: true
    expect(rule(NaN)).toBe(true);
    // NaN should fail without allowNaN
    const Cls2 = makeClass();
    IsNumber()(Cls2.prototype, 'x');
    const defaultRule = getRaw(Cls2, 'x').validation[0].rule;
    expect(defaultRule(NaN)).toBe(false);
  });

  it('@IsBoolean registers rule with ruleName "isBoolean"', () => {
    const Cls = makeClass();
    IsBoolean()(Cls.prototype, 'active');
    expect(getRaw(Cls, 'active').validation[0].rule.ruleName).toBe('isBoolean');
  });

  it('@IsDate registers rule with ruleName "isDate"', () => {
    const Cls = makeClass();
    IsDate()(Cls.prototype, 'createdAt');
    expect(getRaw(Cls, 'createdAt').validation[0].rule.ruleName).toBe('isDate');
  });

  it('@IsEnum registers rule with ruleName "isEnum"', () => {
    const Cls = makeClass();
    enum Dir { Up, Down }
    IsEnum(Dir)(Cls.prototype, 'dir');
    expect(getRaw(Cls, 'dir').validation[0].rule.ruleName).toBe('isEnum');
  });

  it('@IsInt registers rule with ruleName "isInt"', () => {
    const Cls = makeClass();
    IsInt()(Cls.prototype, 'count');
    expect(getRaw(Cls, 'count').validation[0].rule.ruleName).toBe('isInt');
  });

  it('@IsArray registers rule with ruleName "isArray"', () => {
    const Cls = makeClass();
    IsArray()(Cls.prototype, 'items');
    expect(getRaw(Cls, 'items').validation[0].rule.ruleName).toBe('isArray');
  });

  it('@IsObject registers rule with ruleName "isObject"', () => {
    const Cls = makeClass();
    IsObject()(Cls.prototype, 'meta');
    expect(getRaw(Cls, 'meta').validation[0].rule.ruleName).toBe('isObject');
  });

  it('@IsString forwards each/groups options', () => {
    const Cls = makeClass();
    IsString({ each: true, groups: ['admin'] })(Cls.prototype, 'tags');
    const rd = getRaw(Cls, 'tags').validation[0];
    expect(rd.each).toBe(true);
    expect(rd.groups).toEqual(['admin']);
  });

  it('@IsString message option stored in RuleDef', () => {
    const Cls = makeClass();
    IsString({ message: 'must be string' })(Cls.prototype, 'val');
    expect(getRaw(Cls, 'val').validation[0].message).toBe('must be string');
  });
});
