import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { assertDocumentSemantics } from '@srijika/component-registry';
import {
  createBlankDocument,
  literal,
  validateUiDocument,
  type EventArgumentMapping,
  type EventSignature,
  type InstanceEventSpec,
  type InstancePropSpec,
  type LiteralValue,
  type PageDefinition,
  type PublicProp,
  type StyleProperties,
  type UiDocument,
  type UiNode,
  type ValueExpression,
  type ValueShape,
  type ValueType,
} from '@srijika/contracts';
import {
  DocumentHistory,
  assertValidDocumentGraph,
  deriveParentIndex,
  isDescendant,
  type DocumentCommand,
} from '@srijika/document-engine';

import { componentRegistry } from '../lib/registry';
import { createStarterDocument } from '../lib/starter';

export type StudioPanel = 'canvas' | 'json' | 'tsx';
export type InspectorTab = 'design' | 'props' | 'events';
export type ViewportPreset = 'desktop' | 'tablet' | 'mobile';
export interface ViewportSize {
  width: number;
  height: number;
}
export const VIEWPORT_PRESET_SIZES: Readonly<Record<ViewportPreset, ViewportSize>> = {
  desktop: { width: 1180, height: 820 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
export type StudioDragPayload =
  | { kind: 'component'; componentId: string }
  | { kind: 'structure'; structure: 'if' | 'repeat' }
  | { kind: 'node'; nodeId: string };
export type NodeDropIntent = 'before' | 'inside' | 'after';
export interface LiteralPropPromotionCandidate {
  propName: string;
  suggestedName: string;
  value: LiteralValue;
  valueType: Exclude<ValueType, 'event'>;
}
export interface StudioDragPointer {
  clientX: number;
  clientY: number;
  phase: 'move' | 'drop';
}
export interface StudioNotice {
  kind: 'status' | 'error';
  message: string;
}

interface StudioState {
  pages: PageDefinition[];
  selectedPageId: string;
  document: UiDocument;
  selectedNodeId: string;
  dropTargetNodeId: string | null;
  dropIntent: NodeDropIntent;
  panel: StudioPanel;
  inspectorTab: InspectorTab;
  viewport: ViewportPreset;
  customViewportSize: ViewportSize | null;
  activeIfBranches: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>;
  activeDrag: StudioDragPayload | null;
  dragPointer: StudioDragPointer | null;
  notice: StudioNotice | null;
  createPage: (name: string) => string | null;
  selectPage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  resetProject: () => void;
  dispatch: (command: DocumentCommand) => boolean;
  showStatus: (message: string) => void;
  reportError: (context: string, cause?: unknown) => void;
  clearNotice: () => void;
  selectNode: (nodeId: string) => void;
  setDropTarget: (nodeId: string | null, intent?: NodeDropIntent) => void;
  setPanel: (panel: StudioPanel) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setViewport: (viewport: ViewportPreset) => void;
  setCustomViewportSize: (width: number, height: number) => void;
  setActiveIfBranch: (nodeId: string, branch: 'whenTrue' | 'whenFalse') => void;
  beginDrag: (payload: StudioDragPayload) => void;
  moveDrag: (clientX: number, clientY: number) => void;
  releaseDrag: (clientX: number, clientY: number) => void;
  endDrag: () => void;
  addComponent: (
    componentId: string,
    targetNodeId?: string,
    intent?: NodeDropIntent,
  ) => string | null;
  addIfNode: (targetNodeId?: string, intent?: NodeDropIntent) => string | null;
  addRepeatNode: (targetNodeId?: string, intent?: NodeDropIntent) => string | null;
  dropDragPayload: (
    payload: StudioDragPayload,
    targetNodeId: string,
    intent?: NodeDropIntent,
  ) => string | null;
  moveNode: (nodeId: string, targetNodeId: string, intent?: NodeDropIntent) => void;
  promoteLiteralProp: (nodeId: string, propName: string) => string | null;
  removeSelectedNode: () => void;
  setPropExpression: (nodeId: string, propName: string, value: ValueExpression | null) => void;
  addInstanceProp: (
    nodeId: string,
    propName: string,
    spec: InstancePropSpec,
    value?: ValueExpression | null,
  ) => void;
  updateInstanceProp: (
    nodeId: string,
    propName: string,
    nextPropName: string,
    spec: InstancePropSpec,
    value?: ValueExpression | null,
  ) => void;
  removeInstanceProp: (nodeId: string, propName: string) => void;
  setLiteralProp: (nodeId: string, propName: string, value: string | number | boolean) => void;
  bindProp: (
    nodeId: string,
    propName: string,
    symbolId: string | null,
    path?: readonly string[],
  ) => void;
  bindEvent: (nodeId: string, eventName: string, symbolId: string | null) => void;
  setEventBinding: (
    nodeId: string,
    eventName: string,
    symbolId: string | null,
    argument: EventArgumentMapping | null,
  ) => void;
  addInstanceEvent: (nodeId: string, eventName: string, spec: InstanceEventSpec) => void;
  updateInstanceEvent: (
    nodeId: string,
    eventName: string,
    nextEventName: string,
    spec: InstanceEventSpec,
  ) => void;
  removeInstanceEvent: (nodeId: string, eventName: string) => void;
  setStyle: <K extends keyof StyleProperties>(
    nodeId: string,
    property: K,
    value: StyleProperties[K] | null,
  ) => void;
  setVisibility: (nodeId: string, value: ValueExpression) => void;
  setIfCondition: (nodeId: string, value: ValueExpression) => void;
  setRepeatSource: (nodeId: string, value: ValueExpression) => void;
  setClassRefs: (nodeId: string, classRefs: string[]) => void;
  addPublicProp: (name: string, valueType: ValueType) => void;
  setPublicPropShape: (propName: string, valueShape: ValueShape | null) => void;
  setPublicPropDefaultValue: (propName: string, value: LiteralValue) => void;
  setPublicPropType: (propName: string, valueType: ValueType) => void;
  setPublicPropEventSignature: (propName: string, eventSignature: EventSignature) => void;
  removePublicProp: (propName: string) => void;
  undo: () => void;
  redo: () => void;
  loadDocument: (value: unknown) => boolean;
  resetDocument: () => void;
}

const historyOptions = {
  maxEntries: 250,
  coalesceWindowMs: 650,
  validate: (document: UiDocument) => assertDocumentSemantics(document, componentRegistry),
} as const;

type IfBranch = 'whenTrue' | 'whenFalse';

interface PageSession {
  history: DocumentHistory;
  selectedNodeId: string;
  activeIfBranches: Readonly<Record<string, IfBranch>>;
}

function functionNameFor(pageName: string): string {
  const words = pageName.trim().match(/[A-Za-z0-9]+/g) ?? [];
  const value = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  const safe = value || 'UntitledPage';
  const identifier = /^[A-Za-z_$]/.test(safe) ? safe : `Page${safe}`;
  return identifier.endsWith('Page') ? identifier : `${identifier}Page`;
}

function pageFromDocument(document: UiDocument): PageDefinition {
  return {
    id: document.id,
    name: document.name,
    functionName: functionNameFor(document.name),
    width: 100,
    height: 100,
    locked: true,
    document,
  };
}

function createBlankPage(id: string, name: string): { page: PageDefinition; session: PageSession } {
  const document = createBlankDocument(id, name);
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('A page root must be an element');
  root.name = name;
  root.locked = true;
  root.style.base = {
    ...root.style.base,
    width: { mode: 'percent', value: 100 },
    height: { mode: 'percent', value: 100 },
  };
  assertValidDocumentGraph(document);
  assertDocumentSemantics(document, componentRegistry);
  const history = new DocumentHistory(document, historyOptions);
  const page = pageFromDocument(history.document);
  return {
    page,
    session: {
      history,
      selectedNodeId: history.document.rootNodeId,
      activeIfBranches: {},
    },
  };
}

function createInitialProject(): { pages: PageDefinition[]; sessions: Map<string, PageSession> } {
  const home = createBlankPage('page_home', 'Home Page');
  return {
    pages: [home.page],
    sessions: new Map([[home.page.id, home.session]]),
  };
}

function replacePageDocument(
  pages: readonly PageDefinition[],
  pageId: string,
  document: UiDocument,
): PageDefinition[] {
  return pages.map((page) => (page.id === pageId ? pageFromDocument(document) : page));
}

const initialProject = createInitialProject();
let pageSessions = initialProject.sessions;

function errorDetail(cause: unknown): string | null {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === 'string' && cause.trim()) return cause.trim();
  return null;
}

function errorNotice(context: string, cause?: unknown): StudioNotice {
  const detail = errorDetail(cause);
  return {
    kind: 'error',
    message: detail && detail !== context ? `${context}: ${detail}` : context,
  };
}

const syncDocument = (document: UiDocument): UiDocument => {
  return document;
};

function childSlot(
  node: UiNode,
  activeIfBranches: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>,
): string | null {
  if (node.kind === 'element' && node.slots['children']) return 'children';
  if (node.kind === 'if') return activeIfBranches[node.id] ?? 'whenTrue';
  if (node.kind === 'repeat' || node.kind === 'fragment') return 'children';
  if (node.kind === 'slot') return 'fallback';
  return null;
}

function mutableChildrenFor(node: UiNode, slot: string): readonly string[] | undefined {
  if (node.kind === 'element') return node.slots[slot];
  if (node.kind === 'if') return node[slot as IfBranch];
  if (node.kind === 'repeat' || node.kind === 'fragment') return node.children;
  if (node.kind === 'slot') return node.fallback;
  return undefined;
}

function insertionLocation(
  document: UiDocument,
  selectedNodeId: string,
  activeIfBranches: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>,
  requested?: string,
): { parentId: string; slot: string } {
  const candidate = requested ?? selectedNodeId;
  const node = document.nodes[candidate];
  if (node) {
    const slot = childSlot(node, activeIfBranches);
    if (slot) return { parentId: candidate, slot };
  }
  const parentId = deriveParentIndex(document).get(candidate)?.parentId ?? document.rootNodeId;
  const parent = document.nodes[parentId];
  return {
    parentId,
    slot: parent ? (childSlot(parent, activeIfBranches) ?? 'children') : 'children',
  };
}

function insertionPlacement(
  document: UiDocument,
  selectedNodeId: string,
  activeIfBranches: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>,
  requestedTargetId?: string,
  intent: NodeDropIntent = 'inside',
): { parentId: string; slot: string; index: number } {
  if (requestedTargetId && intent !== 'inside') {
    const location = deriveParentIndex(document).get(requestedTargetId);
    if (location) {
      return {
        parentId: location.parentId,
        slot: location.slot,
        index: location.index + (intent === 'after' ? 1 : 0),
      };
    }
  }

  const { parentId, slot } = insertionLocation(
    document,
    selectedNodeId,
    activeIfBranches,
    requestedTargetId,
  );
  const parent = document.nodes[parentId];
  return {
    parentId,
    slot,
    index: parent ? (mutableChildrenFor(parent, slot)?.length ?? 0) : 0,
  };
}

function literalValueType(value: LiteralValue): Exclude<ValueType, 'event'> {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'unknown';
}

function literalValueShape(value: LiteralValue): ValueShape {
  if (value === null) return { kind: 'unknown' };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) {
    const shapes = value.map(literalValueShape);
    const first = shapes[0];
    const homogeneous =
      first && shapes.every((shape) => JSON.stringify(shape) === JSON.stringify(first));
    return { kind: 'array', item: homogeneous ? first : { kind: 'unknown' } };
  }
  const fields: Extract<ValueShape, { kind: 'object' }>['fields'] = {};
  for (const [name, fieldValue] of Object.entries(value)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    fields[name] = { required: true, shape: literalValueShape(fieldValue) };
  }
  return { kind: 'object', fields, additionalProperties: true };
}

function identifierWords(value: string): string[] {
  return value.match(/[A-Za-z0-9]+/g) ?? [];
}

function camelIdentifier(value: string, fallback: string): string {
  const words = identifierWords(value);
  const built = words
    .map((word, index) => {
      const normalized = word.toLowerCase();
      return index === 0
        ? normalized
        : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    })
    .join('');
  const safe = built || fallback;
  return /^[A-Za-z_$]/.test(safe) ? safe : `_${safe}`;
}

function uniquePublicPropName(document: UiDocument, baseName: string): string {
  if (!document.publicProps[baseName]) return baseName;
  let suffix = 2;
  while (document.publicProps[`${baseName}${suffix}`]) suffix += 1;
  return `${baseName}${suffix}`;
}

function suggestedPublicPropName(document: UiDocument, node: UiNode, propName: string): string {
  const nodePart = camelIdentifier(node.name, 'component');
  const propWords = identifierWords(propName);
  const propPart = propWords
    .map((word) => {
      const normalized = word.toLowerCase();
      return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    })
    .join('');
  return uniquePublicPropName(document, `${nodePart}${propPart || 'Value'}`);
}

export function literalPropPromotionCandidates(
  document: UiDocument,
  nodeId: string,
): LiteralPropPromotionCandidate[] {
  const node = document.nodes[nodeId];
  if (!node || node.kind !== 'element' || node.id === document.rootNodeId) return [];
  const manifest = componentRegistry.get(node.componentId)?.manifest;
  return Object.entries(node.props).flatMap(([propName, expression]) => {
    if (expression.kind !== 'literal') return [];
    const declaredType = manifest?.props[propName]?.type ?? node.instanceProps?.[propName]?.type;
    const valueType =
      declaredType && declaredType !== 'event' && declaredType !== 'unknown'
        ? declaredType
        : literalValueType(expression.value);
    return [
      {
        propName,
        suggestedName: suggestedPublicPropName(document, node, propName),
        value: expression.value,
        valueType,
      },
    ];
  });
}

export const useStudioStore = create<StudioState>((set, get) => ({
  pages: initialProject.pages,
  selectedPageId: initialProject.pages[0]!.id,
  document: initialProject.pages[0]!.document,
  selectedNodeId: initialProject.pages[0]!.document.rootNodeId,
  dropTargetNodeId: null,
  dropIntent: 'inside',
  panel: 'canvas',
  inspectorTab: 'design',
  viewport: 'desktop',
  customViewportSize: null,
  activeIfBranches: {},
  activeDrag: null,
  dragPointer: null,
  notice: null,

  createPage: (rawName) => {
    const name = rawName.trim();
    if (!name) return null;
    const next = createBlankPage(`page_${nanoid(8)}`, name);
    pageSessions.set(next.page.id, next.session);
    set((state) => ({
      pages: [...state.pages, next.page],
      selectedPageId: next.page.id,
      document: next.page.document,
      selectedNodeId: next.session.selectedNodeId,
      activeIfBranches: next.session.activeIfBranches,
      activeDrag: null,
      dragPointer: null,
      dropTargetNodeId: null,
      dropIntent: 'inside',
      notice: null,
    }));
    return next.page.id;
  },

  selectPage: (pageId) => {
    const state = get();
    if (state.selectedPageId === pageId) return;
    const nextSession = pageSessions.get(pageId);
    if (!nextSession || !state.pages.some((page) => page.id === pageId)) return;

    const currentSession = pageSessions.get(state.selectedPageId);
    if (currentSession) {
      currentSession.selectedNodeId = state.selectedNodeId;
      currentSession.activeIfBranches = state.activeIfBranches;
    }
    const document = nextSession.history.document;
    const selectedNodeId = document.nodes[nextSession.selectedNodeId]
      ? nextSession.selectedNodeId
      : document.rootNodeId;
    nextSession.selectedNodeId = selectedNodeId;
    set({
      selectedPageId: pageId,
      document,
      selectedNodeId,
      activeIfBranches: nextSession.activeIfBranches,
      activeDrag: null,
      dragPointer: null,
      dropTargetNodeId: null,
      dropIntent: 'inside',
      notice: null,
    });
  },

  renamePage: (pageId, rawName) => {
    const name = rawName.trim();
    if (!name) return;
    const session = pageSessions.get(pageId);
    if (!session) return;
    const document = structuredClone(session.history.document);
    if (document.name === name) return;
    document.name = name;
    const root = document.nodes[document.rootNodeId];
    if (root) root.name = name;
    try {
      const nextDocument = session.history.dispatch({ kind: 'replaceDocument', document });
      set((state) => ({
        pages: replacePageDocument(state.pages, pageId, nextDocument),
        ...(state.selectedPageId === pageId ? { document: nextDocument } : {}),
        notice: null,
      }));
    } catch (error) {
      set({ notice: errorNotice('Could not rename page', error) });
    }
  },

  resetProject: () => {
    const next = createInitialProject();
    pageSessions = next.sessions;
    const home = next.pages[0]!;
    set({
      pages: next.pages,
      selectedPageId: home.id,
      document: home.document,
      selectedNodeId: home.document.rootNodeId,
      panel: 'canvas',
      inspectorTab: 'design',
      activeIfBranches: {},
      activeDrag: null,
      dragPointer: null,
      dropTargetNodeId: null,
      dropIntent: 'inside',
      notice: null,
    });
  },

  dispatch: (command) => {
    const state = get();
    const session = pageSessions.get(state.selectedPageId);
    if (!session) {
      set({ notice: errorNotice('Could not apply this change', 'Active page does not exist') });
      return false;
    }
    if (
      command.kind === 'replaceDocument' &&
      (command.document.kind !== 'page' || command.document.id !== state.selectedPageId)
    ) {
      set({
        notice: errorNotice(
          'Could not apply this change',
          'A replacement document must target the active page',
        ),
      });
      return false;
    }
    try {
      const document = session.history.dispatchEnvelope({
        commandVersion: 1,
        commandId: `command_${nanoid(10)}`,
        documentId: session.history.document.id,
        baseRevision: session.history.document.revision,
        origin: 'user',
        command,
      });
      set((current) => ({
        document: syncDocument(document),
        pages: replacePageDocument(current.pages, state.selectedPageId, document),
        notice: null,
      }));
      return true;
    } catch (error) {
      set({ notice: errorNotice('Could not apply this change', error) });
      return false;
    }
  },

  showStatus: (message) => set({ notice: { kind: 'status', message } }),
  reportError: (context, cause) => set({ notice: errorNotice(context, cause) }),
  clearNotice: () => set({ notice: null }),

  selectNode: (nodeId) => {
    const state = get();
    if (state.document.nodes[nodeId]) {
      const session = pageSessions.get(state.selectedPageId);
      if (session) session.selectedNodeId = nodeId;
      set({ selectedNodeId: nodeId });
    }
  },
  setDropTarget: (nodeId, dropIntent = 'inside') =>
    set({ dropTargetNodeId: nodeId, dropIntent: nodeId ? dropIntent : 'inside' }),
  setPanel: (panel) => set({ panel }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setViewport: (viewport) => set({ viewport, customViewportSize: null }),
  setCustomViewportSize: (width, height) => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const clampDimension = (value: number): number =>
      Math.min(3840, Math.max(240, Math.round(value)));
    set({
      customViewportSize: {
        width: clampDimension(width),
        height: clampDimension(height),
      },
    });
  },
  setActiveIfBranch: (nodeId, branch) =>
    set((state) => {
      if (state.activeIfBranches[nodeId] === branch) return state;
      const activeIfBranches = { ...state.activeIfBranches, [nodeId]: branch };
      const session = pageSessions.get(state.selectedPageId);
      if (session) session.activeIfBranches = activeIfBranches;
      return { activeIfBranches };
    }),
  beginDrag: (activeDrag) => set({ activeDrag, dragPointer: null }),
  moveDrag: (clientX, clientY) => set({ dragPointer: { clientX, clientY, phase: 'move' } }),
  releaseDrag: (clientX, clientY) => set({ dragPointer: { clientX, clientY, phase: 'drop' } }),
  endDrag: () =>
    set({ activeDrag: null, dragPointer: null, dropTargetNodeId: null, dropIntent: 'inside' }),

  addComponent: (componentId, requestedTargetId, intent = 'inside') => {
    const state = get();
    const { parentId, slot, index } = insertionPlacement(
      state.document,
      state.selectedNodeId,
      state.activeIfBranches,
      requestedTargetId,
      intent,
    );
    const parent = state.document.nodes[parentId];
    if (!parent) {
      state.reportError('Could not add component', 'Drop parent does not exist');
      return null;
    }
    const component = componentRegistry.get(componentId);
    if (!component) {
      state.reportError('Could not add component', `Unknown component: ${componentId}`);
      return null;
    }
    const id = `${componentId.replace('srijika.', '')}_${nanoid(7)}`;
    const node = component.createNode(id);
    if (!state.dispatch({ kind: 'insertNode', parentId, slot, index, node })) return null;
    const session = pageSessions.get(state.selectedPageId);
    if (session) session.selectedNodeId = id;
    set({ selectedNodeId: id, panel: 'canvas' });
    return id;
  },

  addIfNode: (requestedTargetId, intent = 'inside') => {
    const state = get();
    const { parentId, slot, index } = insertionPlacement(
      state.document,
      state.selectedNodeId,
      state.activeIfBranches,
      requestedTargetId,
      intent,
    );
    const parent = state.document.nodes[parentId];
    if (!parent) {
      state.reportError('Could not add condition', 'Drop parent does not exist');
      return null;
    }
    const id = `if_${nanoid(7)}`;
    const node: UiNode = {
      kind: 'if',
      id,
      name: 'Condition',
      condition: literal(true),
      whenTrue: [],
      whenFalse: [],
    };
    if (
      !state.dispatch({
        kind: 'insertNode',
        parentId,
        slot,
        index,
        node,
      })
    )
      return null;
    set((current) => {
      const activeIfBranches = { ...current.activeIfBranches, [id]: 'whenTrue' as const };
      const session = pageSessions.get(current.selectedPageId);
      if (session) {
        session.selectedNodeId = id;
        session.activeIfBranches = activeIfBranches;
      }
      return { selectedNodeId: id, activeIfBranches };
    });
    return id;
  },

  addRepeatNode: (requestedTargetId, intent = 'inside') => {
    const state = get();
    const { parentId, slot, index } = insertionPlacement(
      state.document,
      state.selectedNodeId,
      state.activeIfBranches,
      requestedTargetId,
      intent,
    );
    const parent = state.document.nodes[parentId];
    if (!parent) {
      state.reportError('Could not add repeater', 'Drop parent does not exist');
      return null;
    }
    const id = `repeat_${nanoid(7)}`;
    const itemSymbolId = `${id}_item`;
    const indexSymbolId = `${id}_index`;
    const node: UiNode = {
      kind: 'repeat',
      id,
      name: 'Repeater',
      source: literal(null),
      itemSymbolId,
      indexSymbolId,
      children: [],
    };
    const itemSymbol = {
      id: itemSymbolId,
      name: 'item',
      displayName: 'Current item',
      provider: 'repeatItem',
      valueType: 'unknown',
      required: true,
    } as const;
    const indexSymbol = {
      id: indexSymbolId,
      name: 'index',
      displayName: 'Current index',
      provider: 'repeatIndex',
      valueType: 'number',
      required: true,
    } as const;
    if (
      !state.dispatch({
        kind: 'insertRepeat',
        parentId,
        slot,
        index,
        node,
        itemSymbol,
        indexSymbol,
      })
    )
      return null;
    const session = pageSessions.get(state.selectedPageId);
    if (session) session.selectedNodeId = id;
    set({ selectedNodeId: id });
    return id;
  },

  dropDragPayload: (payload, targetNodeId, intent = 'inside') => {
    if (payload.kind === 'component') {
      return get().addComponent(payload.componentId, targetNodeId, intent);
    }
    if (payload.kind === 'structure') {
      return payload.structure === 'if'
        ? get().addIfNode(targetNodeId, intent)
        : get().addRepeatNode(targetNodeId, intent);
    }

    const revision = get().document.revision;
    get().moveNode(payload.nodeId, targetNodeId, intent);
    return get().document.revision === revision ? null : payload.nodeId;
  },

  moveNode: (nodeId, targetNodeId, intent = 'inside') => {
    const state = get();
    if (nodeId === state.document.rootNodeId || nodeId === targetNodeId) return;

    let parentId: string;
    let slot: string;
    let index: number;
    if (intent === 'inside') {
      const parent = state.document.nodes[targetNodeId];
      if (!parent) return;
      const targetSlot = childSlot(parent, state.activeIfBranches);
      if (!targetSlot) return;
      parentId = targetNodeId;
      slot = targetSlot;
      const children = mutableChildrenFor(parent, targetSlot);
      index = children?.length ?? 0;
    } else {
      const location = deriveParentIndex(state.document).get(targetNodeId);
      if (!location) return;
      parentId = location.parentId;
      slot = location.slot;
      index = location.index + (intent === 'after' ? 1 : 0);
    }
    if (isDescendant(state.document, nodeId, parentId)) return;
    const current = deriveParentIndex(state.document).get(nodeId);
    if (current && current.parentId === parentId && current.slot === slot) {
      const adjustedIndex = current.index < index ? index - 1 : index;
      if (adjustedIndex === current.index) return;
    }
    if (
      state.dispatch({
        kind: 'moveNode',
        nodeId,
        parentId,
        slot,
        index,
      })
    ) {
      const session = pageSessions.get(state.selectedPageId);
      if (session) session.selectedNodeId = nodeId;
      set({ selectedNodeId: nodeId });
    }
  },

  promoteLiteralProp: (nodeId, propName) => {
    const state = get();
    const candidate = literalPropPromotionCandidates(state.document, nodeId).find(
      (entry) => entry.propName === propName,
    );
    const node = state.document.nodes[nodeId];
    if (!candidate || !node || node.kind !== 'element') {
      state.reportError('Could not move value to a page prop', 'Choose a static component value');
      return null;
    }

    const nextDocument = structuredClone(state.document);
    const nextNode = nextDocument.nodes[nodeId];
    if (!nextNode || nextNode.kind !== 'element') return null;
    const symbolId = `prop_${nanoid(8)}`;
    const inferredShape = literalValueShape(candidate.value);
    const valueShape =
      (candidate.valueType === 'array' || candidate.valueType === 'object') &&
      inferredShape.kind === candidate.valueType
        ? inferredShape
        : undefined;
    const prop: PublicProp = {
      symbolId,
      name: candidate.suggestedName,
      displayName: candidate.suggestedName,
      valueType: candidate.valueType,
      ...(valueShape ? { valueShape } : {}),
      required: false,
      defaultValue: structuredClone(candidate.value),
    };
    nextDocument.publicProps[prop.name] = prop;
    nextDocument.symbols[symbolId] = {
      id: symbolId,
      name: prop.name,
      displayName: prop.displayName,
      provider: 'prop',
      valueType: prop.valueType,
      ...(valueShape ? { valueShape: structuredClone(valueShape) } : {}),
      required: false,
      defaultValue: structuredClone(candidate.value),
    };
    nextNode.props[propName] = { kind: 'reference', symbolId, path: [] };
    nextDocument.revision = state.document.revision + 1;

    if (!state.dispatch({ kind: 'replaceDocument', document: nextDocument })) return null;
    const session = pageSessions.get(state.selectedPageId);
    if (session) session.selectedNodeId = nodeId;
    set({
      selectedNodeId: nodeId,
      inspectorTab: 'props',
      notice: {
        kind: 'status',
        message: `Moved ${propName} to props.${prop.name}`,
      },
    });
    return prop.name;
  },

  removeSelectedNode: () => {
    const state = get();
    if (state.selectedNodeId === state.document.rootNodeId) return;
    const removedName = state.document.nodes[state.selectedNodeId]?.name ?? 'component';
    const parentId = deriveParentIndex(state.document).get(state.selectedNodeId)?.parentId;
    if (state.dispatch({ kind: 'removeSubtree', nodeId: state.selectedNodeId })) {
      const selectedNodeId = parentId ?? get().document.rootNodeId;
      const session = pageSessions.get(state.selectedPageId);
      if (session) session.selectedNodeId = selectedNodeId;
      set({
        selectedNodeId,
        notice: { kind: 'status', message: `Deleted ${removedName}` },
      });
    }
  },

  setPropExpression: (nodeId, propName, value) =>
    get().dispatch({ kind: 'setProp', nodeId, propName, value }),

  addInstanceProp: (nodeId, propName, spec, value = null) =>
    get().dispatch({ kind: 'addInstanceProp', nodeId, propName, spec, value }),

  updateInstanceProp: (nodeId, propName, nextPropName, spec, value) => {
    const node = get().document.nodes[nodeId];
    const nextValue =
      value === undefined && node?.kind === 'element'
        ? (node.props[propName] ?? null)
        : (value ?? null);
    get().dispatch({
      kind: 'updateInstanceProp',
      nodeId,
      propName,
      nextPropName,
      spec,
      value: nextValue,
    });
  },

  removeInstanceProp: (nodeId, propName) =>
    get().dispatch({ kind: 'removeInstanceProp', nodeId, propName }),

  setLiteralProp: (nodeId, propName, value) =>
    get().setPropExpression(nodeId, propName, literal(value)),

  bindProp: (nodeId, propName, symbolId, path = []) =>
    get().setPropExpression(
      nodeId,
      propName,
      symbolId ? { kind: 'reference', symbolId, path: [...path] } : null,
    ),

  bindEvent: (nodeId, eventName, symbolId) =>
    get().setEventBinding(nodeId, eventName, symbolId, null),

  setEventBinding: (nodeId, eventName, symbolId, argument) =>
    get().dispatch({
      kind: 'setEventBinding',
      nodeId,
      eventName,
      handler: symbolId ? { kind: 'reference', symbolId, path: [] } : null,
      argument: symbolId ? argument : null,
    }),

  addInstanceEvent: (nodeId, eventName, spec) =>
    get().dispatch({ kind: 'addInstanceEvent', nodeId, eventName, spec }),

  updateInstanceEvent: (nodeId, eventName, nextEventName, spec) =>
    get().dispatch({
      kind: 'updateInstanceEvent',
      nodeId,
      eventName,
      nextEventName,
      spec,
    }),

  removeInstanceEvent: (nodeId, eventName) =>
    get().dispatch({ kind: 'removeInstanceEvent', nodeId, eventName }),

  setStyle: (nodeId, property, value) => {
    const state = get();
    if (nodeId === state.document.rootNodeId && (property === 'width' || property === 'height')) {
      state.showStatus('The Page root is locked to 100% width and height');
      return;
    }
    state.dispatch({ kind: 'setStyleProperty', nodeId, property, value });
  },

  setVisibility: (nodeId, value) => get().dispatch({ kind: 'setVisibility', nodeId, value }),

  setIfCondition: (nodeId, value) => get().dispatch({ kind: 'setIfCondition', nodeId, value }),

  setRepeatSource: (nodeId, value) => get().dispatch({ kind: 'setRepeatSource', nodeId, value }),

  setClassRefs: (nodeId, classRefs) => get().dispatch({ kind: 'setClassRefs', nodeId, classRefs }),

  addPublicProp: (rawName, valueType) => {
    const cleanedName = rawName.trim().replace(/[^A-Za-z0-9_$]/g, '_');
    if (!cleanedName) {
      get().reportError('Could not add public prop', 'Prop name is required');
      return;
    }
    const name = /^[A-Za-z_$]/.test(cleanedName) ? cleanedName : `_${cleanedName}`;
    const prop: PublicProp = {
      symbolId: `prop_${nanoid(8)}`,
      name,
      displayName: rawName.trim(),
      valueType,
      required: false,
      ...(valueType === 'event' ? { eventSignature: { payload: null } } : {}),
      ...(valueType === 'object'
        ? {
            valueShape: {
              kind: 'object' as const,
              fields: {},
              additionalProperties: true,
            },
          }
        : valueType === 'array'
          ? { valueShape: { kind: 'array' as const, item: { kind: 'unknown' as const } } }
          : {}),
      ...(valueType === 'string' || valueType === 'color'
        ? { defaultValue: '' }
        : valueType === 'number'
          ? { defaultValue: 0 }
          : valueType === 'boolean'
            ? { defaultValue: false }
            : valueType === 'object'
              ? { defaultValue: {} }
              : valueType === 'array'
                ? { defaultValue: [] }
                : {}),
    };
    get().dispatch({ kind: 'addPublicProp', prop });
  },

  setPublicPropShape: (propName, valueShape) =>
    get().dispatch({ kind: 'setPublicPropShape', propName, valueShape }),

  setPublicPropDefaultValue: (propName, value) =>
    get().dispatch({ kind: 'setPublicPropDefaultValue', propName, value }),

  setPublicPropType: (propName, valueType) =>
    get().dispatch({ kind: 'setPublicPropType', propName, valueType }),

  setPublicPropEventSignature: (propName, eventSignature) =>
    get().dispatch({ kind: 'setPublicPropEventSignature', propName, eventSignature }),

  removePublicProp: (propName) => get().dispatch({ kind: 'removePublicProp', propName }),

  undo: () => {
    const state = get();
    const session = pageSessions.get(state.selectedPageId);
    if (!session) return;
    const document = session.history.undo();
    const selectedNodeId = document.nodes[state.selectedNodeId]
      ? state.selectedNodeId
      : document.rootNodeId;
    session.selectedNodeId = selectedNodeId;
    set((current) => ({
      document: syncDocument(document),
      pages: replacePageDocument(current.pages, state.selectedPageId, document),
      selectedNodeId,
      notice: null,
    }));
  },
  redo: () => {
    const state = get();
    const session = pageSessions.get(state.selectedPageId);
    if (!session) return;
    const document = session.history.redo();
    const selectedNodeId = document.nodes[state.selectedNodeId]
      ? state.selectedNodeId
      : document.rootNodeId;
    session.selectedNodeId = selectedNodeId;
    set((current) => ({
      document: syncDocument(document),
      pages: replacePageDocument(current.pages, state.selectedPageId, document),
      selectedNodeId,
      notice: null,
    }));
  },

  loadDocument: (value) => {
    const result = validateUiDocument(value);
    if (!result.valid || !result.value) {
      set({ notice: errorNotice('The selected file is not a valid Srijika document') });
      return false;
    }
    try {
      if (result.value.kind !== 'page') throw new Error('Only page documents can be imported here');
      const state = get();
      const document = structuredClone(result.value);
      document.id = state.selectedPageId;
      assertValidDocumentGraph(document);
      assertDocumentSemantics(document, componentRegistry);
      const history = new DocumentHistory(document, historyOptions);
      const session: PageSession = {
        history,
        selectedNodeId: history.document.rootNodeId,
        activeIfBranches: {},
      };
      pageSessions.set(state.selectedPageId, session);
      set((current) => ({
        pages: replacePageDocument(current.pages, state.selectedPageId, history.document),
        document: syncDocument(history.document),
        selectedNodeId: history.document.rootNodeId,
        panel: 'canvas',
        activeIfBranches: {},
        activeDrag: null,
        dragPointer: null,
        dropTargetNodeId: null,
        dropIntent: 'inside',
        notice: null,
      }));
      return true;
    } catch (error) {
      set({ notice: errorNotice('The selected file is not a valid Srijika document', error) });
      return false;
    }
  },

  resetDocument: () => {
    const state = get();
    const page = state.pages.find((candidate) => candidate.id === state.selectedPageId);
    if (!page) return;
    const history = new DocumentHistory(
      createStarterDocument(state.selectedPageId, page.name),
      historyOptions,
    );
    const session: PageSession = {
      history,
      selectedNodeId: history.document.rootNodeId,
      activeIfBranches: {},
    };
    pageSessions.set(state.selectedPageId, session);
    set((current) => ({
      pages: replacePageDocument(current.pages, state.selectedPageId, history.document),
      document: syncDocument(history.document),
      selectedNodeId: history.document.rootNodeId,
      panel: 'canvas',
      activeIfBranches: {},
      activeDrag: null,
      dragPointer: null,
      dropTargetNodeId: null,
      dropIntent: 'inside',
      notice: null,
    }));
  },
}));

export function defaultSymbolValues(document: UiDocument): Record<string, unknown> {
  return Object.fromEntries(
    Object.values(document.symbols)
      .filter((symbol) => symbol.defaultValue !== undefined)
      .map((symbol) => [symbol.id, symbol.defaultValue]),
  );
}

export function booleanVisibility(value: boolean): ValueExpression {
  return literal(value);
}
