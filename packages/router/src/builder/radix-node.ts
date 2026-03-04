export interface RadixNode {
  /** Edge label (root = '/') */
  part: string;
  /** Handler index (terminal node) or null */
  store: number | null;
  /** charCode → child node (plain object for JSC indexed storage) */
  inert: Record<number, RadixNode> | null;
  /** Parameter child chain */
  params: ParamNode | null;
  /** Wildcard handler index */
  wildcardStore: number | null;
  /** Wildcard param name */
  wildcardName: string | null;
  /** Wildcard origin: 'star' = empty allowed, 'multi' = min 1 char */
  wildcardOrigin: 'star' | 'multi' | null;
}

export interface ParamNode {
  /** Parameter name */
  name: string;
  /** Handler index if terminal */
  store: number | null;
  /** Next static part after this param */
  inert: RadixNode | null;
  /** Regex pattern for validation */
  pattern: RegExp | null;
  /** Original regex source string */
  patternSource: string | null;
  /** Next param with different pattern at same level */
  next: ParamNode | null;
}

export function createRadixNode(part: string): RadixNode {
  return {
    part,
    store: null,
    inert: null,
    params: null,
    wildcardStore: null,
    wildcardName: null,
    wildcardOrigin: null,
  };
}

export function createParamNode(name: string): ParamNode {
  return {
    name,
    store: null,
    inert: null,
    pattern: null,
    patternSource: null,
    next: null,
  };
}
