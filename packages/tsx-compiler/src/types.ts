import type { EventSignature, UiDocument, ValueShape, ValueType } from '@srijika/contracts';

export type SrijikaDiagnosticSeverity = 'error' | 'warning';

export interface SrijikaSourceSpan {
  /** Zero-based UTF-16 source offset, matching the TypeScript compiler API. */
  start: number;
  /** Exclusive zero-based UTF-16 source offset. */
  end: number;
  /** One-based line number for editor and CLI presentation. */
  line: number;
  /** One-based column number for editor and CLI presentation. */
  column: number;
  /** Present when the authoritative declaration lives outside the compiled UI file. */
  fileName?: string;
}

export interface SrijikaSourceEdit {
  start: number;
  end: number;
  newText: string;
}

export type SrijikaQuickFixKind =
  | 'add-missing-prop'
  | 'add-prop-type'
  | 'create-props-interface'
  | 'bind-event-prop'
  | 'remove-attribute';

export interface SrijikaQuickFix {
  title: string;
  kind: SrijikaQuickFixKind;
  edits: readonly SrijikaSourceEdit[];
  /** Machine-readable metadata used by a language server or Studio Inspector. */
  data: {
    propPath?: readonly string[];
    suggestedType?: ValueType;
    interfaceName?: string;
    attributeName?: string;
    eventName?: string;
  };
}

export type SrijikaDiagnosticCode =
  | 'SRIJIKA0001'
  | 'SRIJIKA1001'
  | 'SRIJIKA1002'
  | 'SRIJIKA1003'
  | 'SRIJIKA1004'
  | 'SRIJIKA1005'
  | 'SRIJIKA1006'
  | 'SRIJIKA1007'
  | 'SRIJIKA2001'
  | 'SRIJIKA2002'
  | 'SRIJIKA2003'
  | 'SRIJIKA2004'
  | 'SRIJIKA2005'
  | 'SRIJIKA3001'
  | 'SRIJIKA3002'
  | 'SRIJIKA3003';

export interface SrijikaDiagnostic {
  code: SrijikaDiagnosticCode;
  severity: SrijikaDiagnosticSeverity;
  message: string;
  fileName: string;
  span: SrijikaSourceSpan;
  quickFixes?: readonly SrijikaQuickFix[];
}

export interface SrijikaSourceMap {
  fileName: string;
  component: SrijikaSourceSpan | null;
  /** Stable, deterministic UiDocument node ID to TSX source span. */
  nodes: Readonly<Record<string, SrijikaSourceSpan>>;
  /** Public prop path (`user.name`) to its declaration or first use. */
  props: Readonly<Record<string, SrijikaSourceSpan>>;
}

export interface CompileSrijikaTsxOptions {
  documentId?: string;
  documentKind?: 'page' | 'component';
  revision?: number;
  /**
   * Bounded, caller-resolved type-only modules. The compiler never reads the
   * filesystem or resolves modules by itself.
   */
  resolvedTypeModules?: readonly SrijikaResolvedTypeModule[];
}

export interface SrijikaResolvedTypeModule {
  /** Exact relative module specifier used by the UI import. */
  specifier: string;
  /** Canonical project-relative or absolute source path used for provenance. */
  fileName: string;
  /** UTF-8 TypeScript source from the already-validated owner-local Types file. */
  source: string;
  /** Optional caller-computed content hash used by editors for cache identity. */
  hash?: string;
}

export type SrijikaComponentContractEntryKind = 'prop' | 'event' | 'slot';

interface SrijikaComponentContractEntryBase {
  name: string;
  required: boolean;
  /** Exact TypeScript type text from the authoritative props interface. */
  typeSource: string;
  /** Exact source span of the declared props-interface property signature. */
  span: SrijikaSourceSpan;
  contractSource?: {
    kind: 'local' | 'imported';
    fileName: string;
    hash?: string;
  };
}

/**
 * Inspector-only metadata for every supported member declared in the
 * component's props interface. Structural slots stay out of UiDocument
 * publicProps while remaining visible to code-first tooling here.
 */
export type SrijikaComponentContractEntry =
  | (SrijikaComponentContractEntryBase & {
      kind: 'prop';
      valueShape: ValueShape;
    })
  | (SrijikaComponentContractEntryBase & {
      kind: 'event';
      eventSignature: EventSignature;
    })
  | (SrijikaComponentContractEntryBase & {
      kind: 'slot';
    });

export interface CompileSrijikaTsxResult {
  /** Null only when syntax or top-level component structure prevents a safe AST. */
  document: UiDocument | null;
  diagnostics: readonly SrijikaDiagnostic[];
  sourceMap: SrijikaSourceMap;
  /** Deterministic source-order metadata for the declared component contract. */
  componentContract: readonly SrijikaComponentContractEntry[];
}

export type ReplaceSrijikaTextNodeFailureReason =
  'unknown-node' | 'invalid-source' | 'stale-source-map' | 'not-plain-text';

export type ReplaceSrijikaTextNodeResult =
  | {
      ok: true;
      /** The one source edit a Studio/LSP client may apply atomically. */
      edit: SrijikaSourceEdit;
      /** Convenience result after applying `edit` to the supplied source. */
      source: string;
    }
  | {
      ok: false;
      reason: ReplaceSrijikaTextNodeFailureReason;
      message: string;
    };

export type SrijikaEditablePropValue = string | number | boolean;

/**
 * A syntactically valid TypeScript type expression. Studio offers common
 * presets, while this string keeps custom, imported, union, object, and array
 * types available without creating a second contract model.
 */
export type SrijikaContractDataType = string;
export type SrijikaContractMemberKind = 'prop' | 'event' | 'slot';

export type SrijikaContractTypeNode =
  | { kind: 'string' | 'number' | 'boolean' | 'unknown' }
  | { kind: 'array'; item: SrijikaContractTypeNode }
  | {
      kind: 'object';
      fields: readonly SrijikaContractTypeField[];
    }
  | { kind: 'custom'; source: string };

export interface SrijikaContractTypeField {
  name: string;
  required: boolean;
  type: SrijikaContractTypeNode;
}

export interface InsertSrijikaContractMemberInput {
  kind: SrijikaContractMemberKind;
  name: string;
  required: boolean;
  /** Used only for data props; events and slots have fixed safe types. */
  dataType?: SrijikaContractDataType;
}

export type InsertSrijikaContractMemberFailureReason =
  | 'invalid-source'
  | 'missing-props-interface'
  | 'external-props-contract'
  | 'invalid-contract-name'
  | 'contract-member-exists'
  | 'contract-limit-reached'
  | 'invalid-contract-type';

export type InsertSrijikaContractMemberResult =
  | {
      ok: true;
      edits: readonly SrijikaSourceEdit[];
      source: string;
    }
  | {
      ok: false;
      reason: InsertSrijikaContractMemberFailureReason;
      message: string;
    };

export type ReplaceSrijikaNodePropFailureReason =
  'unknown-node' | 'invalid-source' | 'stale-source-map' | 'unknown-prop' | 'not-literal-prop';

export type ReplaceSrijikaNodePropResult =
  | {
      ok: true;
      /** The validated JSX-attribute edit that may be applied atomically. */
      edit: SrijikaSourceEdit;
      /** Convenience result after applying `edit` to the supplied source. */
      source: string;
    }
  | {
      ok: false;
      reason: ReplaceSrijikaNodePropFailureReason;
      message: string;
    };

export type InsertSrijikaNodeAttributeFailureReason =
  | 'unknown-node'
  | 'invalid-source'
  | 'stale-source-map'
  | 'unsupported-attribute'
  | 'attribute-exists'
  | 'invalid-value'
  | 'invalid-event-contract';

export type InsertSrijikaNodeAttributeResult =
  | {
      ok: true;
      edits: readonly SrijikaSourceEdit[];
      source: string;
    }
  | {
      ok: false;
      reason: InsertSrijikaNodeAttributeFailureReason;
      message: string;
    };

export interface InsertSrijikaJsxElementInput {
  /** A compiler-supported intrinsic tag. */
  tag: string;
  /** Primitive, literal attributes owned by the visual component catalogue. */
  attributes?: Readonly<Record<string, SrijikaEditablePropValue>>;
  /** Optional plain text child. Void elements must omit this. */
  text?: string;
}

export type InsertSrijikaJsxElementFailureReason =
  | 'unknown-node'
  | 'invalid-source'
  | 'stale-source-map'
  | 'not-container'
  | 'unsupported-element'
  | 'unsupported-attribute'
  | 'invalid-template';

export type InsertSrijikaJsxElementResult =
  | {
      ok: true;
      edit: SrijikaSourceEdit;
      source: string;
      /** Offset inside the inserted opening tag, used to select the derived node after compile. */
      insertedAt: number;
    }
  | {
      ok: false;
      reason: InsertSrijikaJsxElementFailureReason;
      message: string;
    };
