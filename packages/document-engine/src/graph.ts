import { validateUiDocument, type UiDocument, type UiNode } from '@srijika/contracts';

export interface ChildLocation {
  parentId: string;
  slot: string;
  index: number;
}

export interface GraphDiagnostic {
  code:
    | 'schema'
    | 'missing-root'
    | 'missing-child'
    | 'duplicate-parent'
    | 'duplicate-child'
    | 'cycle'
    | 'orphan-event-argument'
    | 'unreachable-node';
  message: string;
  nodeId?: string;
}

export function childLists(node: UiNode): ReadonlyArray<readonly [string, readonly string[]]> {
  switch (node.kind) {
    case 'element':
      return Object.entries(node.slots);
    case 'fragment':
    case 'repeat':
      return [['children', node.children]];
    case 'if':
      return [
        ['whenTrue', node.whenTrue],
        ['whenFalse', node.whenFalse],
      ];
    case 'slot':
      return [['fallback', node.fallback]];
    case 'text':
    case 'expression':
      return [];
  }
}

export function mutableChildList(node: UiNode, slot: string): string[] {
  switch (node.kind) {
    case 'element': {
      const list = node.slots[slot];
      if (!list) {
        throw new Error(`Element ${node.id} has no slot named ${slot}`);
      }
      return list;
    }
    case 'fragment':
    case 'repeat':
      if (slot !== 'children') throw new Error(`${node.kind} ${node.id} only has children`);
      return node.children;
    case 'if':
      if (slot === 'whenTrue') return node.whenTrue;
      if (slot === 'whenFalse') return node.whenFalse;
      throw new Error(`If node ${node.id} only has whenTrue and whenFalse`);
    case 'slot':
      if (slot !== 'fallback') throw new Error(`Slot ${node.id} only has fallback`);
      return node.fallback;
    case 'text':
    case 'expression':
      throw new Error(`${node.kind} node ${node.id} cannot contain children`);
  }
}

export function deriveParentIndex(document: UiDocument): Map<string, ChildLocation> {
  const index = new Map<string, ChildLocation>();

  for (const node of Object.values(document.nodes)) {
    for (const [slot, children] of childLists(node)) {
      children.forEach((childId, childIndex) => {
        if (!index.has(childId)) {
          index.set(childId, { parentId: node.id, slot, index: childIndex });
        }
      });
    }
  }

  return index;
}

export function collectSubtreeIds(document: UiDocument, nodeId: string): string[] {
  const collected: string[] = [];
  const stack = [nodeId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    collected.push(currentId);

    const node = document.nodes[currentId];
    if (!node) continue;
    for (const [, children] of childLists(node)) {
      stack.push(...children);
    }
  }

  return collected;
}

export function isDescendant(document: UiDocument, ancestorId: string, nodeId: string): boolean {
  return collectSubtreeIds(document, ancestorId).includes(nodeId);
}

export function validateDocumentGraph(document: UiDocument): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  const schemaResult = validateUiDocument(document);
  if (!schemaResult.valid) {
    diagnostics.push(
      ...schemaResult.errors.map((error) => ({
        code: 'schema' as const,
        message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
      })),
    );
  }

  if (!document.nodes[document.rootNodeId]) {
    diagnostics.push({
      code: 'missing-root',
      message: `Root node ${document.rootNodeId} does not exist`,
      nodeId: document.rootNodeId,
    });
    return diagnostics;
  }

  const parentCounts = new Map<string, number>();
  for (const node of Object.values(document.nodes)) {
    if (node.kind === 'element') {
      for (const eventName of Object.keys(node.eventArguments ?? {})) {
        if (!Object.hasOwn(node.events, eventName)) {
          diagnostics.push({
            code: 'orphan-event-argument',
            message: `Element ${node.id} has an argument for unbound event ${eventName}`,
            nodeId: node.id,
          });
        }
      }
    }

    const localChildren = new Set<string>();
    for (const [, children] of childLists(node)) {
      for (const childId of children) {
        if (localChildren.has(childId)) {
          diagnostics.push({
            code: 'duplicate-child',
            message: `Node ${childId} occurs more than once under ${node.id}`,
            nodeId: childId,
          });
        }
        localChildren.add(childId);

        if (!document.nodes[childId]) {
          diagnostics.push({
            code: 'missing-child',
            message: `Node ${node.id} references missing child ${childId}`,
            nodeId: childId,
          });
        }
        parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1);
      }
    }
  }

  for (const [nodeId, count] of parentCounts) {
    if (count > 1) {
      diagnostics.push({
        code: 'duplicate-parent',
        message: `Node ${nodeId} has ${count} parents`,
        nodeId,
      });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reachable = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      diagnostics.push({
        code: 'cycle',
        message: `Cycle detected at ${nodeId}`,
        nodeId,
      });
      return;
    }
    if (visited.has(nodeId)) return;

    visiting.add(nodeId);
    reachable.add(nodeId);
    const node = document.nodes[nodeId];
    if (node) {
      for (const [, children] of childLists(node)) {
        children.forEach(visit);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  visit(document.rootNodeId);
  for (const nodeId of Object.keys(document.nodes)) {
    if (!reachable.has(nodeId)) {
      diagnostics.push({
        code: 'unreachable-node',
        message: `Node ${nodeId} is not reachable from the root`,
        nodeId,
      });
    }
  }

  return diagnostics;
}

export function assertValidDocumentGraph(document: UiDocument): void {
  const diagnostics = validateDocumentGraph(document);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  }
}
