export interface NativeSourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface NativeDiagnostic extends NativeSourceSpan {
  code: string;
  fileName: string;
  severity: 'error';
  message: string;
}

export type NativeValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'reference'; path: readonly string[] }
  | { kind: 'object'; fields: Readonly<Record<string, NativeValue>> }
  | { kind: 'array'; items: readonly NativeValue[] }
  | { kind: 'binary'; operator: string; left: NativeValue; right: NativeValue };

export type NativeUiNode =
  | {
      id: string;
      kind: 'element';
      component: string;
      props: Readonly<Record<string, NativeValue>>;
      children: readonly string[];
    }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'expression'; value: NativeValue }
  | { id: string; kind: 'slot'; name: string }
  | { id: string; kind: 'fragment'; children: readonly string[] }
  | {
      id: string;
      kind: 'conditional';
      condition: NativeValue;
      whenTrue: string;
      whenFalse: string | null;
    };

/** A Native-only read model; never persisted over the developer's TSX. */
export interface NativeUiDocument {
  version: 'srijika-native-ui-v1';
  componentName: string;
  rootNodeId: string;
  nodes: Readonly<Record<string, NativeUiNode>>;
  contract: readonly { name: string; type: string; optional: boolean }[];
}

export interface NativeCompileResult {
  document: NativeUiDocument | null;
  diagnostics: readonly NativeDiagnostic[];
  sourceMap: Readonly<Record<string, NativeSourceSpan>>;
}

export interface NativeProjectConfig {
  version: 1;
  profile: 'expo-go-v1';
  platforms: readonly ('android' | 'ios')[];
}

export interface NativeScaffoldOptions {
  projectName?: string;
  displayName?: string;
}
