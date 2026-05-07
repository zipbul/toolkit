import type { RouterErrorData } from '../types';

/**
 * Single issue collected during a build / option validation pass. Identical
 * shape to RouterErrorData; the dedicated alias documents intent at the
 * call sites that aggregate into a route-validation error.
 */
export type ValidationIssue = RouterErrorData;
