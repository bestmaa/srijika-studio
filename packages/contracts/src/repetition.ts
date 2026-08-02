import type { LiteralValue, UiDocument, UiNode, ValueExpression, ValueShape } from './schemas';

export interface RelativeNodeStep {
  slot: string;
  index: number;
}

export type RepeatLiteralTarget =
  | { kind: 'elementProp'; name: string }
  | { kind: 'elementVisibility' }
  | { kind: 'eventArgument'; name: string }
  | { kind: 'textValue' }
  | { kind: 'expressionValue' }
  | { kind: 'ifCondition' }
  | { kind: 'repeatSource' };

export interface RepeatLiteralLocator {
  nodePath: RelativeNodeStep[];
  target: RepeatLiteralTarget;
}

export interface RepeatedSiblingField {
  name: string;
  displayName: string;
  locator: RepeatLiteralLocator;
  shape: ValueShape;
  values: LiteralValue[];
}

export interface RepeatedSiblingCandidate {
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
  fields: RepeatedSiblingField[];
}

export interface RepeatedSiblingAnalysisOptions {
  minInstances?: number;
  maxCandidates?: number;
}

interface LiteralBinding {
  locator: RepeatLiteralLocator;
  nodeName: string;
  value: LiteralValue;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
    .join(',')}}`;
}

function valueShape(value: LiteralValue): ValueShape {
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (value === null) return { kind: 'unknown' };
  if (Array.isArray(value)) {
    return { kind: 'array', item: mergeValueShapes(value.map(valueShape)) };
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([key]) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key))) {
    return { kind: 'object', fields: {}, additionalProperties: true };
  }
  return {
    kind: 'object',
    fields: Object.fromEntries(
      entries.map(([key, nested]) => [key, { required: true, shape: valueShape(nested) }]),
    ),
    additionalProperties: false,
  };
}

export function mergeValueShapes(shapes: readonly ValueShape[]): ValueShape {
  if (shapes.length === 0) return { kind: 'unknown' };
  const first = shapes[0];
  if (!first || shapes.some((shape) => shape.kind !== first.kind)) return { kind: 'unknown' };
  if (first.kind === 'array') {
    return {
      kind: 'array',
      item: mergeValueShapes(
        shapes.flatMap((shape) => (shape.kind === 'array' ? [shape.item] : [])),
      ),
    };
  }
  if (first.kind === 'object') {
    const objects = shapes.flatMap((shape) => (shape.kind === 'object' ? [shape] : []));
    const names = new Set(objects.flatMap((shape) => Object.keys(shape.fields)));
    return {
      kind: 'object',
      fields: Object.fromEntries(
        [...names].sort().map((name) => {
          const present = objects.flatMap((shape) => {
            const field = shape.fields[name];
            return field ? [field.shape] : [];
          });
          return [
            name,
            {
              required: present.length === objects.length,
              shape: mergeValueShapes(present),
            },
          ];
        }),
      ),
      additionalProperties: objects.some((shape) => shape.additionalProperties),
    };
  }
  return first;
}

export function inferLiteralValueShape(values: readonly LiteralValue[]): ValueShape {
  return mergeValueShapes(values.map(valueShape));
}

function literalShapeSignature(value: LiteralValue): string {
  return canonical(valueShape(value));
}

function expressionSignature(expression: ValueExpression, parameterizeLiteral: boolean): unknown {
  if (expression.kind === 'literal') {
    return parameterizeLiteral
      ? ['literal', literalShapeSignature(expression.value)]
      : ['literal', expression.value];
  }
  switch (expression.kind) {
    case 'reference':
      return ['reference', expression.symbolId, expression.path];
    case 'unary':
      return ['unary', expression.operator, expressionSignature(expression.operand, false)];
    case 'binary':
      return [
        'binary',
        expression.operator,
        expressionSignature(expression.left, false),
        expressionSignature(expression.right, false),
      ];
    case 'conditional':
      return [
        'conditional',
        expressionSignature(expression.condition, false),
        expressionSignature(expression.whenTrue, false),
        expressionSignature(expression.whenFalse, false),
      ];
    case 'template':
      return [
        'template',
        expression.parts.map((part) =>
          typeof part === 'string' ? ['text', part] : expressionSignature(part, false),
        ),
      ];
    case 'customCodeReference':
      return [
        'customCodeReference',
        expression.moduleId,
        expression.exportName,
        expression.args.map((argument) => expressionSignature(argument, false)),
      ];
  }
}

function childLists(node: UiNode): Array<[string, string[]]> {
  switch (node.kind) {
    case 'element':
      return Object.entries(node.slots).sort(([left], [right]) => left.localeCompare(right));
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

function sortedExpressionEntries(
  values: Readonly<Record<string, ValueExpression>>,
  parameterizeLiteral: boolean,
): unknown[] {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, expression]) => [name, expressionSignature(expression, parameterizeLiteral)]);
}

function subtreeSignature(
  document: UiDocument,
  nodeId: string,
  cache: Map<string, unknown>,
): unknown {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const node = document.nodes[nodeId];
  if (!node) return ['missing'];
  const children = childLists(node).map(([slot, ids]) => [
    slot,
    ids.map((childId) => subtreeSignature(document, childId, cache)),
  ]);
  const remember = (signature: unknown): unknown => {
    cache.set(nodeId, signature);
    return signature;
  };
  switch (node.kind) {
    case 'element':
      return remember([
        node.kind,
        node.componentId,
        node.componentVersion,
        sortedExpressionEntries(node.props, true),
        sortedExpressionEntries(node.events, false),
        Object.entries(node.eventArguments ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, argument]) => [
            name,
            argument.kind === 'eventPayload'
              ? ['eventPayload']
              : ['expression', expressionSignature(argument.expression, true)],
          ]),
        node.instanceProps ?? null,
        node.instanceEvents ?? null,
        node.classRefs,
        node.style,
        expressionSignature(node.visible, true),
        node.locked,
        children,
      ]);
    case 'text':
      return remember([node.kind, expressionSignature(node.value, true)]);
    case 'expression':
      return remember([node.kind, expressionSignature(node.expression, true)]);
    case 'fragment':
      return remember([node.kind, children]);
    case 'if':
      return remember([node.kind, expressionSignature(node.condition, true), children]);
    case 'repeat':
      return remember([
        node.kind,
        expressionSignature(node.source, true),
        node.itemSymbolId,
        node.indexSymbolId,
        children,
      ]);
    case 'slot':
      return remember([node.kind, node.slotName, children]);
  }
}

function collectLiteralBindings(
  document: UiDocument,
  nodeId: string,
  nodePath: RelativeNodeStep[] = [],
  bindings: LiteralBinding[] = [],
): LiteralBinding[] {
  const node = document.nodes[nodeId];
  if (!node) return bindings;
  const add = (expression: ValueExpression, target: RepeatLiteralTarget): void => {
    if (expression.kind !== 'literal') return;
    bindings.push({
      locator: { nodePath: structuredClone(nodePath), target },
      nodeName: node.name,
      value: structuredClone(expression.value),
    });
  };
  switch (node.kind) {
    case 'element':
      Object.entries(node.props)
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([name, expression]) => add(expression, { kind: 'elementProp', name }));
      Object.entries(node.eventArguments ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([name, argument]) => {
          if (argument.kind === 'expression') {
            add(argument.expression, { kind: 'eventArgument', name });
          }
        });
      add(node.visible, { kind: 'elementVisibility' });
      break;
    case 'text':
      add(node.value, { kind: 'textValue' });
      break;
    case 'expression':
      add(node.expression, { kind: 'expressionValue' });
      break;
    case 'if':
      add(node.condition, { kind: 'ifCondition' });
      break;
    case 'repeat':
      add(node.source, { kind: 'repeatSource' });
      break;
    case 'fragment':
    case 'slot':
      break;
  }
  childLists(node).forEach(([slot, childIds]) => {
    childIds.forEach((childId, index) => {
      collectLiteralBindings(document, childId, [...nodePath, { slot, index }], bindings);
    });
  });
  return bindings;
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function camelIdentifier(value: string, fallback: string): string {
  const combined = words(value)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
  const prefixed = /^[A-Za-z_$]/.test(combined) ? combined : `value${combined}`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prefixed) ? prefixed : fallback;
}

function targetName(target: RepeatLiteralTarget): string {
  switch (target.kind) {
    case 'elementProp':
      return target.name;
    case 'elementVisibility':
      return 'visible';
    case 'eventArgument':
      return `${target.name}Argument`;
    case 'textValue':
      return 'text';
    case 'expressionValue':
      return 'value';
    case 'ifCondition':
      return 'condition';
    case 'repeatSource':
      return 'items';
  }
}

function createFields(bindingSets: readonly LiteralBinding[][]): RepeatedSiblingField[] {
  const first = bindingSets[0] ?? [];
  const varying = first.flatMap((binding, index) => {
    const aligned = bindingSets.map((bindings) => bindings[index]);
    if (aligned.some((entry) => !entry)) return [];
    const values = aligned.map((entry) => structuredClone(entry!.value));
    if (values.every((value) => canonical(value) === canonical(values[0]))) return [];
    return [{ binding, values }];
  });
  const baseCounts = new Map<string, number>();
  varying.forEach(({ binding }) => {
    const base = camelIdentifier(targetName(binding.locator.target), 'value');
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  });
  const used = new Set<string>();
  return varying.map(({ binding, values }) => {
    const base = camelIdentifier(targetName(binding.locator.target), 'value');
    const qualified =
      (baseCounts.get(base) ?? 0) > 1 ? camelIdentifier(`${binding.nodeName} ${base}`, base) : base;
    let name = qualified;
    let suffix = 2;
    while (used.has(name)) {
      name = `${qualified}${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return {
      name,
      displayName: words(name).join(' ') || 'Value',
      locator: structuredClone(binding.locator),
      shape: inferLiteralValueShape(values),
      values,
    };
  });
}

function hash(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function findRepeatedSiblingCandidates(
  document: UiDocument,
  options: RepeatedSiblingAnalysisOptions = {},
): RepeatedSiblingCandidate[] {
  const minInstances = Math.max(2, options.minInstances ?? 2);
  const maxCandidates = Math.max(1, options.maxCandidates ?? 100);
  const candidates: RepeatedSiblingCandidate[] = [];
  const signatureCache = new Map<string, unknown>();
  const visit = (nodeId: string, depth: number, insideRepeat: boolean): void => {
    if (candidates.length >= maxCandidates) return;
    const node = document.nodes[nodeId];
    if (!node) return;
    const nextInsideRepeat = insideRepeat || node.kind === 'repeat';
    if (!nextInsideRepeat) {
      for (const [slot, childIds] of childLists(node)) {
        let startIndex = 0;
        while (startIndex < childIds.length) {
          const firstId = childIds[startIndex];
          if (!firstId) {
            startIndex += 1;
            continue;
          }
          const signature = canonical(subtreeSignature(document, firstId, signatureCache));
          let endIndex = startIndex + 1;
          while (
            endIndex < childIds.length &&
            canonical(subtreeSignature(document, childIds[endIndex]!, signatureCache)) === signature
          ) {
            endIndex += 1;
          }
          const nodeIds = childIds.slice(startIndex, endIndex);
          if (nodeIds.length >= minInstances) {
            const fields = createFields(
              nodeIds.map((repeatedNodeId) => collectLiteralBindings(document, repeatedNodeId)),
            );
            const template = document.nodes[firstId];
            if (template) {
              const identity = `${node.id}:${slot}:${startIndex}:${nodeIds.length}:${signature}`;
              candidates.push({
                candidateId: `repeat_${hash(identity)}`,
                parentId: node.id,
                slot,
                startIndex,
                nodeIds: [...nodeIds],
                instanceCount: nodeIds.length,
                templateNodeId: firstId,
                templateKind: template.kind,
                depth: depth + 1,
                confidence: fields.length > 0 ? 0.98 : 0.72,
                fields,
              });
              if (candidates.length >= maxCandidates) return;
            }
          }
          startIndex = endIndex;
        }
      }
    }
    for (const [, childIds] of childLists(node)) {
      for (const childId of childIds) visit(childId, depth + 1, nextInsideRepeat);
    }
  };
  visit(document.rootNodeId, 0, false);
  return candidates;
}
