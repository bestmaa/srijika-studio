import type { ComponentRegistry } from '@srijika/component-registry';
import type {
  ElementNode,
  RepeatNode,
  StyleProperties,
  SymbolDeclaration,
  TextNode,
  UiDocument,
  UiNode,
} from '@srijika/contracts';
import { applyCommand, type DocumentCommand } from '@srijika/document-engine';

import { hasAutomationErrors, validateAutomationDocument } from './diagnostics';
import type { AutomationDiagnostic } from './diagnostics';
import type {
  ApplyOperationsFailure,
  ApplyOperationsResult,
  AutomationIdContext,
  AutomationIdFactory,
  AutomationNodeReference,
  InsertComponentOperation,
  InsertIfOperation,
  InsertRepeatOperation,
  InsertTextOperation,
  SrijikaOperation,
} from './types';
import { DOCUMENT_FORMAT_VERSION } from './version';

function failure(
  currentRevision: number,
  diagnostic: AutomationDiagnostic | AutomationDiagnostic[],
  failedOperationIndex?: number,
): ApplyOperationsFailure {
  return {
    ok: false,
    currentRevision,
    ...(failedOperationIndex === undefined ? {} : { failedOperationIndex }),
    createdIds: {},
    diagnostics: Array.isArray(diagnostic) ? diagnostic : [diagnostic],
  };
}

function operationKey(operation: SrijikaOperation, index: number): string {
  return operation.operationId ?? `operation_${index}`;
}

function requireGeneratedId(
  explicitId: string | undefined,
  context: AutomationIdContext,
  idFactory: AutomationIdFactory,
): string {
  const id = explicitId ?? idFactory(context);
  if (!id.trim()) throw new Error(`Generated ${context.kind} ID cannot be empty`);
  return id;
}

function resolveNodeReference(
  reference: AutomationNodeReference,
  createdIds: Readonly<Record<string, string>>,
): string {
  if (typeof reference === 'string') return reference;
  const resolved = createdIds[reference.createdBy];
  if (!resolved) {
    throw new Error(
      `Operation reference ${reference.createdBy} has not created a node earlier in this batch`,
    );
  }
  return resolved;
}

function insertLocation(
  operation: {
    parentId: AutomationNodeReference;
    slot?: string;
    index?: number;
  },
  createdIds: Readonly<Record<string, string>>,
): Pick<Extract<DocumentCommand, { kind: 'insertNode' }>, 'parentId' | 'slot' | 'index'> {
  return {
    parentId: resolveNodeReference(operation.parentId, createdIds),
    slot: operation.slot ?? 'children',
    index: operation.index ?? Number.MAX_SAFE_INTEGER,
  };
}

function createComponentNode<TImplementation>(
  operation: InsertComponentOperation,
  id: string,
  registry: ComponentRegistry<TImplementation>,
): UiNode {
  const definition = registry.require(operation.componentId);
  const created = definition.createNode(id);
  if (created.id !== id) {
    throw new Error(`Component factory ${operation.componentId} returned an unexpected node ID`);
  }
  if (created.kind !== 'element' || created.componentId !== operation.componentId) {
    throw new Error(`Component factory ${operation.componentId} did not return its element node`);
  }
  const node: ElementNode = structuredClone(created);
  if (operation.name !== undefined) node.name = operation.name;
  if (operation.props !== undefined) {
    node.props = { ...node.props, ...structuredClone(operation.props) };
  }
  if (operation.style !== undefined) {
    node.style.base = { ...node.style.base, ...structuredClone(operation.style) };
  }
  if (operation.classRefs !== undefined) node.classRefs = [...operation.classRefs];
  return node;
}

function createTextNode(operation: InsertTextOperation, id: string): TextNode {
  return {
    kind: 'text',
    id,
    name: operation.name?.trim() || 'Text',
    value: structuredClone(operation.value),
  };
}

function createIfNode(operation: InsertIfOperation, id: string): UiNode {
  return {
    kind: 'if',
    id,
    name: operation.name?.trim() || 'Condition',
    condition: structuredClone(operation.condition),
    whenTrue: [],
    whenFalse: [],
  };
}

function createRepeat(
  operation: InsertRepeatOperation,
  operationIndex: number,
  id: string,
  idFactory: AutomationIdFactory,
): {
  node: RepeatNode;
  itemSymbol: SymbolDeclaration;
  indexSymbol: SymbolDeclaration;
  generated: Record<string, string>;
} {
  const itemSymbolId = requireGeneratedId(
    operation.item?.id,
    {
      kind: 'symbol',
      operationKind: operation.kind,
      operationIndex,
      hint: `${id}_item`,
    },
    idFactory,
  );
  const indexSymbolId = requireGeneratedId(
    operation.indexSymbol?.id,
    {
      kind: 'symbol',
      operationKind: operation.kind,
      operationIndex,
      hint: `${id}_index`,
    },
    idFactory,
  );
  const itemName = operation.item?.name?.trim() || 'item';
  const indexName = operation.indexSymbol?.name?.trim() || 'index';
  const itemSymbol: SymbolDeclaration = {
    id: itemSymbolId,
    name: itemName,
    displayName: operation.item?.displayName?.trim() || 'Item',
    provider: 'repeatItem',
    valueType: operation.item?.valueType ?? 'unknown',
    ...(operation.item?.valueShape === undefined
      ? {}
      : { valueShape: structuredClone(operation.item.valueShape) }),
    required: true,
  };
  const indexSymbol: SymbolDeclaration = {
    id: indexSymbolId,
    name: indexName,
    displayName: operation.indexSymbol?.displayName?.trim() || 'Index',
    provider: 'repeatIndex',
    valueType: 'number',
    required: true,
  };
  return {
    node: {
      kind: 'repeat',
      id,
      name: operation.name?.trim() || 'Repeat',
      source: structuredClone(operation.source),
      itemSymbolId,
      indexSymbolId,
      children: [],
    },
    itemSymbol,
    indexSymbol,
    generated: { itemSymbolId, indexSymbolId },
  };
}

function errorCode(error: unknown): AutomationDiagnostic['code'] {
  const message = error instanceof Error ? error.message : String(error);
  if (/Unknown component/.test(message)) return 'component-not-found';
  if (/Node .* does not exist|has no parent/.test(message)) return 'node-not-found';
  return 'operation-failed';
}

function applyEngineCommand(document: UiDocument, command: DocumentCommand): UiDocument {
  return applyCommand(document, command).document;
}

export function applyOperations<TImplementation>(
  document: UiDocument,
  expectedRevision: number,
  operations: readonly SrijikaOperation[],
  registry: ComponentRegistry<TImplementation>,
  idFactory: AutomationIdFactory,
): ApplyOperationsResult {
  if (expectedRevision !== document.revision) {
    return failure(document.revision, {
      code: 'revision-conflict',
      severity: 'error',
      message: `Expected revision ${expectedRevision}; current revision is ${document.revision}`,
    });
  }
  if (operations.length === 0) {
    return failure(document.revision, {
      code: 'empty-operation-batch',
      severity: 'error',
      message: 'An atomic operation batch must contain at least one operation',
    });
  }
  const formatVersion = Number(document.formatVersion);
  if (formatVersion !== DOCUMENT_FORMAT_VERSION) {
    return failure(document.revision, {
      code: 'document-format-version-mismatch',
      severity: 'error',
      path: 'formatVersion',
      message: `Document format ${formatVersion} is not supported; expected ${DOCUMENT_FORMAT_VERSION}`,
    });
  }
  if (
    operations.some((operation) => operation.kind === 'replaceDocument') &&
    operations.length > 1
  ) {
    return failure(document.revision, {
      code: 'invalid-operation',
      severity: 'error',
      message: 'replaceDocument must be the only operation in its atomic batch',
    });
  }

  const usedOperationIds = new Set<string>();
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (!operation) continue;
    const key = operationKey(operation, index);
    if (usedOperationIds.has(key)) {
      return failure(
        document.revision,
        {
          code: 'duplicate-operation-id',
          severity: 'error',
          message: `Operation ID ${key} appears more than once`,
          operationIndex: index,
          operationId: key,
        },
        index,
      );
    }
    usedOperationIds.add(key);
  }

  let working = document;
  const createdIds: Record<string, string> = {};

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (!operation) continue;
    const key = operationKey(operation, index);
    try {
      switch (operation.kind) {
        case 'insertComponent': {
          const id = requireGeneratedId(
            operation.id,
            {
              kind: 'node',
              operationKind: operation.kind,
              operationIndex: index,
              hint: operation.componentId,
            },
            idFactory,
          );
          working = applyEngineCommand(working, {
            kind: 'insertNode',
            ...insertLocation(operation, createdIds),
            node: createComponentNode(operation, id, registry),
          });
          createdIds[key] = id;
          break;
        }
        case 'insertText': {
          const id = requireGeneratedId(
            operation.id,
            { kind: 'node', operationKind: operation.kind, operationIndex: index, hint: 'text' },
            idFactory,
          );
          working = applyEngineCommand(working, {
            kind: 'insertNode',
            ...insertLocation(operation, createdIds),
            node: createTextNode(operation, id),
          });
          createdIds[key] = id;
          break;
        }
        case 'insertIf': {
          const id = requireGeneratedId(
            operation.id,
            { kind: 'node', operationKind: operation.kind, operationIndex: index, hint: 'if' },
            idFactory,
          );
          working = applyEngineCommand(working, {
            kind: 'insertNode',
            ...insertLocation(operation, createdIds),
            node: createIfNode(operation, id),
          });
          createdIds[key] = id;
          break;
        }
        case 'insertRepeat': {
          const id = requireGeneratedId(
            operation.id,
            { kind: 'node', operationKind: operation.kind, operationIndex: index, hint: 'repeat' },
            idFactory,
          );
          const repeat = createRepeat(operation, index, id, idFactory);
          working = applyEngineCommand(working, {
            kind: 'insertRepeat',
            ...insertLocation(operation, createdIds),
            node: repeat.node,
            itemSymbol: repeat.itemSymbol,
            indexSymbol: repeat.indexSymbol,
          });
          createdIds[key] = id;
          createdIds[`${key}.itemSymbol`] = repeat.generated['itemSymbolId'] ?? '';
          createdIds[`${key}.indexSymbol`] = repeat.generated['indexSymbolId'] ?? '';
          break;
        }
        case 'moveNode':
          working = applyEngineCommand(working, {
            kind: 'moveNode',
            nodeId: resolveNodeReference(operation.nodeId, createdIds),
            ...insertLocation(operation, createdIds),
          });
          break;
        case 'removeNode':
          working = applyEngineCommand(working, {
            kind: 'removeSubtree',
            nodeId: resolveNodeReference(operation.nodeId, createdIds),
          });
          break;
        case 'renameNode':
          working = applyEngineCommand(working, {
            kind: 'renameNode',
            nodeId: resolveNodeReference(operation.nodeId, createdIds),
            name: operation.name,
          });
          break;
        case 'setProp':
          working = applyEngineCommand(working, {
            kind: 'setProp',
            nodeId: resolveNodeReference(operation.nodeId, createdIds),
            propName: operation.propName,
            value: operation.value,
          });
          break;
        case 'setStyle': {
          const unset = new Set(operation.unset ?? []);
          for (const [property, value] of Object.entries(operation.style) as Array<
            [keyof StyleProperties, StyleProperties[keyof StyleProperties]]
          >) {
            if (value === undefined || unset.has(property)) continue;
            working = applyEngineCommand(working, {
              kind: 'setStyleProperty',
              nodeId: resolveNodeReference(operation.nodeId, createdIds),
              property,
              value,
              ...(operation.breakpoint === undefined ? {} : { breakpoint: operation.breakpoint }),
            });
          }
          for (const property of unset) {
            working = applyEngineCommand(working, {
              kind: 'setStyleProperty',
              nodeId: resolveNodeReference(operation.nodeId, createdIds),
              property,
              value: null,
              ...(operation.breakpoint === undefined ? {} : { breakpoint: operation.breakpoint }),
            });
          }
          break;
        }
        case 'setEventBinding':
          working = applyEngineCommand(working, {
            kind: 'setEventBinding',
            nodeId: resolveNodeReference(operation.nodeId, createdIds),
            eventName: operation.eventName,
            handler: operation.handler,
            argument: operation.argument,
          });
          break;
        case 'addPublicProp':
          working = applyEngineCommand(working, {
            kind: 'addPublicProp',
            prop: operation.prop,
          });
          break;
        case 'convertRepeatedSiblings': {
          const repeatNodeId = requireGeneratedId(
            operation.repeatNodeId,
            {
              kind: 'node',
              operationKind: operation.kind,
              operationIndex: index,
              hint: `${operation.propName}_repeat`,
            },
            idFactory,
          );
          const propSymbolId = requireGeneratedId(
            operation.propSymbolId,
            {
              kind: 'symbol',
              operationKind: operation.kind,
              operationIndex: index,
              hint: `prop_${operation.propName}`,
            },
            idFactory,
          );
          const itemSymbolId = requireGeneratedId(
            operation.itemSymbolId,
            {
              kind: 'symbol',
              operationKind: operation.kind,
              operationIndex: index,
              hint: `${repeatNodeId}_item`,
            },
            idFactory,
          );
          const indexSymbolId = requireGeneratedId(
            operation.indexSymbolId,
            {
              kind: 'symbol',
              operationKind: operation.kind,
              operationIndex: index,
              hint: `${repeatNodeId}_index`,
            },
            idFactory,
          );
          working = applyEngineCommand(working, {
            kind: 'convertRepeatedSiblings',
            candidateId: operation.candidateId,
            repeatNodeId,
            propName: operation.propName,
            propSymbolId,
            itemSymbolId,
            indexSymbolId,
            ...(operation.repeatName === undefined ? {} : { repeatName: operation.repeatName }),
            ...(operation.propDisplayName === undefined
              ? {}
              : { propDisplayName: operation.propDisplayName }),
          });
          createdIds[key] = repeatNodeId;
          createdIds[`${key}.propSymbol`] = propSymbolId;
          createdIds[`${key}.itemSymbol`] = itemSymbolId;
          createdIds[`${key}.indexSymbol`] = indexSymbolId;
          break;
        }
        case 'replaceDocument':
          if (operation.document.id !== document.id) {
            return failure(
              document.revision,
              {
                code: 'document-id-mismatch',
                severity: 'error',
                message: `Replacement document ${operation.document.id} does not match ${document.id}`,
                operationIndex: index,
                operationId: key,
              },
              index,
            );
          }
          working = applyEngineCommand(working, {
            kind: 'replaceDocument',
            document: operation.document,
          });
          break;
      }
    } catch (error) {
      return failure(
        document.revision,
        {
          code: errorCode(error),
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
          operationIndex: index,
          operationId: key,
        },
        index,
      );
    }
  }

  const finalDocument = structuredClone(working);
  finalDocument.revision = document.revision + 1;
  const diagnostics = validateAutomationDocument(finalDocument, registry);
  if (hasAutomationErrors(diagnostics)) {
    return failure(document.revision, [
      {
        code: diagnostics.some((diagnostic) => diagnostic.code.startsWith('graph:'))
          ? 'graph-validation-failed'
          : 'semantic-validation-failed',
        severity: 'error',
        message: 'The atomic batch produced an invalid Srijika document and was not committed',
      },
      ...diagnostics,
    ]);
  }

  return {
    ok: true,
    document: finalDocument,
    previousRevision: document.revision,
    revision: finalDocument.revision,
    appliedOperationCount: operations.length,
    createdIds,
    diagnostics,
  };
}
