import { analyzeRepeatedSiblings, type ComponentRegistry } from '@srijika/component-registry';
import type { SrijikaProject, UiDocument, UiNode, ValueExpression } from '@srijika/contracts';
import { childLists, deriveParentIndex } from '@srijika/document-engine';

import type {
  ComponentCatalogEntry,
  GeneratedCodeResult,
  NodeDetail,
  PageOutline,
  PageOutlineEntry,
  PageOutlineOptions,
  ProjectSummary,
  RepetitionAnalysis,
  RepetitionAnalysisOptions,
} from './types';
import { DOCUMENT_FORMAT_VERSION, PROTOCOL_VERSION, TOOL_VERSION } from './version';

function expressionSymbols(expression: ValueExpression, result: Set<string>): void {
  switch (expression.kind) {
    case 'reference':
      result.add(expression.symbolId);
      break;
    case 'unary':
      expressionSymbols(expression.operand, result);
      break;
    case 'binary':
      expressionSymbols(expression.left, result);
      expressionSymbols(expression.right, result);
      break;
    case 'conditional':
      expressionSymbols(expression.condition, result);
      expressionSymbols(expression.whenTrue, result);
      expressionSymbols(expression.whenFalse, result);
      break;
    case 'template':
      expression.parts.forEach((part) => {
        if (typeof part !== 'string') expressionSymbols(part, result);
      });
      break;
    case 'customCodeReference':
      expression.args.forEach((argument) => expressionSymbols(argument, result));
      break;
    case 'literal':
      break;
  }
}

function nodeExpressions(node: UiNode): ValueExpression[] {
  switch (node.kind) {
    case 'element':
      return [
        ...Object.values(node.props),
        ...Object.values(node.events),
        ...Object.values(node.eventArguments ?? {}).flatMap((mapping) =>
          mapping.kind === 'expression' ? [mapping.expression] : [],
        ),
        node.visible,
      ];
    case 'text':
      return [node.value];
    case 'expression':
      return [node.expression];
    case 'if':
      return [node.condition];
    case 'repeat':
      return [node.source];
    case 'fragment':
    case 'slot':
      return [];
  }
}

function childrenCount(node: UiNode): number {
  return childLists(node).reduce((count, [, children]) => count + children.length, 0);
}

export function buildProjectSummary(
  project: SrijikaProject,
  documents: Readonly<Record<string, UiDocument>>,
  selectedPageId: string = project.entryPageId,
): ProjectSummary {
  const pages = project.pages.flatMap((id) => {
    const document = documents[id];
    if (!document) return [];
    return [
      {
        id: document.id,
        name: document.name,
        kind: document.kind,
        revision: document.revision,
        nodeCount: Object.keys(document.nodes).length,
        publicPropCount: Object.keys(document.publicProps).length,
        isEntryPage: id === project.entryPageId,
      },
    ];
  });

  return {
    protocolVersion: PROTOCOL_VERSION,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    selectedPageId,
    project: {
      id: project.id,
      name: project.name,
      entryPageId: project.entryPageId,
      pageCount: project.pages.length,
      componentCount: project.components.length,
    },
    pages,
    missingDocumentIds: project.pages.filter((id) => documents[id] === undefined),
  };
}

export function buildPageOutline(
  document: UiDocument,
  options: PageOutlineOptions = {},
): PageOutline {
  const maxDepth = Math.max(0, options.maxDepth ?? Number.POSITIVE_INFINITY);
  const maxNodes = Math.max(1, options.maxNodes ?? Number.POSITIVE_INFINITY);
  const nodes: PageOutlineEntry[] = [];
  const visited = new Set<string>();
  const stack: Array<{
    nodeId: string;
    depth: number;
    parentId?: string;
    slot?: string;
    index?: number;
  }> = [{ nodeId: document.rootNodeId, depth: 0 }];

  while (stack.length > 0 && nodes.length < maxNodes) {
    const current = stack.pop();
    if (!current || visited.has(current.nodeId)) continue;
    const node = document.nodes[current.nodeId];
    if (!node) continue;
    visited.add(current.nodeId);
    nodes.push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      ...(node.kind === 'element' ? { componentId: node.componentId } : {}),
      ...(current.parentId === undefined ? {} : { parentId: current.parentId }),
      ...(current.slot === undefined ? {} : { slot: current.slot }),
      ...(current.index === undefined ? {} : { index: current.index }),
      depth: current.depth,
      childCount: childrenCount(node),
    });

    if (current.depth >= maxDepth) continue;
    const lists = [...childLists(node)];
    for (let listIndex = lists.length - 1; listIndex >= 0; listIndex -= 1) {
      const list = lists[listIndex];
      if (!list) continue;
      const [slot, childIds] = list;
      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        const childId = childIds[index];
        if (!childId) continue;
        stack.push({ nodeId: childId, parentId: node.id, slot, index, depth: current.depth + 1 });
      }
    }
  }

  return {
    documentId: document.id,
    name: document.name,
    revision: document.revision,
    rootNodeId: document.rootNodeId,
    totalNodeCount: Object.keys(document.nodes).length,
    returnedNodeCount: nodes.length,
    truncated: nodes.length < Object.keys(document.nodes).length,
    nodes,
  };
}

export function buildNodeDetail(document: UiDocument, nodeId: string): NodeDetail | null {
  const node = document.nodes[nodeId];
  if (!node) return null;
  const parent = deriveParentIndex(document).get(nodeId);
  const referencedSymbols = new Set<string>();
  nodeExpressions(node).forEach((expression) => expressionSymbols(expression, referencedSymbols));

  return {
    documentId: document.id,
    revision: document.revision,
    node: structuredClone(node),
    parent: parent ? { nodeId: parent.parentId, slot: parent.slot, index: parent.index } : null,
    children: childLists(node).map(([slot, childIds]) => ({ slot, nodeIds: [...childIds] })),
    referencedSymbols: [...referencedSymbols].sort(),
  };
}

export function buildComponentCatalog<TImplementation>(
  registry: ComponentRegistry<TImplementation>,
): ComponentCatalogEntry[] {
  return registry.manifests().map((manifest) => {
    const definition = registry.require(manifest.id);
    return {
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      category: manifest.category,
      props: Object.keys(manifest.props).sort(),
      events: Object.keys(manifest.events).sort(),
      slots: Object.keys(manifest.slots).sort(),
      propSpecs: structuredClone(manifest.props),
      eventSpecs: structuredClone(manifest.events),
      slotSpecs: structuredClone(manifest.slots),
      editor: structuredClone(manifest.editor),
      defaultNode: structuredClone(definition.createNode('__catalog_default__')),
      draggable: manifest.editor.draggable,
      dropStrategy: manifest.editor.dropStrategy,
    };
  });
}

export function buildRepetitionAnalysis(
  document: UiDocument,
  options: RepetitionAnalysisOptions = {},
): RepetitionAnalysis {
  const minInstances = Math.max(2, options.minInstances ?? 2);
  const maxCandidates = Math.max(1, options.maxCandidates ?? 50);
  const all = analyzeRepeatedSiblings(document, {
    minInstances,
    maxCandidates: Number.MAX_SAFE_INTEGER,
  });
  const matching = options.candidateId
    ? all.filter((candidate) => candidate.candidateId === options.candidateId)
    : all;
  const candidates = matching.slice(0, maxCandidates).map((candidate) => ({
    candidateId: candidate.candidateId,
    parentId: candidate.parentId,
    slot: candidate.slot,
    startIndex: candidate.startIndex,
    nodeIds: [...candidate.nodeIds],
    instanceCount: candidate.instanceCount,
    templateNodeId: candidate.templateNodeId,
    templateKind: candidate.templateKind,
    depth: candidate.depth,
    confidence: candidate.confidence,
    fields: candidate.fields.map((field) => ({
      name: field.name,
      displayName: field.displayName,
      shape: structuredClone(field.shape),
      locator: structuredClone(field.locator),
      ...(options.includeValues ? { values: structuredClone(field.values) } : {}),
    })),
  }));
  return {
    documentId: document.id,
    revision: document.revision,
    minInstances,
    totalCount: matching.length,
    returnedCount: candidates.length,
    truncated: matching.length > maxCandidates,
    candidates,
  };
}

function generatedPublicPropInterface(code: string): string {
  const lines = code.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('export interface '));
  if (start < 0) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => line === '}');
  if (endOffset < 0) return '';
  return lines.slice(start, start + endOffset + 2).join('\n');
}

function repeatMapSignatures(code: string): string[] {
  return [
    ...code.matchAll(/\.map\(\(([A-Za-z_$][A-Za-z0-9_$]*), ([A-Za-z_$][A-Za-z0-9_$]*)\) => \(/g),
  ]
    .map((match) => match[0])
    .slice(0, 50);
}

export function buildGeneratedCodeResult(
  document: UiDocument,
  code: string,
  detail: 'summary' | 'full' = 'summary',
): GeneratedCodeResult {
  const metadata = {
    protocolVersion: PROTOCOL_VERSION,
    toolVersion: TOOL_VERSION,
    documentFormatVersion: DOCUMENT_FORMAT_VERSION,
    documentId: document.id,
    revision: document.revision,
    language: 'tsx' as const,
    fileName: `${document.id}.tsx`,
    characterCount: code.length,
    lineCount: code.length === 0 ? 0 : code.split(/\r?\n/).length,
  };
  if (detail === 'full') return { ...metadata, detail, code };
  const nodes = Object.values(document.nodes);
  return {
    ...metadata,
    detail,
    publicPropInterface: generatedPublicPropInterface(code),
    publicProps: Object.values(document.publicProps)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((prop) => ({
        name: prop.name,
        valueType: prop.valueType,
        required: prop.required,
        hasDefault: prop.defaultValue !== undefined,
        ...(prop.valueShape === undefined ? {} : { valueShape: structuredClone(prop.valueShape) }),
      })),
    structure: {
      nodeCount: nodes.length,
      repeatCount: nodes.filter((node) => node.kind === 'repeat').length,
      conditionalCount: nodes.filter((node) => node.kind === 'if').length,
    },
    repeatMapSignatures: repeatMapSignatures(code),
  };
}
