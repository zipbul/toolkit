/**
 * Parsed-path data model. The builder layer produces a `PathPart[]` from
 * raw route strings; the tree and pipeline layers consume that array to
 * insert routes. Defining the shape here keeps the dependency direction
 * acyclic (builder → tree, tree ← pipeline; neither imports the other).
 */

export enum PathPartType {
  Static = 'static',
  Param = 'param',
  Wildcard = 'wildcard',
}

export enum WildcardOrigin {
  Star = 'star',
  Multi = 'multi',
}

export type PathPart =
  | { type: PathPartType.Static; value: string; segments: string[] }
  | { type: PathPartType.Param; name: string; pattern: string | null; optional: boolean }
  | { type: PathPartType.Wildcard; name: string; origin: WildcardOrigin };
