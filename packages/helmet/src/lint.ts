import type { CspDirectives } from './interfaces';

export interface CspLintFinding {
  severity: 'high' | 'medium' | 'low';
  directive: string;
  message: string;
}

export interface CspLintOptions {
  level?: 'permissive' | 'moderate' | 'strict';
}

/**
 * Heuristic CSP strength check inspired by Google csp-evaluator.
 * Surfaces wildcards, missing object-src/base-uri, weak nonces, etc.
 */
export function lintCsp(
  directives: CspDirectives | undefined,
  options?: CspLintOptions,
): readonly CspLintFinding[] {
  const findings: CspLintFinding[] = [];
  const d = directives ?? {};
  const level = options?.level ?? 'moderate';

  for (const key of [
    'defaultSrc',
    'scriptSrc',
    'scriptSrcElem',
    'objectSrc',
    'baseUri',
    'frameAncestors',
  ] as const) {
    const sources = d[key];
    if (!Array.isArray(sources)) continue;
    if (sources.includes('*')) {
      findings.push({
        severity: 'high',
        directive: key,
        message: `${key} contains wildcard '*' — broadens attack surface`,
      });
    }
  }

  const scriptSrc = d.scriptSrc ?? d.defaultSrc;
  if (Array.isArray(scriptSrc)) {
    if (scriptSrc.includes("'unsafe-eval'")) {
      findings.push({
        severity: 'high',
        directive: 'script-src',
        message: "'unsafe-eval' permits eval-family APIs (DOM-XSS vector)",
      });
    }
    if (scriptSrc.includes("'unsafe-inline'") && level === 'strict') {
      const hasNonce = scriptSrc.some(s => s.startsWith("'nonce-"));
      if (!hasNonce) {
        findings.push({
          severity: 'high',
          directive: 'script-src',
          message: "'unsafe-inline' without nonce/hash defeats CSP XSS protection",
        });
      }
    }
  }

  if (!Array.isArray(d.objectSrc) || !d.objectSrc.includes("'none'")) {
    findings.push({
      severity: 'medium',
      directive: 'object-src',
      message: "object-src should be 'none' to disable plugins",
    });
  }
  if (!Array.isArray(d.baseUri)) {
    findings.push({
      severity: 'medium',
      directive: 'base-uri',
      message: 'base-uri is not set — base-tag injection possible',
    });
  }

  return findings;
}
