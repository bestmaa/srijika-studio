import {
  createBlankDocument,
  createElementNode,
  type ElementNode,
  type UiDocument,
} from '@sutra/contracts';

export function createEngineDocument(): UiDocument {
  const document = createBlankDocument('page_test', 'Test page');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected an element root');

  // Engine tests use schema-safe IDs without depending on the core registry.
  root.componentId = 'test.page';
  return document;
}

export function createContainer(id: string, name = 'Container'): ElementNode {
  return createElementNode(id, 'test.container', name, {
    slots: { children: [] },
  });
}

export function attachNode(document: UiDocument, parentId: string, node: ElementNode): void {
  const parent = document.nodes[parentId];
  if (!parent || parent.kind !== 'element') throw new Error('Expected an element parent');
  parent.slots['children']?.push(node.id);
  document.nodes[node.id] = node;
}
