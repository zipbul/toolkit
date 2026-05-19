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
