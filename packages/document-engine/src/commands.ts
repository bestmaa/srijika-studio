import type {
  ElementNode,
  PublicProp,
  RepeatNode,
  StyleProperties,
  SymbolDeclaration,
  UiDocument,
  UiNode,
  ValueExpression,
} from '@sutra/contracts';

import {
  assertValidDocumentGraph,
  collectSubtreeIds,
  deriveParentIndex,
  isDescendant,
  mutableChildList,
} from './graph';

export type CommandOrigin = 'user' | 'ai' | 'migration';

export type DocumentCommand =
  | {
      kind: 'insertNode';
      parentId: string;
      slot: string;
      index: number;
      node: UiNode;
    }
  | {
      kind: 'insertRepeat';
      parentId: string;
      slot: string;
      index: number;
      node: RepeatNode;
      itemSymbol: SymbolDeclaration;
      indexSymbol: SymbolDeclaration;
    }
  | {
      kind: 'moveNode';
      nodeId: string;
      parentId: string;
      slot: string;
      index: number;
    }
  | { kind: 'removeSubtree'; nodeId: string }
  | {
      kind: 'setProp';
      nodeId: string;
      propName: string;
      value: ValueExpression | null;
    }
  | {
      kind: 'setEvent';
      nodeId: string;
      eventName: string;
      value: ValueExpression | null;
    }
  | {
      kind: 'setStyleProperty';
      nodeId: string;
      property: keyof StyleProperties;
      value: StyleProperties[keyof StyleProperties] | null;
    }
  | { kind: 'renameNode'; nodeId: string; name: string }
  | { kind: 'setVisibility'; nodeId: string; value: ValueExpression }
  | { kind: 'setIfCondition'; nodeId: string; value: ValueExpression }
  | { kind: 'setRepeatSource'; nodeId: string; value: ValueExpression }
  | { kind: 'setClassRefs'; nodeId: string; classRefs: string[] }
  | { kind: 'addPublicProp'; prop: PublicProp }
  | { kind: 'removePublicProp'; propName: string }
  | { kind: 'replaceDocument'; document: UiDocument };

export interface CommandEnvelope {
  commandVersion: 1;
  commandId: string;
  documentId: string;
  baseRevision: number;
  origin: CommandOrigin;
  command: DocumentCommand;
}

export interface CommandResult {
  document: UiDocument;
  inverse: DocumentCommand;
}

function cloneDocument(document: UiDocument): UiDocument {
  return structuredClone(document);
}

function requireNode(document: UiDocument, nodeId: string): UiNode {
  const node = document.nodes[nodeId];
  if (!node) throw new Error(`Node ${nodeId} does not exist`);
  return node;
}

function requireElement(document: UiDocument, nodeId: string): ElementNode {
  const node = requireNode(document, nodeId);
  if (node.kind !== 'element') throw new Error(`Node ${nodeId} is not an element`);
  return node;
}

function normalizeIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) throw new Error('Insertion index must be an integer');
  return Math.max(0, Math.min(index, length));
}

function expressionReferencesSymbol(expression: ValueExpression, symbolId: string): boolean {
  switch (expression.kind) {
    case 'literal':
      return false;
    case 'reference':
      return expression.symbolId === symbolId;
    case 'unary':
      return expressionReferencesSymbol(expression.operand, symbolId);
    case 'binary':
      return (
        expressionReferencesSymbol(expression.left, symbolId) ||
        expressionReferencesSymbol(expression.right, symbolId)
      );
    case 'conditional':
      return (
        expressionReferencesSymbol(expression.condition, symbolId) ||
        expressionReferencesSymbol(expression.whenTrue, symbolId) ||
        expressionReferencesSymbol(expression.whenFalse, symbolId)
      );
    case 'template':
      return expression.parts.some(
        (part) => typeof part !== 'string' && expressionReferencesSymbol(part, symbolId),
      );
    case 'registeredCall':
    case 'customCodeReference':
      return expression.args.some((argument) => expressionReferencesSymbol(argument, symbolId));
  }
}

function documentReferencesSymbol(document: UiDocument, symbolId: string): boolean {
  return Object.values(document.nodes).some((node) => {
    switch (node.kind) {
      case 'element':
        return (
          Object.values(node.props).some((value) => expressionReferencesSymbol(value, symbolId)) ||
          Object.values(node.events).some((value) => expressionReferencesSymbol(value, symbolId)) ||
          expressionReferencesSymbol(node.visible, symbolId)
        );
      case 'text':
        return expressionReferencesSymbol(node.value, symbolId);
      case 'expression':
        return expressionReferencesSymbol(node.expression, symbolId);
      case 'if':
        return expressionReferencesSymbol(node.condition, symbolId);
      case 'repeat':
        return expressionReferencesSymbol(node.source, symbolId);
      case 'fragment':
      case 'slot':
        return false;
    }
  });
}

export function applyCommand(document: UiDocument, command: DocumentCommand): CommandResult {
  const before = cloneDocument(document);
  const draft = cloneDocument(document);

  switch (command.kind) {
    case 'insertNode': {
      if (draft.nodes[command.node.id]) {
        throw new Error(`Node ${command.node.id} already exists`);
      }
      const parent = requireNode(draft, command.parentId);
      const children = mutableChildList(parent, command.slot);
      children.splice(normalizeIndex(command.index, children.length), 0, command.node.id);
      draft.nodes[command.node.id] = structuredClone(command.node);
      break;
    }

    case 'insertRepeat': {
      if (draft.nodes[command.node.id]) {
        throw new Error(`Node ${command.node.id} already exists`);
      }
      if (command.node.itemSymbolId !== command.itemSymbol.id) {
        throw new Error('Repeat item symbol does not match its node');
      }
      if (command.node.indexSymbolId !== command.indexSymbol.id) {
        throw new Error('Repeat index symbol does not match its node');
      }
      if (draft.symbols[command.itemSymbol.id] || draft.symbols[command.indexSymbol.id]) {
        throw new Error('Repeat scope symbol already exists');
      }
      const parent = requireNode(draft, command.parentId);
      const children = mutableChildList(parent, command.slot);
      children.splice(normalizeIndex(command.index, children.length), 0, command.node.id);
      draft.nodes[command.node.id] = structuredClone(command.node);
      draft.symbols[command.itemSymbol.id] = structuredClone(command.itemSymbol);
      draft.symbols[command.indexSymbol.id] = structuredClone(command.indexSymbol);
      break;
    }

    case 'moveNode': {
      if (command.nodeId === draft.rootNodeId) throw new Error('Root node cannot be moved');
      requireNode(draft, command.nodeId);
      const current = deriveParentIndex(draft).get(command.nodeId);
      if (!current) throw new Error(`Node ${command.nodeId} has no parent`);
      if (
        command.parentId === command.nodeId ||
        isDescendant(draft, command.nodeId, command.parentId)
      ) {
        throw new Error('A node cannot be moved into itself or one of its descendants');
      }

      const currentParent = requireNode(draft, current.parentId);
      const currentChildren = mutableChildList(currentParent, current.slot);
      currentChildren.splice(current.index, 1);

      const targetParent = requireNode(draft, command.parentId);
      const targetChildren = mutableChildList(targetParent, command.slot);
      const adjustedIndex =
        current.parentId === command.parentId &&
        current.slot === command.slot &&
        current.index < command.index
          ? command.index - 1
          : command.index;
      targetChildren.splice(
        normalizeIndex(adjustedIndex, targetChildren.length),
        0,
        command.nodeId,
      );
      break;
    }

    case 'removeSubtree': {
      if (command.nodeId === draft.rootNodeId) throw new Error('Root node cannot be removed');
      requireNode(draft, command.nodeId);
      const location = deriveParentIndex(draft).get(command.nodeId);
      if (!location) throw new Error(`Node ${command.nodeId} has no parent`);
      const parent = requireNode(draft, location.parentId);
      mutableChildList(parent, location.slot).splice(location.index, 1);
      const removedIds = collectSubtreeIds(draft, command.nodeId);
      removedIds.forEach((nodeId) => {
        const removedNode = draft.nodes[nodeId];
        if (removedNode?.kind === 'repeat') {
          delete draft.symbols[removedNode.itemSymbolId];
          delete draft.symbols[removedNode.indexSymbolId];
        }
        delete draft.nodes[nodeId];
      });
      break;
    }

    case 'setProp': {
      const node = requireElement(draft, command.nodeId);
      if (command.value === null) delete node.props[command.propName];
      else node.props[command.propName] = structuredClone(command.value);
      break;
    }

    case 'setEvent': {
      const node = requireElement(draft, command.nodeId);
      if (command.value === null) delete node.events[command.eventName];
      else node.events[command.eventName] = structuredClone(command.value);
      break;
    }

    case 'setStyleProperty': {
      const node = requireElement(draft, command.nodeId);
      if (command.value === null) delete node.style.base[command.property];
      else Object.assign(node.style.base, { [command.property]: structuredClone(command.value) });
      break;
    }

    case 'renameNode': {
      if (!command.name.trim()) throw new Error('Node name cannot be empty');
      requireNode(draft, command.nodeId).name = command.name.trim();
      break;
    }

    case 'setVisibility': {
      requireElement(draft, command.nodeId).visible = structuredClone(command.value);
      break;
    }

    case 'setIfCondition': {
      const node = requireNode(draft, command.nodeId);
      if (node.kind !== 'if') throw new Error(`Node ${command.nodeId} is not a condition`);
      node.condition = structuredClone(command.value);
      break;
    }

    case 'setRepeatSource': {
      const node = requireNode(draft, command.nodeId);
      if (node.kind !== 'repeat') throw new Error(`Node ${command.nodeId} is not a repeater`);
      node.source = structuredClone(command.value);
      break;
    }

    case 'setClassRefs': {
      const node = requireElement(draft, command.nodeId);
      node.classRefs = [...new Set(command.classRefs.map((value) => value.trim()).filter(Boolean))];
      break;
    }

    case 'addPublicProp': {
      if (draft.publicProps[command.prop.name]) {
        throw new Error(`Public prop ${command.prop.name} already exists`);
      }
      if (draft.symbols[command.prop.symbolId]) {
        throw new Error(`Symbol ${command.prop.symbolId} already exists`);
      }
      draft.publicProps[command.prop.name] = structuredClone(command.prop);
      draft.symbols[command.prop.symbolId] = {
        id: command.prop.symbolId,
        name: command.prop.name,
        displayName: command.prop.displayName,
        provider: command.prop.valueType === 'event' ? 'event' : 'prop',
        valueType: command.prop.valueType,
        required: command.prop.required,
        ...(command.prop.defaultValue !== undefined
          ? { defaultValue: command.prop.defaultValue }
          : {}),
      };
      break;
    }

    case 'removePublicProp': {
      const prop = draft.publicProps[command.propName];
      if (!prop) throw new Error(`Public prop ${command.propName} does not exist`);
      if (documentReferencesSymbol(draft, prop.symbolId)) {
        throw new Error(`Public prop ${command.propName} is still referenced by the document`);
      }
      delete draft.publicProps[command.propName];
      delete draft.symbols[prop.symbolId];
      break;
    }

    case 'replaceDocument':
      assertValidDocumentGraph(command.document);
      return {
        document: cloneDocument(command.document),
        inverse: { kind: 'replaceDocument', document: before },
      };
  }

  draft.revision += 1;
  assertValidDocumentGraph(draft);

  return {
    document: draft,
    inverse: { kind: 'replaceDocument', document: before },
  };
}

export function dispatchCommand(document: UiDocument, envelope: CommandEnvelope): CommandResult {
  if (envelope.documentId !== document.id) {
    throw new Error(`Command targets ${envelope.documentId}, current document is ${document.id}`);
  }
  if (envelope.baseRevision !== document.revision) {
    throw new Error(
      `Stale command revision ${envelope.baseRevision}; current revision is ${document.revision}`,
    );
  }
  return applyCommand(document, envelope.command);
}
