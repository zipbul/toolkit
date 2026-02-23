import { describe, it, expect, afterEach } from 'bun:test';
import { globalRegistry } from '../registry';
import {
  IsMobilePhone,
  IsPostalCode,
  IsIdentityCard,
  IsPassportNumber,
} from './locales';

const RAW = Symbol.for('baker:raw');
const createdCtors: Function[] = [];

function makeClass(): new () => any {
  const ctor = class TestDecoratorLocales {};
  createdCtors.push(ctor);
  return ctor as any;
}

function ruleAt(ctor: Function, key: string, idx = 0) {
  return (ctor as any)[RAW]?.[key]?.validation?.[idx]?.rule;
}

function ruleDef(ctor: Function, key: string, idx = 0) {
  return (ctor as any)[RAW]?.[key]?.validation?.[idx];
}

afterEach(() => {
  for (const ctor of createdCtors) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[RAW];
  }
  createdCtors.length = 0;
});

describe('IsMobilePhone', () => {
  it('should register rule with ruleName isMobilePhone when applied', () => {
    const Cls = makeClass();
    IsMobilePhone('ko-KR')(Cls.prototype, 'phone');
    expect(ruleAt(Cls, 'phone')?.ruleName).toBe('isMobilePhone');
  });

  it('should pass through options.each to RuleDef', () => {
    const Cls = makeClass();
    IsMobilePhone('ko-KR', { each: true })(Cls.prototype, 'phones');
    expect(ruleDef(Cls, 'phones')?.each).toBe(true);
  });

  it('should pass through options.groups to RuleDef', () => {
    const Cls = makeClass();
    IsMobilePhone('ko-KR', { groups: ['admin'] })(Cls.prototype, 'phone');
    expect(ruleDef(Cls, 'phone')?.groups).toEqual(['admin']);
  });

  it('should work with no options (each/groups/message/context all undefined)', () => {
    const Cls = makeClass();
    IsMobilePhone('ko-KR')(Cls.prototype, 'phone');
    const def = ruleDef(Cls, 'phone');
    expect(def?.each).toBeUndefined();
    expect(def?.groups).toBeUndefined();
  });

  it('should register class in globalRegistry', () => {
    const Cls = makeClass();
    IsMobilePhone('ko-KR')(Cls.prototype, 'phone');
    expect(globalRegistry.has(Cls as any)).toBe(true);
  });
});

describe('IsPostalCode', () => {
  it('should register rule with ruleName isPostalCode when applied', () => {
    const Cls = makeClass();
    IsPostalCode('US')(Cls.prototype, 'zip');
    expect(ruleAt(Cls, 'zip')?.ruleName).toBe('isPostalCode');
  });

  it('should pass through options to RuleDef', () => {
    const Cls = makeClass();
    IsPostalCode('US', { each: true, groups: ['public'] })(Cls.prototype, 'zip');
    const def = ruleDef(Cls, 'zip');
    expect(def?.each).toBe(true);
    expect(def?.groups).toEqual(['public']);
  });
});

describe('IsIdentityCard', () => {
  it('should register rule with ruleName isIdentityCard when applied', () => {
    const Cls = makeClass();
    IsIdentityCard('KR')(Cls.prototype, 'id');
    expect(ruleAt(Cls, 'id')?.ruleName).toBe('isIdentityCard');
  });

  it('should pass through options to RuleDef', () => {
    const Cls = makeClass();
    IsIdentityCard('KR', { each: true })(Cls.prototype, 'ids');
    expect(ruleDef(Cls, 'ids')?.each).toBe(true);
  });
});

describe('IsPassportNumber', () => {
  it('should register rule with ruleName isPassportNumber when applied', () => {
    const Cls = makeClass();
    IsPassportNumber('US')(Cls.prototype, 'passport');
    expect(ruleAt(Cls, 'passport')?.ruleName).toBe('isPassportNumber');
  });

  it('should pass through options to RuleDef', () => {
    const Cls = makeClass();
    IsPassportNumber('US', { groups: ['admin'] })(Cls.prototype, 'passport');
    expect(ruleDef(Cls, 'passport')?.groups).toEqual(['admin']);
  });

  it('should accumulate multiple decorators on same class', () => {
    const Cls = makeClass();
    IsMobilePhone('ko-KR')(Cls.prototype, 'phone');
    IsPassportNumber('US')(Cls.prototype, 'passport');
    expect(ruleAt(Cls, 'phone')?.ruleName).toBe('isMobilePhone');
    expect(ruleAt(Cls, 'passport')?.ruleName).toBe('isPassportNumber');
  });
});
