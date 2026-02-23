import { SEALED } from '../symbols';
import type { RawClassMeta, RawPropertyMeta, SealedExecutors } from '../types';
import type { SealOptions, RuntimeOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** serialize 방향의 출력 키 결정 */
function getSerializeOutputKey(fieldKey: string, exposeStack: RawPropertyMeta['expose']): string {
  // serializeOnly @Expose with name → 해당 name 사용
  const serDef = exposeStack.find(e => e.serializeOnly && e.name);
  if (serDef) return serDef.name!;
  // 방향 미지정 @Expose with name → 양방향 사용
  const biDef = exposeStack.find(e => !e.deserializeOnly && !e.serializeOnly && e.name);
  if (biDef) return biDef.name!;
  return fieldKey;
}

/** serialize 방향의 expose groups 결정 */
function getSerializeExposeGroups(exposeStack: RawPropertyMeta['expose']): string[] | undefined {
  // serializeOnly 또는 방향 미지정 @Expose
  const def = exposeStack.find(e => !e.deserializeOnly);
  return def?.groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildSerializeCode — new Function 기반 serialize executor 생성 (§4.3 serialize 파이프라인)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * serialize executor 코드 생성.
 * 무검증 전제 — 항상 Record<string, unknown> 반환 (§4.3).
 */
export function buildSerializeCode<T>(
  Class: Function,
  merged: RawClassMeta,
  options: SealOptions | undefined,
  isAsync: boolean,
): (instance: T, opts?: RuntimeOptions) => Record<string, unknown> | Promise<Record<string, unknown>> {
  const refs: unknown[] = [];
  const execs: SealedExecutors<unknown>[] = [];

  // ── 코드 생성 ─────────────────────────────────────────────────────────────

  let body = '\'use strict\';\n';
  body += 'var __bk$out = {};\n';

  // groups 변수 — groups를 참조하는 필드가 있을 때만
  const hasGroupsField = Object.values(merged).some(meta => {
    const groups = getSerializeExposeGroups(meta.expose);
    return groups && groups.length > 0;
  });
  if (hasGroupsField) {
    body += 'var __bk$groups = _opts && _opts.groups;\n';
  }

  for (const [fieldKey, meta] of Object.entries(merged)) {
    body += generateSerializeFieldCode(fieldKey, meta, refs, execs, isAsync);
  }

  body += 'return __bk$out;\n';

  // sourceURL (§4.9)
  body += `//# sourceURL=baker://${Class.name}/serialize\n`;

  // ── new Function 실행 ─────────────────────────────────────────────────────

  const fnKeyword = isAsync ? 'async function' : 'function';
  const executor = new Function(
    '_refs', '_execs',
    `return ${fnKeyword}(instance, _opts) { ` + body + ' }',
  )(refs, execs) as (instance: T, opts?: RuntimeOptions) => Record<string, unknown> | Promise<Record<string, unknown>>;

  if (options?.debug) (executor as any).__bakerSource = body;

  return executor;
}

// ─────────────────────────────────────────────────────────────────────────────
// 필드별 serialize 코드 생성
// ─────────────────────────────────────────────────────────────────────────────

function generateSerializeFieldCode(
  fieldKey: string,
  meta: RawPropertyMeta,
  refs: unknown[],
  execs: SealedExecutors<unknown>[],
  isAsync: boolean,
): string {
  // ⓪ Exclude serializeOnly / bidirectional → skip
  if (meta.exclude) {
    if (!meta.exclude.deserializeOnly) return ''; // serializeOnly or both → skip serialize
  }

  // Expose: if all @Expose entries are deserializeOnly, skip for serialize
  if (meta.expose.length > 0 && meta.expose.every(e => e.deserializeOnly)) {
    return ''; // only deserializeOnly → not visible to serialize
  }

  const outputKey = getSerializeOutputKey(fieldKey, meta.expose);
  const exposeGroups = getSerializeExposeGroups(meta.expose);

  let fieldCode = '';

  // groups check wrap (§4.5)
  let fieldStart = '';
  let fieldEnd = '';
  if (exposeGroups && exposeGroups.length > 0) {
    const groupsArr = JSON.stringify(exposeGroups);
    fieldStart = `if (__bk$groups && ${groupsArr}.some(function(g){return __bk$groups.indexOf(g)!==-1;})) {\n`;
    fieldEnd = '}\n';
  }

  let innerCode = '';

  // ② @IsOptional → undefined 면 출력 생략 (§4.3 serialize ②)
  const useOptionalGuard = meta.flags.isOptional;

  // ③ nested @Type 처리 (H4) — @Transform 없는 경우에만 (§4.3 serialize 파이프라인)
  if (meta.type?.fn && !meta.transform.filter(td => !td.options?.deserializeOnly).length) {
    const nestedSealed = (meta.type.fn() as any)[SEALED] as SealedExecutors<unknown>;
    const execIdx = execs.length;
    execs.push(nestedSealed);

    // 배열/each 여부 판단
    const hasEach = meta.validation.some(rd => rd.each);
    const outputTarget = `__bk$out[${JSON.stringify(outputKey)}]`;

    let nestedCode: string;
    if (hasEach) {
      if (isAsync) {
        nestedCode = `${outputTarget} = await Promise.all(instance[${JSON.stringify(fieldKey)}].map(async function(__ser_item) { return await _execs[${execIdx}]._serialize(__ser_item, _opts); }));`;
      } else {
        nestedCode = `${outputTarget} = instance[${JSON.stringify(fieldKey)}].map(function(__ser_item) { return _execs[${execIdx}]._serialize(__ser_item, _opts); });`;
      }
    } else {
      const awaitKw = isAsync ? 'await ' : '';
      nestedCode = `${outputTarget} = ${awaitKw}_execs[${execIdx}]._serialize(instance[${JSON.stringify(fieldKey)}], _opts);`;
    }

    if (useOptionalGuard) {
      innerCode = `if (instance[${JSON.stringify(fieldKey)}] !== undefined) {\n  ${nestedCode}\n}\n`;
    } else {
      innerCode = nestedCode + '\n';
    }
  } else {
    // 기존 @Transform or direct assign 처리
    const outputExpr = buildSerializeOutputExpr(fieldKey, outputKey, meta, refs, isAsync);

    if (useOptionalGuard) {
      innerCode += `if (instance[${JSON.stringify(fieldKey)}] !== undefined) {\n`;
      innerCode += '  ' + outputExpr + '\n';
      innerCode += '}\n';
    } else {
      innerCode += outputExpr + '\n';
    }
  }

  fieldCode += fieldStart + innerCode + fieldEnd;
  return fieldCode;
}

/**
 * 필드 출력 표현식 빌드.
 * @Transform 있으면 _refs[i](params) 호출, 없으면 직접 할당.
 */
function buildSerializeOutputExpr(
  fieldKey: string,
  outputKey: string,
  meta: RawPropertyMeta,
  refs: unknown[],
  isAsync: boolean,
): string {
  const outputTarget = `__bk$out[${JSON.stringify(outputKey)}]`;

  const serTransforms = meta.transform.filter(
    td => !td.options?.deserializeOnly,
  );

  if (serTransforms.length > 0) {
    let valueExpr = `instance[${JSON.stringify(fieldKey)}]`;
    for (const td of serTransforms) {
      const refIdx = refs.length;
      refs.push(td.fn);
      const callExpr = `_refs[${refIdx}]({value:${valueExpr},key:${JSON.stringify(fieldKey)},obj:instance,type:'serialize'})`;
      const isAsyncTransform = isAsync && (td.fn as any).constructor?.name === 'AsyncFunction';
      valueExpr = isAsyncTransform ? `(await ${callExpr})` : callExpr;
    }
    return `${outputTarget} = ${valueExpr};`;
  }

  return `${outputTarget} = instance[${JSON.stringify(fieldKey)}];`;
}
