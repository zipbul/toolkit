import { err as _resultErr, isErr as _resultIsErr } from '@zipbul/result';
import { SEALED } from '../symbols';
import type { RawClassMeta, RawPropertyMeta, EmitContext, EmittableRule, SealedExecutors } from '../types';
import type { SealOptions, RuntimeOptions } from '../interfaces';
import type { BakerError } from '../errors';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — 코드 생성 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** 필드명을 안전한 JS 변수명으로 변환 */
function toVarName(key: string): string {
  // 알파벳/숫자/_ 이외의 문자는 _ 로 치환
  return '_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** 직렬화에 사용할 추출 키 결정 (§4.3 ③) */
function getDeserializeExtractKey(fieldKey: string, exposeStack: RawPropertyMeta['expose']): string {
  // deserializeOnly @Expose with name → 해당 name 사용
  const desDef = exposeStack.find(e => e.deserializeOnly && e.name);
  if (desDef) return desDef.name!;
  // 방향 미지정 @Expose with name → 양방향 사용
  const biDef = exposeStack.find(e => !e.deserializeOnly && !e.serializeOnly && e.name);
  if (biDef) return biDef.name!;
  return fieldKey;
}

/** 필드 expose groups 결정 (직렬화에 적용되는 @Expose) */
function getDeserializeExposeGroups(exposeStack: RawPropertyMeta['expose']): string[] | undefined {
  const desDef = exposeStack.find(e => !e.serializeOnly);
  return desDef?.groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildDeserializeCode — new Function 기반 executor 생성 (§4.9)
// ─────────────────────────────────────────────────────────────────────────────

export function buildDeserializeCode<T>(
  Class: Function,
  merged: RawClassMeta,
  options: SealOptions | undefined,
  needsCircularCheck: boolean,
): (input: unknown, opts?: RuntimeOptions) => T | ReturnType<typeof _resultErr<BakerError[]>> {
  const stopAtFirstError = options?.stopAtFirstError ?? false;
  const collectErrors = !stopAtFirstError;
  const exposeDefaultValues = options?.exposeDefaultValues ?? false;

  // 참조 배열 — new Function 클로저에 주입
  const regexes: RegExp[] = [];
  const refs: unknown[] = [];
  const execs: SealedExecutors<unknown>[] = [];

  // ── 코드 생성 ────────────────────────────────────────────────────────────

  let body = '\'use strict\';\n';

  // 인스턴스 생성
  body += 'var _out = new _Cls();\n';

  // 에러 배열 (collectErrors mode)
  if (collectErrors) {
    body += 'var _errors = [];\n';
  }

  // preamble: input type guard (§4.9)
  if (collectErrors) {
    body += 'if (input == null || typeof input !== \'object\' || Array.isArray(input)) return _err([{path:\'\',code:\'invalidInput\'}]);\n';
  } else {
    body += 'if (input == null || typeof input !== \'object\' || Array.isArray(input)) return _err([{path:\'\',code:\'invalidInput\'}]);\n';
  }

  // WeakSet guard (순환 참조)
  if (needsCircularCheck) {
    refs.push(new WeakSet());
    const wsIdx = refs.length - 1;
    body += `if (_refs[${wsIdx}].has(input)) return _err([{path:'',code:'circular'}]);\n`;
    body += `_refs[${wsIdx}].add(input);\n`;
  }

  // groups 변수 — groups를 참조하는 필드가 있을 때만 (§4.9)
  const hasGroupsField = Object.values(merged).some(meta => {
    const groups = getDeserializeExposeGroups(meta.expose);
    return groups && groups.length > 0;
  });
  if (hasGroupsField) {
    body += 'var _groups = _opts && _opts.groups;\n';
  }

  // ── 필드별 코드 생성 ──────────────────────────────────────────────────────

  for (const [fieldKey, meta] of Object.entries(merged)) {
    const fieldCode = generateFieldCode(fieldKey, meta, {
      stopAtFirstError,
      collectErrors,
      exposeDefaultValues,
      regexes,
      refs,
      execs,
      options,
    });
    body += fieldCode;
  }

  // ── epilogue ──────────────────────────────────────────────────────────────

  if (collectErrors) {
    body += 'if (_errors.length) return _err(_errors);\n';
  }
  body += 'return _out;\n';

  // sourceURL (§4.9)
  body += `//# sourceURL=baker://${Class.name}/deserialize\n`;

  // ── new Function 실행 ─────────────────────────────────────────────────────

  const executor = new Function(
    '_Cls', '_re', '_refs', '_execs', '_err', '_isErr',
    'return function(input, _opts) { ' + body + ' }',
  )(Class, regexes, refs, execs, _resultErr, _resultIsErr) as (
    input: unknown,
    opts?: RuntimeOptions,
  ) => T | ReturnType<typeof _resultErr<BakerError[]>>;

  return executor;
}

// ─────────────────────────────────────────────────────────────────────────────
// 필드 코드 생성
// ─────────────────────────────────────────────────────────────────────────────

interface FieldCodeContext {
  stopAtFirstError: boolean;
  collectErrors: boolean;
  exposeDefaultValues: boolean;
  regexes: RegExp[];
  refs: unknown[];
  execs: SealedExecutors<unknown>[];
  options: SealOptions | undefined;
}

function generateFieldCode(
  fieldKey: string,
  meta: RawPropertyMeta,
  ctx: FieldCodeContext,
): string {
  const { collectErrors, exposeDefaultValues } = ctx;

  // ⓪ Exclude deserializeOnly / bidirectional → skip
  if (meta.exclude) {
    if (!meta.exclude.serializeOnly) return ''; // deserializeOnly or both → skip deserialize
  }

  // Expose: check if this field is exposed to deserialize
  // If all @Expose entries are serializeOnly, skip field
  if (meta.expose.length > 0 && meta.expose.every(e => e.serializeOnly)) {
    return ''; // only serializeOnly exposures → not visible to deserialize
  }

  const varName = toVarName(fieldKey);
  const extractKey = getDeserializeExtractKey(fieldKey, meta.expose);
  const exposeGroups = getDeserializeExposeGroups(meta.expose);

  // EmitContext 생성
  const emitCtx = makeEmitCtx(fieldKey, ctx);

  let fieldCode = '';

  // ① @ValidateIf guard
  let validateIfIdx: number | null = null;
  if (meta.flags.validateIf) {
    validateIfIdx = ctx.refs.length;
    ctx.refs.push(meta.flags.validateIf);
  }

  // ③ 추출 (Extract) + exposeDefaultValues
  let extractCode: string;
  if (exposeDefaultValues && !meta.flags.isOptional) {
    // key가 input에 없으면 기본값 사용
    extractCode = `var ${varName} = (${JSON.stringify(extractKey)} in input) ? input[${JSON.stringify(extractKey)}] : _out.${fieldKey};\n`;
  } else {
    extractCode = `var ${varName} = input[${JSON.stringify(extractKey)}];\n`;
  }

  // groups check wrap (§4.5)
  let fieldStart = '';
  let fieldEnd = '';
  if (exposeGroups && exposeGroups.length > 0) {
    const groupsArr = JSON.stringify(exposeGroups);
    fieldStart = `if (_groups && ${groupsArr}.some(function(g){return _groups.indexOf(g)!==-1;})) {\n`;
    fieldEnd = '}\n';
  }

  // inner content (extract + optional guard + validation + assign)
  let innerCode = extractCode;

  // ② @IsOptional guard (§4.3)
  // @IsDefined overrides @IsOptional
  const useOptionalGuard = meta.flags.isOptional && !meta.flags.isDefined;

  const validationCode = generateValidationCode(fieldKey, varName, meta, ctx, emitCtx);

  if (useOptionalGuard) {
    innerCode += `if (${varName} !== undefined && ${varName} !== null) {\n`;
    innerCode += validationCode;
    innerCode += '}\n';
  } else if (collectErrors && exposeDefaultValues) {
    // exposeDefaultValues: true without isOptional — wrap in undefined check so we don't
    // fail on keys that weren't in input (they got default values already set above)
    // Actually, exposeDefaultValues already handles this by extracting default; no wrap needed
    innerCode += validationCode;
  } else {
    innerCode += validationCode;
  }

  // ① @ValidateIf outer wrap
  if (validateIfIdx !== null) {
    fieldCode += fieldStart + `if (_refs[${validateIfIdx}](input)) {\n` + innerCode + '}\n' + fieldEnd;
  } else {
    fieldCode += fieldStart + innerCode + fieldEnd;
  }

  return fieldCode;
}

// ─────────────────────────────────────────────────────────────────────────────
// 검증 코드 생성 — 타입 가드 + transform + validate + assign
// ─────────────────────────────────────────────────────────────────────────────

function generateValidationCode(
  fieldKey: string,
  varName: string,
  meta: RawPropertyMeta,
  ctx: FieldCodeContext,
  emitCtx: EmitContext,
): string {
  const { collectErrors, execs } = ctx;

  let code = '';

  // @Transform (deserialize direction) — before validation (§4.3 ⑤)
  const dsTransforms = meta.transform.filter(
    td => !td.options?.serializeOnly,
  );
  if (dsTransforms.length > 0) {
    for (const td of dsTransforms) {
      const refIdx = ctx.refs.length;
      ctx.refs.push(td.fn);
      code += `${varName} = _refs[${refIdx}]({value:${varName},key:${JSON.stringify(fieldKey)},obj:input,type:'deserialize'});\n`;
    }
  }

  // @ValidateNested + @Type (§8.1)
  if (meta.flags.validateNested && meta.type?.fn) {
    code += generateNestedCode(fieldKey, varName, meta, ctx, emitCtx);
    return code;
  }

  // No validation rules → direct assign
  if (meta.validation.length === 0) {
    code += `_out.${fieldKey} = ${varName};\n`;
    return code;
  }

  // Build validation with type gate
  code += buildRulesCode(fieldKey, varName, meta.validation, collectErrors, emitCtx);

  return code;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildRulesCode — 타입 가드 + 마커 패턴 (§4.3, §4.10)
// ─────────────────────────────────────────────────────────────────────────────

function buildRulesCode(
  fieldKey: string,
  varName: string,
  validation: RawPropertyMeta['validation'],
  collectErrors: boolean,
  emitCtx: EmitContext,
): string {
  const each = validation.filter(rd => rd.each);
  const nonEach = validation.filter(rd => !rd.each);

  // each: true rules — separate array loop handling
  // For non-each rules, use the main logic below
  // (Phase 3 simplified: basic each support)
  let code = '';

  // Separate by requiresType
  const stringDeps = nonEach.filter(rd => rd.rule.requiresType === 'string');
  const numberDeps = nonEach.filter(rd => rd.rule.requiresType === 'number');
  const generalRules = nonEach.filter(rd => !rd.rule.requiresType);

  const hasStringDeps = stringDeps.length > 0;
  const hasNumberDeps = numberDeps.length > 0;

  if (hasStringDeps || hasNumberDeps) {
    const gateType = hasStringDeps ? 'string' : 'number';
    const gateDeps = hasStringDeps ? stringDeps : numberDeps;

    // Find type asserter in generalRules
    const asserterName = gateType === 'string' ? 'isString' : 'isNumber';
    const typeAsseterIdx = generalRules.findIndex(rd => rd.rule.ruleName === asserterName);
    const typeAsseter = typeAsseterIdx >= 0 ? generalRules[typeAsseterIdx] : undefined;

    // Other general rules (excluding the type asserter)
    const otherGeneral = typeAsseter
      ? generalRules.filter((_, i) => i !== typeAsseterIdx)
      : generalRules;

    // Generate type gate condition
    let gateCondition: string;
    let gateErrorCode: string;

    if (typeAsseter) {
      // Use the type asserter's typeof check — simplified gate condition
      if (gateType === 'string') {
        gateCondition = `typeof ${varName} !== 'string'`;
      } else {
        // isNumber: check typeof + NaN + Infinity (assuming default options)
        gateCondition = `typeof ${varName} !== 'number' || isNaN(${varName}) || !isFinite(${varName})`;
      }
      gateErrorCode = typeAsseter.rule.ruleName;
    } else {
      // No type asserter — builder injects
      gateCondition = `typeof ${varName} !== '${gateType}'`;
      gateErrorCode = gateDeps[0].rule.ruleName;
    }

    if (collectErrors) {
      // Type gate: if fails → push error; else { marker + rules + assign }
      code += `if (${gateCondition}) ${emitCtx.fail(gateErrorCode)};\n`;
      code += `else {\n`;
      const markVar = `_mark${toVarName(fieldKey).slice(1)}`;
      code += `  var ${markVar} = _errors.length;\n`;
      // General rules (non-typed) inside else too — if any
      for (const rd of otherGeneral) {
        const ruleCode = rd.rule.emit(varName, emitCtx);
        code += '  ' + ruleCode.replace(/\n/g, '\n  ') + '\n';
      }
      // Typed dependent rules
      for (const rd of gateDeps) {
        const ruleCode = rd.rule.emit(varName, emitCtx);
        code += '  ' + ruleCode.replace(/\n/g, '\n  ') + '\n';
      }
      code += `  if (_errors.length === ${markVar}) _out.${fieldKey} = ${varName};\n`;
      code += `}\n`;
    } else {
      // stopAtFirstError: true — sequential early returns
      code += `if (${gateCondition}) ${emitCtx.fail(gateErrorCode)};\n`;
      // General rules
      for (const rd of otherGeneral) {
        code += rd.rule.emit(varName, emitCtx) + '\n';
      }
      // Typed rules
      for (const rd of gateDeps) {
        code += rd.rule.emit(varName, emitCtx) + '\n';
      }
      code += `_out.${fieldKey} = ${varName};\n`;
    }
  } else {
    // No type-specific rules — all general
    if (collectErrors) {
      if (generalRules.length === 0) {
        code += `_out.${fieldKey} = ${varName};\n`;
      } else {
        const markVar = `_mark${toVarName(fieldKey).slice(1)}`;
        code += `var ${markVar} = _errors.length;\n`;
        for (const rd of generalRules) {
          code += rd.rule.emit(varName, emitCtx) + '\n';
        }
        code += `if (_errors.length === ${markVar}) _out.${fieldKey} = ${varName};\n`;
      }
    } else {
      for (const rd of generalRules) {
        code += rd.rule.emit(varName, emitCtx) + '\n';
      }
      code += `_out.${fieldKey} = ${varName};\n`;
    }
  }

  // each: true rules — basic support
  for (const rd of each) {
    const pathKey = JSON.stringify(fieldKey);
    if (collectErrors) {
      code += `if (Array.isArray(${varName})) {\n`;
      code += `  for (var _i_${toVarName(fieldKey).slice(1)}=0; _i_${toVarName(fieldKey).slice(1)}<${varName}.length; _i_${toVarName(fieldKey).slice(1)}++) {\n`;
      // Create per-element context
      const arrEmitCtx: EmitContext = {
        ...emitCtx,
        fail: (code2) => `_errors.push({path:${pathKey}+'['+_i_${toVarName(fieldKey).slice(1)}+']',code:${JSON.stringify(code2)}})`,
      };
      code += '    ' + rd.rule.emit(`${varName}[_i_${toVarName(fieldKey).slice(1)}]`, arrEmitCtx) + '\n';
      code += `  }\n`;
      code += `} else { _errors.push({path:${pathKey},code:'isArray'}); }\n`;
    } else {
      code += `if (!Array.isArray(${varName})) ${emitCtx.fail('isArray')};\n`;
    }
  }

  return code;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateNestedCode — @ValidateNested + @Type (§8.1, §8.2)
// ─────────────────────────────────────────────────────────────────────────────

function generateNestedCode(
  fieldKey: string,
  varName: string,
  meta: RawPropertyMeta,
  ctx: FieldCodeContext,
  emitCtx: EmitContext,
): string {
  const { collectErrors, execs } = ctx;

  if (!meta.type) return `_out.${fieldKey} = ${varName};\n`;

  let code = '';

  if (meta.type.discriminator) {
    // §8.3 discriminator
    const discProp = JSON.stringify(meta.type.discriminator.property);
    code += `var _dt${toVarName(fieldKey)} = ${varName} && ${varName}[${discProp}];\n`;
    code += `switch (_dt${toVarName(fieldKey)}) {\n`;
    for (const sub of meta.type.discriminator.subTypes) {
      const nestedSealed = (sub.value as any)[SEALED] as SealedExecutors<unknown> | undefined;
      const execIdx = execs.length;
      execs.push(nestedSealed as SealedExecutors<unknown>);
      code += `  case ${JSON.stringify(sub.name)}:\n`;
      code += `    var _r${toVarName(fieldKey)} = _execs[${execIdx}]._deserialize(${varName}, _opts);\n`;
      code += generateNestedResultCode(fieldKey, varName, `_r${toVarName(fieldKey)}`, collectErrors);
      code += `    break;\n`;
    }
    code += `  default: ${emitCtx.fail('invalidDiscriminator')};\n`;
    code += `}\n`;
  } else {
    // §8.1 simple nested or §8.2 each array
    const nestedSealed = (meta.type.fn() as any)[SEALED] as SealedExecutors<unknown> | undefined;
    const execIdx = execs.length;
    execs.push(nestedSealed as SealedExecutors<unknown>);

    // Check if validateNested each (array) — determined by RuleDef.each on validatNested rule
    // For simplicity: check if validation has any each:true rule
    const hasEach = meta.validation.some(rd => rd.each);

    if (hasEach) {
      // §8.2 array nested
      const iVar = `_i${toVarName(fieldKey)}`;
      code += `if (Array.isArray(${varName})) {\n`;
      code += `  var _arr${toVarName(fieldKey)} = [];\n`;
      code += `  for (var ${iVar}=0; ${iVar}<${varName}.length; ${iVar}++) {\n`;
      code += `    var _r${toVarName(fieldKey)} = _execs[${execIdx}]._deserialize(${varName}[${iVar}], _opts);\n`;
      code += `    if (_isErr(_r${toVarName(fieldKey)})) {\n`;
      code += `      var _re${toVarName(fieldKey)} = _r${toVarName(fieldKey)}.data;\n`;
      code += `      for (var _j${toVarName(fieldKey)}=0; _j${toVarName(fieldKey)}<_re${toVarName(fieldKey)}.length; _j${toVarName(fieldKey)}++) {\n`;
      code += `        _errors.push({path:${JSON.stringify(fieldKey)}+'['+${iVar}+'].'+_re${toVarName(fieldKey)}[_j${toVarName(fieldKey)}].path,code:_re${toVarName(fieldKey)}[_j${toVarName(fieldKey)}].code});\n`;
      code += `      }\n`;
      code += `    } else { _arr${toVarName(fieldKey)}.push(_r${toVarName(fieldKey)}); }\n`;
      code += `  }\n`;
      code += `  _out.${fieldKey} = _arr${toVarName(fieldKey)};\n`;
      code += `} else { ${emitCtx.fail('isArray')}; }\n`;
    } else {
      // §8.1 simple nested object
      code += `if (${varName} != null && typeof ${varName} === 'object') {\n`;
      code += `  var _r${toVarName(fieldKey)} = _execs[${execIdx}]._deserialize(${varName}, _opts);\n`;
      code += generateNestedResultCode(fieldKey, varName, `_r${toVarName(fieldKey)}`, collectErrors);
      code += `} else { ${emitCtx.fail('isObject')}; }\n`;
    }
  }

  return code;
}

function generateNestedResultCode(
  fieldKey: string,
  _varName: string,
  resultVar: string,
  collectErrors: boolean,
): string {
  if (collectErrors) {
    return `  if (_isErr(${resultVar})) {\n` +
      `    var _re${toVarName(fieldKey)} = ${resultVar}.data;\n` +
      `    for (var _j${toVarName(fieldKey)}=0; _j${toVarName(fieldKey)}<_re${toVarName(fieldKey)}.length; _j${toVarName(fieldKey)}++) {\n` +
      `      _errors.push({path:${JSON.stringify(fieldKey + '.')}+_re${toVarName(fieldKey)}[_j${toVarName(fieldKey)}].path,code:_re${toVarName(fieldKey)}[_j${toVarName(fieldKey)}].code});\n` +
      `    }\n` +
      `  } else { _out.${fieldKey} = ${resultVar}; }\n`;
  } else {
    return `  if (_isErr(${resultVar})) {\n` +
      `    var _re${toVarName(fieldKey)} = ${resultVar}.data;\n` +
      `    return _err([{path:${JSON.stringify(fieldKey+'.')}+_re${toVarName(fieldKey)}[0].path,code:_re${toVarName(fieldKey)}[0].code}]);\n` +
      `  } else { _out.${fieldKey} = ${resultVar}; }\n`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// makeEmitCtx — 필드별 EmitContext 생성
// ─────────────────────────────────────────────────────────────────────────────

function makeEmitCtx(fieldKey: string, ctx: FieldCodeContext): EmitContext {
  const { collectErrors, regexes, refs, execs } = ctx;
  return {
    addRegex(re: RegExp): number {
      regexes.push(re);
      return regexes.length - 1;
    },
    addRef(fn: unknown): number {
      refs.push(fn);
      return refs.length - 1;
    },
    addExecutor(executor: SealedExecutors<unknown>): number {
      execs.push(executor);
      return execs.length - 1;
    },
    fail(code: string): string {
      if (collectErrors) {
        return `_errors.push({path:${JSON.stringify(fieldKey)},code:${JSON.stringify(code)}})`;
      } else {
        return `return _err([{path:${JSON.stringify(fieldKey)},code:${JSON.stringify(code)}}])`;
      }
    },
    collectErrors,
  };
}
