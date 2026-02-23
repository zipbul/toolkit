/**
 * AOT 빌드용 빈 스텁 — 시그니처만 갖추고 바디는 noop.
 * zipbul CLI가 import를 @zipbul/baker/stubs로 리라이팅하면 Class[RAW] 수집 코드가 제거됨.
 */
import type { ValidationOptions } from '../interfaces';

const noop: PropertyDecorator = () => {};

export function IsDefined(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsOptional(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function ValidateIf(_condition: (obj: any) => boolean): PropertyDecorator { return noop; }
export function ValidateNested(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function Equals(_comparison: unknown, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function NotEquals(_comparison: unknown, _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsEmpty(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsNotEmpty(_options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsIn(_array: readonly unknown[], _options?: ValidationOptions): PropertyDecorator { return noop; }
export function IsNotIn(_array: readonly unknown[], _options?: ValidationOptions): PropertyDecorator { return noop; }
