import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { assertDocumentSemantics } from '@sutra/component-registry';
import {
  literal,
  validateUiDocument,
  type PublicProp,
  type StyleProperties,
  type UiDocument,
  type UiNode,
  type ValueExpression,
  type ValueType,
} from '@sutra/contracts';
import {
  DocumentHistory,
  deriveParentIndex,
  isDescendant,
  type DocumentCommand,
} from '@sutra/document-engine';

import { componentRegistry } from '../lib/registry';
import { createStarterDocument } from '../lib/starter';

export type StudioPanel = 'canvas' | 'json' | 'tsx';
export type InspectorTab = 'design' | 'props' | 'events';
export type ViewportPreset = 'desktop' | 'tablet' | 'mobile';
export interface StudioNotice {
  kind: 'status' | 'error';
  message: string;
}

interface StudioState {
  document: UiDocument;
  selectedNodeId: string;
  dropTargetNodeId: string | null;
  panel: StudioPanel;
  inspectorTab: InspectorTab;
  viewport: ViewportPreset;
  activeIfBranches: Readonly<Record<string, 'whenTrue' | 'whenFalse'>>;
  notice: StudioNotice | null;
  dispatch: (command: DocumentCommand) => boolean;
  showStatus: (message: string) => void;
  reportError: (context: string, cause?: unknown) => void;
  clearNotice: () => void;
  selectNode: (nodeId: string) => void;
  setDropTarget: (nodeId: string | null) => void;
  setPanel: (panel: StudioPanel) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setViewport: (viewport: ViewportPreset) => void;
  setActiveIfBranch: (nodeId: string, branch: 'whenTrue' | 'whenFalse') => void;
  addComponent: (componentId: string, parentId?: string) => string | null;
  addIfNode: (parentId?: string) => string | null;
  addRepeatNode: (parentId?: string) => string | null;
  moveNode: (nodeId: string, parentId: string) => void;
  removeSelectedNode: () => void;
  setLiteralProp: (nodeId: string, propName: string, value: string | number | boolean) => void;
  bindProp: (nodeId: string, propName: string, symbolId: string | null) => void;
  bindEvent: (nodeId: string, eventName: string, symbolId: string | null) => void;
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
let history = new DocumentHistory(createStarterDocument(), historyOptions);

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

export const useStudioStore = create<StudioState>((set, get) => ({
  document: history.document,
  selectedNodeId: history.document.rootNodeId,
  dropTargetNodeId: null,
  panel: 'canvas',
  inspectorTab: 'design',
  viewport: 'desktop',
  activeIfBranches: {},
  notice: null,

  dispatch: (command) => {
    try {
      const document = history.dispatchEnvelope({
        commandVersion: 1,
        commandId: `command_${nanoid(10)}`,
        documentId: history.document.id,
        baseRevision: history.document.revision,
        origin: 'user',
        command,
      });
      set({ document: syncDocument(document), notice: null });
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
    if (get().document.nodes[nodeId]) set({ selectedNodeId: nodeId });
  },
  setDropTarget: (nodeId) => set({ dropTargetNodeId: nodeId }),
  setPanel: (panel) => set({ panel }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setViewport: (viewport) => set({ viewport }),
  setActiveIfBranch: (nodeId, branch) =>
    set((state) => ({
      activeIfBranches: { ...state.activeIfBranches, [nodeId]: branch },
    })),

  addComponent: (componentId, requestedParentId) => {
    const state = get();
    const { parentId, slot } = insertionLocation(
      state.document,
      state.selectedNodeId,
      state.activeIfBranches,
      requestedParentId,
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
    const id = `${componentId.replace('sutra.', '')}_${nanoid(7)}`;
    const node = component.createNode(id);
    const children =
      parent.kind === 'element'
        ? parent.slots[slot]
        : parent.kind === 'if'
          ? parent[slot as 'whenTrue' | 'whenFalse']
          : parent.kind === 'repeat' || parent.kind === 'fragment'
            ? parent.children
            : parent.kind === 'slot'
              ? parent.fallback
              : undefined;
    if (!state.dispatch({ kind: 'insertNode', parentId, slot, index: children?.length ?? 0, node }))
      return null;
    set({ selectedNodeId: id, panel: 'canvas' });
    return id;
  },

  addIfNode: (requestedParentId) => {
    const state = get();
    const { parentId, slot } = insertionLocation(
      state.document,
      state.selectedNodeId,
      state.activeIfBranches,
      requestedParentId,
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
        index: childSlot(parent, state.activeIfBranches) ? 1000000 : 0,
        node,
      })
    )
      return null;
    set((current) => ({
      selectedNodeId: id,
      activeIfBranches: { ...current.activeIfBranches, [id]: 'whenTrue' },
    }));
    return id;
  },

  addRepeatNode: (requestedParentId) => {
    const state = get();
    const { parentId, slot } = insertionLocation(
      state.document,
      state.selectedNodeId,
      state.activeIfBranches,
      requestedParentId,
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
        index: 1000000,
        node,
        itemSymbol,
        indexSymbol,
      })
    )
      return null;
    set({ selectedNodeId: id });
    return id;
  },

  moveNode: (nodeId, parentId) => {
    const state = get();
    if (
      nodeId === state.document.rootNodeId ||
      nodeId === parentId ||
      isDescendant(state.document, nodeId, parentId)
    )
      return;
    const parent = state.document.nodes[parentId];
    if (!parent) return;
    const slot = childSlot(parent, state.activeIfBranches);
    if (!slot) return;
    if (
      state.dispatch({
        kind: 'moveNode',
        nodeId,
        parentId,
        slot,
        index: 1000000,
      })
    )
      set({ selectedNodeId: nodeId });
  },

  removeSelectedNode: () => {
    const state = get();
    if (state.selectedNodeId === state.document.rootNodeId) return;
    const parentId = deriveParentIndex(state.document).get(state.selectedNodeId)?.parentId;
    if (state.dispatch({ kind: 'removeSubtree', nodeId: state.selectedNodeId }))
      set({ selectedNodeId: parentId ?? get().document.rootNodeId });
  },

  setLiteralProp: (nodeId, propName, value) =>
    get().dispatch({ kind: 'setProp', nodeId, propName, value: literal(value) }),

  bindProp: (nodeId, propName, symbolId) =>
    get().dispatch({
      kind: 'setProp',
      nodeId,
      propName,
      value: symbolId ? { kind: 'reference', symbolId, path: [] } : null,
    }),

  bindEvent: (nodeId, eventName, symbolId) =>
    get().dispatch({
      kind: 'setEvent',
      nodeId,
      eventName,
      value: symbolId ? { kind: 'reference', symbolId, path: [] } : null,
    }),

  setStyle: (nodeId, property, value) =>
    get().dispatch({ kind: 'setStyleProperty', nodeId, property, value }),

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
      ...(valueType === 'string' || valueType === 'color'
        ? { defaultValue: '' }
        : valueType === 'number'
          ? { defaultValue: 0 }
          : valueType === 'boolean'
            ? { defaultValue: false }
            : {}),
    };
    get().dispatch({ kind: 'addPublicProp', prop });
  },

  undo: () => set({ document: syncDocument(history.undo()) }),
  redo: () => set({ document: syncDocument(history.redo()) }),

  loadDocument: (value) => {
    const result = validateUiDocument(value);
    if (!result.valid || !result.value) {
      set({ notice: errorNotice('The selected file is not a valid Sutra document') });
      return false;
    }
    try {
      assertDocumentSemantics(result.value, componentRegistry);
      const nextHistory = new DocumentHistory(result.value, historyOptions);
      history = nextHistory;
      set({
        document: syncDocument(history.document),
        selectedNodeId: history.document.rootNodeId,
        panel: 'canvas',
        activeIfBranches: {},
        notice: null,
      });
      return true;
    } catch (error) {
      set({ notice: errorNotice('The selected file is not a valid Sutra document', error) });
      return false;
    }
  },

  resetDocument: () => {
    history = new DocumentHistory(createStarterDocument(), historyOptions);
    set({
      document: syncDocument(history.document),
      selectedNodeId: history.document.rootNodeId,
      panel: 'canvas',
      activeIfBranches: {},
      notice: null,
    });
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
