import type {
  EventArgumentMapping,
  PublicProp,
  RepeatLiteralLocator,
  StyleProperties,
  SutraProject,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueShape,
  ValueType,
} from '@sutra/contracts';
import type { EditorBehavior, EventSpec, PropSpec, SlotSpec } from '@sutra/component-registry';

import type { AutomationDiagnostic } from './diagnostics';
import type { PROTOCOL_VERSION, TOOL_VERSION } from './version';

export interface VersionedAutomationEnvelope<TPayload> {
  protocolVersion: typeof PROTOCOL_VERSION;
  toolVersion: typeof TOOL_VERSION;
  requestId: string;
  documentFormatVersion: number;
  payload: TPayload;
}

export interface ProjectDocumentSummary {
  id: string;
  name: string;
  kind: UiDocument['kind'];
  revision: number;
  nodeCount: number;
  publicPropCount: number;
  isEntryPage: boolean;
}

export interface ProjectSummary {
  protocolVersion: typeof PROTOCOL_VERSION;
  documentFormatVersion: number;
  selectedPageId: string;
  project: Pick<SutraProject, 'id' | 'name' | 'entryPageId'> & {
    pageCount: number;
    componentCount: number;
  };
  pages: ProjectDocumentSummary[];
  missingDocumentIds: string[];
}

export interface PageOutlineEntry {
  id: string;
  kind: UiNode['kind'];
  name: string;
  componentId?: string;
  parentId?: string;
  slot?: string;
  index?: number;
  depth: number;
  childCount: number;
}

export interface PageOutline {
  documentId: string;
  name: string;
  revision: number;
  rootNodeId: string;
  totalNodeCount: number;
  returnedNodeCount: number;
  truncated: boolean;
  nodes: PageOutlineEntry[];
}

export interface PageOutlineOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface NodeChildGroup {
  slot: string;
  nodeIds: string[];
}

export interface NodeDetail {
  documentId: string;
  revision: number;
  node: UiNode;
  parent: { nodeId: string; slot: string; index: number } | null;
  children: NodeChildGroup[];
  referencedSymbols: string[];
}

export interface ComponentCatalogEntry {
  id: string;
  version: number;
  displayName: string;
  description: string;
  category: string;
  props: string[];
  events: string[];
  slots: string[];
  /** Full manifest metadata so automation clients do not have to guess prop types or controls. */
  propSpecs: Record<string, PropSpec>;
  eventSpecs: Record<string, EventSpec>;
  slotSpecs: Record<string, SlotSpec>;
  editor: EditorBehavior;
  defaultNode: UiNode;
  draggable: boolean;
  dropStrategy: string;
}

interface OperationIdentity {
  /** Stable caller-owned key used in generated-id results and diagnostics. */
  operationId?: string;
}

/** A stable node ID or a reference to a node created earlier in the same atomic batch. */
export type AutomationNodeReference = string | { createdBy: string };

interface InsertLocation {
  parentId: AutomationNodeReference;
  slot?: string;
  index?: number;
}

export interface InsertComponentOperation extends OperationIdentity, InsertLocation {
  kind: 'insertComponent';
  id?: string;
  componentId: string;
  name?: string;
  props?: Record<string, ValueExpression>;
  style?: Partial<StyleProperties>;
  classRefs?: string[];
}

export interface InsertTextOperation extends OperationIdentity, InsertLocation {
  kind: 'insertText';
  id?: string;
  name?: string;
  value: ValueExpression;
}

export interface InsertIfOperation extends OperationIdentity, InsertLocation {
  kind: 'insertIf';
  id?: string;
  name?: string;
  condition: ValueExpression;
}

export interface RepeatSymbolInput {
  id?: string;
  name?: string;
  displayName?: string;
  valueType?: ValueType;
  valueShape?: ValueShape;
}

export interface InsertRepeatOperation extends OperationIdentity, InsertLocation {
  kind: 'insertRepeat';
  id?: string;
  name?: string;
  source: ValueExpression;
  item?: RepeatSymbolInput;
  indexSymbol?: Pick<RepeatSymbolInput, 'id' | 'name' | 'displayName'>;
}

export interface MoveNodeOperation extends OperationIdentity, InsertLocation {
  kind: 'moveNode';
  nodeId: AutomationNodeReference;
}

export interface RemoveNodeOperation extends OperationIdentity {
  kind: 'removeNode';
  nodeId: AutomationNodeReference;
}

export interface RenameNodeOperation extends OperationIdentity {
  kind: 'renameNode';
  nodeId: AutomationNodeReference;
  name: string;
}

export interface SetPropOperation extends OperationIdentity {
  kind: 'setProp';
  nodeId: AutomationNodeReference;
  propName: string;
  value: ValueExpression | null;
}

export interface SetStyleOperation extends OperationIdentity {
  kind: 'setStyle';
  nodeId: AutomationNodeReference;
  style: Partial<StyleProperties>;
  unset?: Array<keyof StyleProperties>;
  /** Writes to style.base when omitted, otherwise to style.breakpoints[breakpoint]. */
  breakpoint?: string;
}

export interface SetEventBindingOperation extends OperationIdentity {
  kind: 'setEventBinding';
  nodeId: AutomationNodeReference;
  eventName: string;
  handler: ValueExpression | null;
  argument: EventArgumentMapping | null;
}

export interface AddPublicPropOperation extends OperationIdentity {
  kind: 'addPublicProp';
  prop: PublicProp;
}

export interface ConvertRepeatedSiblingsOperation extends OperationIdentity {
  kind: 'convertRepeatedSiblings';
  /** Stable candidate ID returned by sutra_analyze_repetitions at expectedRevision. */
  candidateId: string;
  propName: string;
  propDisplayName?: string;
  repeatName?: string;
  repeatNodeId?: string;
  propSymbolId?: string;
  itemSymbolId?: string;
  indexSymbolId?: string;
}

export interface ReplaceDocumentOperation extends OperationIdentity {
  kind: 'replaceDocument';
  document: UiDocument;
}

export type SutraOperation =
  | InsertComponentOperation
  | InsertTextOperation
  | InsertIfOperation
  | InsertRepeatOperation
  | MoveNodeOperation
  | RemoveNodeOperation
  | RenameNodeOperation
  | SetPropOperation
  | SetStyleOperation
  | SetEventBindingOperation
  | AddPublicPropOperation
  | ConvertRepeatedSiblingsOperation
  | ReplaceDocumentOperation;

export interface RepetitionFieldSummary {
  name: string;
  displayName: string;
  shape: ValueShape;
  locator: RepeatLiteralLocator;
  values?: unknown[];
}

export interface RepetitionCandidateSummary {
  candidateId: string;
  parentId: string;
  slot: string;
  startIndex: number;
  nodeIds: string[];
  instanceCount: number;
  templateNodeId: string;
  templateKind: UiNode['kind'];
  depth: number;
  confidence: number;
  fields: RepetitionFieldSummary[];
}

export interface RepetitionAnalysis {
  documentId: string;
  revision: number;
  minInstances: number;
  totalCount: number;
  returnedCount: number;
  truncated: boolean;
  candidates: RepetitionCandidateSummary[];
}

export interface RepetitionAnalysisOptions {
  minInstances?: number;
  maxCandidates?: number;
  includeValues?: boolean;
  /** Return only the reviewed candidate from a prior analysis at the same revision. */
  candidateId?: string;
}

interface GeneratedCodeMetadata {
  protocolVersion: typeof PROTOCOL_VERSION;
  toolVersion: typeof TOOL_VERSION;
  documentFormatVersion: number;
  documentId: string;
  revision: number;
  language: 'tsx';
  fileName: string;
  characterCount: number;
  lineCount: number;
}

export interface GeneratedPublicPropSummary {
  name: string;
  valueType: ValueType;
  required: boolean;
  hasDefault: boolean;
  valueShape?: ValueShape;
}

export interface GeneratedCodeSummary extends GeneratedCodeMetadata {
  detail: 'summary';
  publicPropInterface: string;
  publicProps: GeneratedPublicPropSummary[];
  structure: {
    nodeCount: number;
    repeatCount: number;
    conditionalCount: number;
  };
  repeatMapSignatures: string[];
}

export interface GeneratedCodeFull extends GeneratedCodeMetadata {
  detail: 'full';
  code: string;
}

export type GeneratedCodeResult = GeneratedCodeSummary | GeneratedCodeFull;

export type AutomationIdKind = 'node' | 'symbol';

export interface AutomationIdContext {
  kind: AutomationIdKind;
  operationKind: SutraOperation['kind'];
  operationIndex: number;
  hint: string;
}

export type AutomationIdFactory = (context: AutomationIdContext) => string;

export interface ApplyOperationsSuccess {
  ok: true;
  document: UiDocument;
  previousRevision: number;
  revision: number;
  appliedOperationCount: number;
  createdIds: Record<string, string>;
  diagnostics: AutomationDiagnostic[];
}

export interface ApplyOperationsFailure {
  ok: false;
  currentRevision: number;
  failedOperationIndex?: number;
  createdIds: Record<string, never>;
  diagnostics: AutomationDiagnostic[];
}

export type ApplyOperationsResult = ApplyOperationsSuccess | ApplyOperationsFailure;
