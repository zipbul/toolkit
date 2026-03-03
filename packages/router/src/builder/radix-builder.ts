import type { Result } from '@zipbul/result';
import type { PatternTesterFn, RouterErrData } from '../types';
import type { PathPart } from './path-parser';

import { err, isErr } from '@zipbul/result';
import { createRadixNode, createParamNode } from './radix-node';
import type { RadixNode, ParamNode } from './radix-node';
import { OptionalParamDefaults } from './optional-param-defaults';
import { PatternUtils } from './pattern-utils';
import { buildPatternTester } from '../matcher/pattern-tester';
import type { BuilderConfig } from './types';

export class RadixBuilder {
  private readonly roots: Array<RadixNode | null> = [];
  private readonly testers: Array<Array<PatternTesterFn | undefined>> = [];
  private readonly config: BuilderConfig;
  private readonly patternUtils: PatternUtils;
  readonly optionalParamDefaults: OptionalParamDefaults;

  constructor(config: BuilderConfig) {
    this.config = config;
    this.patternUtils = new PatternUtils(config);
    this.optionalParamDefaults = config.optionalParamDefaults ?? new OptionalParamDefaults();
  }

  getRoot(methodCode: number): RadixNode | null {
    return this.roots[methodCode] ?? null;
  }

  getTesters(methodCode: number): Array<PatternTesterFn | undefined> {
    return this.testers[methodCode] ?? [];
  }

  insert(
    methodCode: number,
    parts: PathPart[],
    handlerIndex: number,
  ): Result<void, RouterErrData> {
    // Expand optional params into multiple insertion paths
    const expansions = this.expandOptional(parts, handlerIndex);

    for (const { parts: expandedParts, handlerIndex: hIdx } of expansions) {
      const r = this.insertOne(methodCode, expandedParts, hIdx);

      if (isErr(r)) {
        return r;
      }
    }
  }

  private expandOptional(
    parts: PathPart[],
    handlerIndex: number,
  ): Array<{ parts: PathPart[]; handlerIndex: number }> {
    // Find optional params
    const optionalIndices: number[] = [];
    const optionalNames: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      if (part.type === 'param' && part.optional) {
        optionalIndices.push(i);
        optionalNames.push(part.name);
      }
    }

    if (optionalIndices.length === 0) {
      return [{ parts, handlerIndex }];
    }

    // Record optional param defaults
    this.optionalParamDefaults.record(handlerIndex, optionalNames);

    const result: Array<{ parts: PathPart[]; handlerIndex: number }> = [];

    // Full path (with all optional params present — mark as non-optional for insertion)
    const fullParts = parts.map(p =>
      p.type === 'param' && p.optional
        ? { ...p, optional: false }
        : p,
    );
    result.push({ parts: fullParts, handlerIndex });

    // For each optional param, create a version without it
    // Process from right to left to handle nested optionals correctly
    for (let bit = 1; bit < (1 << optionalIndices.length); bit++) {
      const filtered: PathPart[] = [];
      let prevStatic: PathPart | null = null;

      for (let i = 0; i < parts.length; i++) {
        // Check if this index should be skipped
        let skip = false;

        for (let j = 0; j < optionalIndices.length; j++) {
          if (optionalIndices[j] === i && (bit & (1 << j))) {
            skip = true;
            break;
          }
        }

        if (skip) {
          // Trim trailing '/' from the preceding static part
          if (filtered.length > 0) {
            const prev = filtered[filtered.length - 1]!;

            if (prev.type === 'static' && prev.value.endsWith('/')) {
              const trimmed = prev.value.slice(0, -1);

              if (trimmed.length > 0) {
                filtered[filtered.length - 1] = { type: 'static', value: trimmed };
              } else {
                filtered.pop();
              }
            }
          }

          continue;
        }

        const part = parts[i]!;

        if (part.type === 'param' && part.optional) {
          filtered.push({ ...part, optional: false });
        } else {
          filtered.push(part);
        }
      }

      // Merge adjacent static parts and fix separators
      const merged = this.mergeStaticParts(filtered);

      if (merged.length > 0) {
        result.push({ parts: merged, handlerIndex });
      }
    }

    return result;
  }

  private mergeStaticParts(parts: PathPart[]): PathPart[] {
    const result: PathPart[] = [];

    for (const part of parts) {
      if (part.type === 'static' && result.length > 0) {
        const prev = result[result.length - 1]!;

        if (prev.type === 'static') {
          // Merge: remove duplicate '/' at boundary
          let merged = prev.value + part.value;

          merged = merged.replace(/\/\//g, '/');
          result[result.length - 1] = { type: 'static', value: merged };

          continue;
        }
      }

      result.push(part);
    }

    return result;
  }

  private insertOne(
    methodCode: number,
    parts: PathPart[],
    handlerIndex: number,
  ): Result<void, RouterErrData> {
    // Ensure root exists for this method
    if (!this.roots[methodCode]) {
      this.roots[methodCode] = createRadixNode('');
      this.testers[methodCode] = [];
    }

    let node = this.roots[methodCode]!;
    const testerList = this.testers[methodCode]!;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      if (part.type === 'static') {
        // Check conflict: inserting static child on node that has a wildcard
        if (node.wildcardStore !== null) {
          return err({
            kind: 'route-conflict',
            message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
            segment: part.value,
          });
        }

        node = this.insertStaticPart(node, part.value);
      } else if (part.type === 'param') {
        // Check conflict: inserting param on node that has a wildcard
        if (node.wildcardStore !== null) {
          return err({
            kind: 'route-conflict',
            message: `Parameter ':${part.name}' conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
            segment: part.name,
          });
        }

        const paramResult = this.insertParam(node, part, testerList);

        if (isErr(paramResult)) {
          return paramResult;
        }

        node = paramResult;
      } else {
        // wildcard — must be last
        return this.insertWildcard(node, part.name, part.origin, handlerIndex);
      }
    }

    // Set handler on terminal node
    if (node.store !== null) {
      return err({
        kind: 'route-duplicate',
        message: 'Route already exists',
        suggestion: 'Use a different path or HTTP method',
      });
    }

    node.store = handlerIndex;
  }

  /**
   * Insert a static string into the trie using LCP (Longest Common Prefix) splitting.
   * Returns the node at the end of the inserted path.
   */
  private insertStaticPart(node: RadixNode, part: string): RadixNode {
    let current = node;
    let remaining = part;

    while (remaining.length > 0) {
      // Check if first char matches any existing inert child
      const firstChar = remaining.charCodeAt(0);

      if (current.inert !== null) {
        const child = current.inert[firstChar];

        if (child !== undefined) {
          // Find LCP between remaining and child.part
          const childPart = child.part;
          const minLen = Math.min(remaining.length, childPart.length);
          let commonLen = 0;

          for (let i = 0; i < minLen; i++) {
            if (remaining.charCodeAt(i) !== childPart.charCodeAt(i)) {
              break;
            }

            commonLen++;
          }

          if (commonLen === childPart.length) {
            // Child part is fully consumed — continue with remainder
            remaining = remaining.substring(commonLen);
            current = child;

            continue;
          }

          // Partial match — split the child node
          const splitNode = createRadixNode(childPart.substring(0, commonLen));

          // The original child becomes a child of the split node
          const oldChild = child;
          oldChild.part = childPart.substring(commonLen);

          splitNode.inert = { [oldChild.part.charCodeAt(0)]: oldChild };

          // Replace child in parent
          current.inert[firstChar] = splitNode;

          // Continue inserting the remaining part under splitNode
          remaining = remaining.substring(commonLen);
          current = splitNode;

          continue;
        }
      }

      // No matching child — create new leaf
      const newNode = createRadixNode(remaining);

      if (current.inert === null) {
        current.inert = {};
      }

      current.inert[firstChar] = newNode;

      return newNode;
    }

    return current;
  }

  private insertParam(
    node: RadixNode,
    part: { name: string; pattern: string | null },
    testerList: Array<PatternTesterFn | undefined>,
  ): Result<RadixNode, RouterErrData> {
    // Compile pattern if present
    let compiledPattern: RegExp | null = null;
    let normalizedSource: string | null = null;

    if (part.pattern !== null) {
      const normResult = this.patternUtils.normalizeParamPatternSource(part.pattern);

      if (isErr(normResult)) {
        return normResult;
      }

      normalizedSource = normResult;

      try {
        compiledPattern = this.patternUtils.acquireCompiledPattern(normalizedSource, '');
      } catch (e) {
        return err({
          kind: 'route-parse',
          message: `Invalid regex pattern '${part.pattern}': ${e instanceof Error ? e.message : String(e)}`,
          segment: part.pattern,
        });
      }
    }

    // Find existing param child with same name and pattern
    let paramNode = node.params;
    let prevParam: ParamNode | null = null;

    while (paramNode !== null) {
      if (paramNode.name === part.name && paramNode.patternSource === normalizedSource) {
        // Exact match — reuse existing param node
        // Ensure the inert child exists for continuation
        if (paramNode.inert === null) {
          paramNode.inert = createRadixNode('');
        }

        return paramNode.inert;
      }

      // Check conflict: same name, different pattern
      if (paramNode.name === part.name && paramNode.patternSource !== normalizedSource) {
        return err({
          kind: 'route-conflict',
          message: `Parameter ':${part.name}' has conflicting regex patterns`,
          segment: part.name,
        });
      }

      prevParam = paramNode;
      paramNode = paramNode.next;
    }

    // Create new param node
    const newParam = createParamNode(part.name);
    newParam.pattern = compiledPattern;
    newParam.patternSource = normalizedSource;

    // Build pattern tester
    if (compiledPattern !== null && normalizedSource !== null) {
      const tester = buildPatternTester(normalizedSource, compiledPattern, {
        maxExecutionMs: this.config.regexSafety?.maxExecutionMs,
      });
      // Store tester — the index matches the param's position in the linked list
      testerList.push(tester);
    }

    // Link into param chain
    if (prevParam !== null) {
      prevParam.next = newParam;
    } else {
      node.params = newParam;
    }

    // Create inert child for continuation
    newParam.inert = createRadixNode('');

    return newParam.inert;
  }

  private insertWildcard(
    node: RadixNode,
    name: string,
    origin: 'star' | 'multi',
    handlerIndex: number,
  ): Result<void, RouterErrData> {
    if (node.wildcardStore !== null) {
      if (node.wildcardName !== name) {
        return err({
          kind: 'route-conflict',
          message: `Wildcard '*${name}' conflicts with existing wildcard '*${node.wildcardName}'`,
          segment: name,
        });
      }

      return err({
        kind: 'route-duplicate',
        message: `Wildcard route already exists at this position`,
      });
    }

    // Check conflict with existing params
    if (node.params !== null) {
      return err({
        kind: 'route-conflict',
        message: `Wildcard '*${name}' conflicts with existing parameter at the same position`,
        segment: name,
      });
    }

    node.wildcardStore = handlerIndex;
    node.wildcardName = name;
    node.wildcardOrigin = origin;
  }
}
