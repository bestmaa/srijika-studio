import type {
  ElementNode,
  EventArgumentMapping,
  EventSignature,
  InstanceEventSpec,
  InstancePropSpec,
  LiteralValue,
  PublicProp,
  RepeatLiteralLocator,
  RepeatNode,
  StyleProperties,
  SymbolDeclaration,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueShape,
  ValueType,
} from '@srijika/contracts';
import {
  findRepeatedSiblingCandidates,
  instancePropNameError,
  isApprovedInstanceEventSpec,
} from '@srijika/contracts';

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
  | {
      kind: 'convertRepeatedSiblings';
      candidateId: string;
      repeatNodeId: string;
      propName: string;
      propSymbolId: string;
      itemSymbolId: string;
      indexSymbolId: string;
      repeatName?: string;
      propDisplayName?: string;
    }
  | { kind: 'removeSubtree'; nodeId: string }
  | {
      kind: 'setProp';
      nodeId: string;
      propName: string;
      value: ValueExpression | null;
    }
  | {
      kind: 'addInstanceProp';
      nodeId: string;
      propName: string;
      spec: InstancePropSpec;
      value: ValueExpression | null;
    }
  | {
      kind: 'updateInstanceProp';
      nodeId: string;
      propName: string;
      nextPropName: string;
      spec: InstancePropSpec;
      value: ValueExpression | null;
    }
  | { kind: 'removeInstanceProp'; nodeId: string; propName: string }
  | {
      kind: 'setEvent';
      nodeId: string;
      eventName: string;
      value: ValueExpression | null;
    }
  | {
      kind: 'setEventBinding';
      nodeId: string;
      eventName: string;
      handler: ValueExpression | null;
      argument: EventArgumentMapping | null;
    }
  | {
      kind: 'addInstanceEvent';
      nodeId: string;
      eventName: string;
      spec: InstanceEventSpec;
    }
  | {
      kind: 'updateInstanceEvent';
      nodeId: string;
      eventName: string;
      nextEventName: string;
      spec: InstanceEventSpec;
    }
  | { kind: 'removeInstanceEvent'; nodeId: string; eventName: string }
  | {
      kind: 'setStyleProperty';
      nodeId: string;
      property: keyof StyleProperties;
      value: StyleProperties[keyof StyleProperties] | null;
      breakpoint?: string;
    }
  | { kind: 'renameNode'; nodeId: string; name: string }
  | { kind: 'setVisibility'; nodeId: string; value: ValueExpression }
  | { kind: 'setIfCondition'; nodeId: string; value: ValueExpression }
  | { kind: 'setRepeatSource'; nodeId: string; value: ValueExpression }
  | { kind: 'setClassRefs'; nodeId: string; classRefs: string[] }
  | { kind: 'addPublicProp'; prop: PublicProp }
  | { kind: 'setPublicPropShape'; propName: string; valueShape: ValueShape | null }
  | {
      kind: 'setPublicPropEventSignature';
      propName: string;
      eventSignature: EventSignature;
    }
  | { kind: 'setPublicPropDefaultValue'; propName: string; value: LiteralValue }
  | { kind: 'setPublicPropType'; propName: string; valueType: ValueType }
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

function clearEventArgument(node: ElementNode, eventName: string): void {
  if (!node.eventArguments) return;
  delete node.eventArguments[eventName];
  if (Object.keys(node.eventArguments).length === 0) delete node.eventArguments;
}

function shapeMatchesInstanceProp(spec: InstancePropSpec): boolean {
  return (
    spec.valueShape === undefined || spec.type === 'unknown' || spec.valueShape.kind === spec.type
  );
}

function assertInstancePropSpec(propName: string, spec: InstancePropSpec): void {
  const nameError = instancePropNameError(propName);
  if (nameError) throw new Error(nameError);
  if (!shapeMatchesInstanceProp(spec)) {
    throw new Error(
      `Instance prop ${propName} has a ${spec.valueShape?.kind ?? 'missing'} shape but is declared as ${spec.type}`,
    );
  }
}

function assertInstanceEventSpec(eventName: string, spec: InstanceEventSpec): void {
  if (!isApprovedInstanceEventSpec(eventName, spec)) {
    throw new Error(`Event ${eventName} is not an approved normalized instance event port`);
  }
}

function normalizeIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) throw new Error('Insertion index must be an integer');
  return Math.max(0, Math.min(index, length));
}

function requireAvailableId(document: UiDocument, id: string): void {
  if (document.nodes[id] || document.symbols[id]) {
    throw new Error(`ID ${id} already exists`);
  }
}

function itemNameForProp(propName: string): string {
  if (propName.endsWith('ies') && propName.length > 3) return `${propName.slice(0, -3)}y`;
  if (propName.endsWith('s') && propName.length > 1) return propName.slice(0, -1);
  return 'item';
}

function nodeAtRelativePath(
  document: UiDocument,
  rootNodeId: string,
  locator: RepeatLiteralLocator,
): UiNode {
  let node = requireNode(document, rootNodeId);
  for (const step of locator.nodePath) {
    const childId = mutableChildList(node, step.slot)[step.index];
    if (!childId) throw new Error('Repeat candidate template path is no longer valid');
    node = requireNode(document, childId);
  }
  return node;
}

function bindRepeatField(
  document: UiDocument,
  rootNodeId: string,
  locator: RepeatLiteralLocator,
  itemSymbolId: string,
  fieldName: string,
): void {
  const node = nodeAtRelativePath(document, rootNodeId, locator);
  const reference: ValueExpression = {
    kind: 'reference',
    symbolId: itemSymbolId,
    path: [fieldName],
  };
  switch (locator.target.kind) {
    case 'elementProp':
      if (node.kind !== 'element') throw new Error('Repeat field no longer targets an element');
      node.props[locator.target.name] = reference;
      return;
    case 'elementVisibility':
      if (node.kind !== 'element') throw new Error('Repeat field no longer targets an element');
      node.visible = reference;
      return;
    case 'eventArgument': {
      if (node.kind !== 'element') throw new Error('Repeat field no longer targets an element');
      const argument = node.eventArguments?.[locator.target.name];
      if (!argument || argument.kind !== 'expression') {
        throw new Error('Repeat field no longer targets an event argument expression');
      }
      argument.expression = reference;
      return;
    }
    case 'textValue':
      if (node.kind !== 'text') throw new Error('Repeat field no longer targets text');
      node.value = reference;
      return;
    case 'expressionValue':
      if (node.kind !== 'expression')
        throw new Error('Repeat field no longer targets an expression');
      node.expression = reference;
      return;
    case 'ifCondition':
      if (node.kind !== 'if') throw new Error('Repeat field no longer targets a condition');
      node.condition = reference;
      return;
    case 'repeatSource':
      if (node.kind !== 'repeat') throw new Error('Repeat field no longer targets a repeat source');
      node.source = reference;
      return;
  }
}

function expressionReferencesSymbol(
  expression: ValueExpression,
  symbolId: string,
  pathOnly = false,
): boolean {
  switch (expression.kind) {
    case 'literal':
      return false;
    case 'reference':
      return expression.symbolId === symbolId && (!pathOnly || expression.path.length > 0);
    case 'unary':
      return expressionReferencesSymbol(expression.operand, symbolId, pathOnly);
    case 'binary':
      return (
        expressionReferencesSymbol(expression.left, symbolId, pathOnly) ||
        expressionReferencesSymbol(expression.right, symbolId, pathOnly)
      );
    case 'conditional':
      return (
        expressionReferencesSymbol(expression.condition, symbolId, pathOnly) ||
        expressionReferencesSymbol(expression.whenTrue, symbolId, pathOnly) ||
        expressionReferencesSymbol(expression.whenFalse, symbolId, pathOnly)
      );
    case 'template':
      return expression.parts.some(
        (part) => typeof part !== 'string' && expressionReferencesSymbol(part, symbolId, pathOnly),
      );
    case 'customCodeReference':
      return expression.args.some((argument) =>
        expressionReferencesSymbol(argument, symbolId, pathOnly),
      );
  }
}

function documentReferencesSymbol(
  document: UiDocument,
  symbolId: string,
  pathOnly = false,
): boolean {
  return Object.values(document.nodes).some((node) => {
    switch (node.kind) {
      case 'element':
        return (
          Object.values(node.props).some((value) =>
            expressionReferencesSymbol(value, symbolId, pathOnly),
          ) ||
          Object.values(node.events).some((value) =>
            expressionReferencesSymbol(value, symbolId, pathOnly),
          ) ||
          Object.values(node.eventArguments ?? {}).some(
            (argument) =>
              argument.kind === 'expression' &&
              expressionReferencesSymbol(argument.expression, symbolId, pathOnly),
          ) ||
          expressionReferencesSymbol(node.visible, symbolId, pathOnly)
        );
      case 'text':
        return expressionReferencesSymbol(node.value, symbolId, pathOnly);
      case 'expression':
        return expressionReferencesSymbol(node.expression, symbolId, pathOnly);
      case 'if':
        return expressionReferencesSymbol(node.condition, symbolId, pathOnly);
      case 'repeat':
        return expressionReferencesSymbol(node.source, symbolId, pathOnly);
      case 'fragment':
      case 'slot':
        return false;
    }
  });
}

function defaultValueForType(valueType: ValueType): LiteralValue | undefined {
  switch (valueType) {
    case 'string':
    case 'color':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'unknown':
    case 'event':
      return undefined;
  }
}

function shapeForType(valueType: ValueType): ValueShape | undefined {
  if (valueType === 'object') {
    return { kind: 'object', fields: {}, additionalProperties: true };
  }
  if (valueType === 'array') return { kind: 'array', item: { kind: 'unknown' } };
  return undefined;
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

    case 'convertRepeatedSiblings': {
      const candidate = findRepeatedSiblingCandidates(draft, {
        minInstances: 2,
        maxCandidates: Number.MAX_SAFE_INTEGER,
      }).find((entry) => entry.candidateId === command.candidateId);
      if (!candidate) {
        throw new Error(`Repeat candidate ${command.candidateId} does not exist`);
      }
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(command.propName)) {
        throw new Error(`Public prop ${command.propName} is not a valid JavaScript identifier`);
      }
      if (draft.publicProps[command.propName]) {
        throw new Error(`Public prop ${command.propName} already exists`);
      }
      const generatedIds = [
        command.repeatNodeId,
        command.propSymbolId,
        command.itemSymbolId,
        command.indexSymbolId,
      ];
      if (new Set(generatedIds).size !== generatedIds.length) {
        throw new Error('Repeat conversion IDs must be distinct');
      }
      generatedIds.forEach((id) => requireAvailableId(draft, id));

      const itemShape: ValueShape = {
        kind: 'object',
        fields: Object.fromEntries(
          candidate.fields.map((field) => [
            field.name,
            { required: true, shape: structuredClone(field.shape) },
          ]),
        ),
        additionalProperties: false,
      };
      const rows = candidate.nodeIds.map((_nodeId, rowIndex) =>
        Object.fromEntries(
          candidate.fields.map((field) => [field.name, structuredClone(field.values[rowIndex])]),
        ),
      ) as unknown as LiteralValue;
      const itemName = itemNameForProp(command.propName);
      const prop: PublicProp = {
        name: command.propName,
        displayName: command.propDisplayName?.trim() || command.propName,
        symbolId: command.propSymbolId,
        valueType: 'array',
        valueShape: { kind: 'array', item: structuredClone(itemShape) },
        required: false,
        defaultValue: rows,
      };
      draft.publicProps[prop.name] = structuredClone(prop);
      draft.symbols[prop.symbolId] = {
        id: prop.symbolId,
        name: prop.name,
        displayName: prop.displayName,
        provider: 'prop',
        valueType: prop.valueType,
        valueShape: { kind: 'array', item: structuredClone(itemShape) },
        required: prop.required,
        defaultValue: structuredClone(rows),
      };
      draft.symbols[command.itemSymbolId] = {
        id: command.itemSymbolId,
        name: itemName,
        displayName: `${prop.displayName} item`,
        provider: 'repeatItem',
        valueType: 'object',
        valueShape: structuredClone(itemShape),
        required: true,
      };
      draft.symbols[command.indexSymbolId] = {
        id: command.indexSymbolId,
        name: `${itemName}Index`,
        displayName: `${prop.displayName} index`,
        provider: 'repeatIndex',
        valueType: 'number',
        required: true,
      };

      candidate.fields.forEach((field) => {
        bindRepeatField(
          draft,
          candidate.templateNodeId,
          field.locator,
          command.itemSymbolId,
          field.name,
        );
      });

      const parent = requireNode(draft, candidate.parentId);
      const siblings = mutableChildList(parent, candidate.slot);
      const currentIds = siblings.slice(
        candidate.startIndex,
        candidate.startIndex + candidate.instanceCount,
      );
      if (currentIds.some((id, index) => id !== candidate.nodeIds[index])) {
        throw new Error(`Repeat candidate ${command.candidateId} is stale`);
      }
      siblings.splice(candidate.startIndex, candidate.instanceCount, command.repeatNodeId);
      draft.nodes[command.repeatNodeId] = {
        kind: 'repeat',
        id: command.repeatNodeId,
        name: command.repeatName?.trim() || `${prop.displayName} Repeat`,
        source: { kind: 'reference', symbolId: prop.symbolId, path: [] },
        itemSymbolId: command.itemSymbolId,
        indexSymbolId: command.indexSymbolId,
        children: [candidate.templateNodeId],
      };

      for (const duplicateId of candidate.nodeIds.slice(1)) {
        for (const removedId of collectSubtreeIds(draft, duplicateId)) {
          const removed = draft.nodes[removedId];
          if (removed?.kind === 'repeat') {
            delete draft.symbols[removed.itemSymbolId];
            delete draft.symbols[removed.indexSymbolId];
          }
          delete draft.nodes[removedId];
        }
      }
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

    case 'addInstanceProp': {
      const node = requireElement(draft, command.nodeId);
      assertInstancePropSpec(command.propName, command.spec);
      if (node.instanceProps?.[command.propName]) {
        throw new Error(`Instance prop ${command.propName} already exists`);
      }
      node.instanceProps ??= {};
      node.instanceProps[command.propName] = structuredClone(command.spec);
      if (command.value === null) delete node.props[command.propName];
      else node.props[command.propName] = structuredClone(command.value);
      break;
    }

    case 'updateInstanceProp': {
      const node = requireElement(draft, command.nodeId);
      if (!node.instanceProps?.[command.propName]) {
        throw new Error(`Instance prop ${command.propName} does not exist`);
      }
      assertInstancePropSpec(command.nextPropName, command.spec);
      if (command.nextPropName !== command.propName && node.instanceProps[command.nextPropName]) {
        throw new Error(`Instance prop ${command.nextPropName} already exists`);
      }
      delete node.instanceProps[command.propName];
      delete node.props[command.propName];
      node.instanceProps[command.nextPropName] = structuredClone(command.spec);
      if (command.value !== null) {
        node.props[command.nextPropName] = structuredClone(command.value);
      }
      break;
    }

    case 'removeInstanceProp': {
      const node = requireElement(draft, command.nodeId);
      if (!node.instanceProps?.[command.propName]) {
        throw new Error(`Instance prop ${command.propName} does not exist`);
      }
      delete node.instanceProps[command.propName];
      delete node.props[command.propName];
      if (Object.keys(node.instanceProps).length === 0) delete node.instanceProps;
      break;
    }

    case 'setEvent': {
      const node = requireElement(draft, command.nodeId);
      if (command.value === null) delete node.events[command.eventName];
      else node.events[command.eventName] = structuredClone(command.value);
      // The legacy command only knows about the handler. Clearing any prior
      // argument prevents a handler replacement from retaining a stale map.
      clearEventArgument(node, command.eventName);
      break;
    }

    case 'setEventBinding': {
      const node = requireElement(draft, command.nodeId);
      if (command.handler === null) {
        if (command.argument !== null) {
          throw new Error('An event argument cannot be set without an event handler');
        }
        delete node.events[command.eventName];
        clearEventArgument(node, command.eventName);
        break;
      }

      node.events[command.eventName] = structuredClone(command.handler);
      if (command.argument === null) {
        clearEventArgument(node, command.eventName);
      } else {
        node.eventArguments ??= {};
        node.eventArguments[command.eventName] = structuredClone(command.argument);
      }
      break;
    }

    case 'addInstanceEvent': {
      const node = requireElement(draft, command.nodeId);
      assertInstanceEventSpec(command.eventName, command.spec);
      if (node.instanceEvents?.[command.eventName]) {
        throw new Error(`Instance event ${command.eventName} already exists`);
      }
      node.instanceEvents ??= {};
      node.instanceEvents[command.eventName] = structuredClone(command.spec);
      break;
    }

    case 'updateInstanceEvent': {
      const node = requireElement(draft, command.nodeId);
      if (!node.instanceEvents?.[command.eventName]) {
        throw new Error(`Instance event ${command.eventName} does not exist`);
      }
      assertInstanceEventSpec(command.nextEventName, command.spec);
      if (
        command.nextEventName !== command.eventName &&
        node.instanceEvents[command.nextEventName]
      ) {
        throw new Error(`Instance event ${command.nextEventName} already exists`);
      }

      const binding = node.events[command.eventName];
      const argument = node.eventArguments?.[command.eventName];
      delete node.instanceEvents[command.eventName];
      delete node.events[command.eventName];
      clearEventArgument(node, command.eventName);
      node.instanceEvents[command.nextEventName] = structuredClone(command.spec);
      if (binding) node.events[command.nextEventName] = binding;
      if (argument) {
        node.eventArguments ??= {};
        node.eventArguments[command.nextEventName] = argument;
      }
      break;
    }

    case 'removeInstanceEvent': {
      const node = requireElement(draft, command.nodeId);
      if (!node.instanceEvents?.[command.eventName]) {
        throw new Error(`Instance event ${command.eventName} does not exist`);
      }
      delete node.instanceEvents[command.eventName];
      delete node.events[command.eventName];
      clearEventArgument(node, command.eventName);
      if (Object.keys(node.instanceEvents).length === 0) delete node.instanceEvents;
      break;
    }

    case 'setStyleProperty': {
      const node = requireElement(draft, command.nodeId);
      const breakpoint = command.breakpoint?.trim();
      if (!breakpoint) {
        if (command.value === null) delete node.style.base[command.property];
        else Object.assign(node.style.base, { [command.property]: structuredClone(command.value) });
        break;
      }
      node.style.breakpoints ??= {};
      const breakpointStyle = (node.style.breakpoints[breakpoint] ??= {});
      if (command.value === null) {
        delete breakpointStyle[command.property];
        if (Object.keys(breakpointStyle).length === 0) delete node.style.breakpoints[breakpoint];
        if (Object.keys(node.style.breakpoints).length === 0) delete node.style.breakpoints;
      } else {
        Object.assign(breakpointStyle, { [command.property]: structuredClone(command.value) });
      }
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
        ...(command.prop.valueShape !== undefined
          ? { valueShape: structuredClone(command.prop.valueShape) }
          : {}),
        ...(command.prop.eventSignature !== undefined
          ? { eventSignature: structuredClone(command.prop.eventSignature) }
          : {}),
        required: command.prop.required,
        ...(command.prop.defaultValue !== undefined
          ? { defaultValue: command.prop.defaultValue }
          : {}),
      };
      break;
    }

    case 'setPublicPropShape': {
      const prop = draft.publicProps[command.propName];
      if (!prop) throw new Error(`Public prop ${command.propName} does not exist`);
      const symbol = draft.symbols[prop.symbolId];
      if (!symbol) {
        throw new Error(`Public prop ${command.propName} has no mirrored symbol ${prop.symbolId}`);
      }
      if (prop.valueType === 'event') {
        throw new Error(`Event prop ${command.propName} cannot define a value shape`);
      }
      if (command.valueShape === null) {
        delete prop.valueShape;
        delete symbol.valueShape;
      } else {
        prop.valueShape = structuredClone(command.valueShape);
        symbol.valueShape = structuredClone(command.valueShape);
      }
      break;
    }

    case 'setPublicPropEventSignature': {
      const prop = draft.publicProps[command.propName];
      if (!prop) throw new Error(`Public prop ${command.propName} does not exist`);
      if (prop.valueType !== 'event') {
        throw new Error(`Public prop ${command.propName} is not an event prop`);
      }
      const symbol = draft.symbols[prop.symbolId];
      if (!symbol) {
        throw new Error(`Public prop ${command.propName} has no mirrored symbol ${prop.symbolId}`);
      }
      if (symbol.valueType !== 'event' || symbol.provider !== 'event') {
        throw new Error(`Public prop ${command.propName} has an invalid mirrored event symbol`);
      }
      prop.eventSignature = structuredClone(command.eventSignature);
      symbol.eventSignature = structuredClone(command.eventSignature);
      break;
    }

    case 'setPublicPropDefaultValue': {
      const prop = draft.publicProps[command.propName];
      if (!prop) throw new Error(`Public prop ${command.propName} does not exist`);
      const symbol = draft.symbols[prop.symbolId];
      if (!symbol) {
        throw new Error(`Public prop ${command.propName} has no mirrored symbol ${prop.symbolId}`);
      }
      if (prop.valueType === 'event') {
        throw new Error(`Event prop ${command.propName} cannot define a default value`);
      }
      prop.defaultValue = structuredClone(command.value);
      symbol.defaultValue = structuredClone(command.value);
      break;
    }

    case 'setPublicPropType': {
      const prop = draft.publicProps[command.propName];
      if (!prop) throw new Error(`Public prop ${command.propName} does not exist`);
      const symbol = draft.symbols[prop.symbolId];
      if (!symbol) {
        throw new Error(`Public prop ${command.propName} has no mirrored symbol ${prop.symbolId}`);
      }
      if (prop.valueType === command.valueType) break;
      const crossesEventBoundary = (prop.valueType === 'event') !== (command.valueType === 'event');
      if (crossesEventBoundary && documentReferencesSymbol(draft, prop.symbolId)) {
        throw new Error(
          `Public prop ${command.propName} is still bound; remove its component binding before changing between data and event`,
        );
      }
      if (
        command.valueType !== 'object' &&
        command.valueType !== 'array' &&
        documentReferencesSymbol(draft, prop.symbolId, true)
      ) {
        throw new Error(
          `Public prop ${command.propName} has nested references that are incompatible with ${command.valueType}`,
        );
      }

      prop.valueType = command.valueType;
      symbol.valueType = command.valueType;

      delete prop.valueShape;
      delete symbol.valueShape;
      delete prop.defaultValue;
      delete symbol.defaultValue;
      delete prop.eventSignature;
      delete symbol.eventSignature;

      if (command.valueType === 'event') {
        const eventSignature: EventSignature = { payload: null };
        symbol.provider = 'event';
        prop.eventSignature = structuredClone(eventSignature);
        symbol.eventSignature = structuredClone(eventSignature);
      } else {
        symbol.provider = 'prop';
        const valueShape = shapeForType(command.valueType);
        if (valueShape) {
          prop.valueShape = structuredClone(valueShape);
          symbol.valueShape = structuredClone(valueShape);
        }

        const defaultValue = defaultValueForType(command.valueType);
        if (defaultValue !== undefined) {
          prop.defaultValue = structuredClone(defaultValue);
          symbol.defaultValue = structuredClone(defaultValue);
        }
      }
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
