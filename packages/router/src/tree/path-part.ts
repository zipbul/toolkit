/**
 * Parsed-path data model. The builder layer produces a `PathPart[]` from
 * raw route strings; the tree and pipeline layers consume that array to
 * insert routes. Defining the shape here keeps the dependency direction
 * acyclic (builder → tree, tree ← pipeline; neither imports the other).
 */
export type PathPart =
  | { type: 'static'; value: string; segments: string[] }
  | { type: 'param'; name: string; pattern: string | null; optional: boolean }
  | { type: 'wildcard'; name: string; origin: 'star' | 'multi' };
