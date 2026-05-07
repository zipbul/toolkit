import type { RouterErrorData, RouteValidationIssue } from '../types';

// Single issue collected during a build / option validation pass. The shape
// matches RouterErrorData; the alias documents intent at aggregation sites.
export type RouterIssue = RouterErrorData;

// Aggregate row collected by seal() into the route-validation error payload.
export type { RouteValidationIssue };
