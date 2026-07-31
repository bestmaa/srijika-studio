import type {
  SymbolDeclaration,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueType,
  LiteralValue,
} from '@sutra/contracts';

import { isTypeAssignable } from './compatibility';
import type { ComponentRegistry } from './registry';

export type DiagnosticSeverity = 'error' | 'warning';

export interface DocumentDiagnostic {
  code:
    | 'unknown-component'
    | 'component-version-mismatch'
    | 'unknown-prop'
    | 'missing-required-prop'
    | 'prop-type-mismatch'
    | 'unknown-event'
    | 'event-type-mismatch'
    | 'unknown-slot'
    | 'slot-underflow'
    | 'slot-overflow'
    | 'slot-component-mismatch'
    | 'missing-symbol'
    | 'condition-type-mismatch'
    | 'repeat-source-type-mismatch'
    | 'invalid-repeat-symbol'
    | 'public-prop-symbol-mismatch';
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  nodeId?: string;
  symbolId?: string;
}

function literalType(value: LiteralValue): ValueType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'unknown';
}

export function inferExpressionType(
  expression: ValueExpression,
  symbols: Readonly<Record<string, SymbolDeclaration>>,
): ValueType {
  switch (expression.kind) {
    case 'literal':
      return literalType(expression.value);
    case 'reference':
      return expression.path.length === 0
        ? (symbols[expression.symbolId]?.valueType ?? 'unknown')
        : 'unknown';
    case 'unary':
      return expression.operator === 'not' ? 'boolean' : 'number';
    case 'binary':
      switch (expression.operator) {
        case 'equals':
        case 'notEquals':
        case 'greaterThan':
        case 'greaterThanOrEqual':
        case 'lessThan':
        case 'lessThanOrEqual':
        case 'and':
        case 'or':
          return 'boolean';
        case 'add': {
          const left = inferExpressionType(expression.left, symbols);
          const right = inferExpressionType(expression.right, symbols);
          return left === 'string' || right === 'string' ? 'string' : 'number';
        }
        case 'subtract':
        case 'multiply':
        case 'divide':
          return 'number';
        default:
          return 'unknown';
      }
    case 'conditional': {
      const whenTrue = inferExpressionType(expression.whenTrue, symbols);
      const whenFalse = inferExpressionType(expression.whenFalse, symbols);
      return whenTrue === whenFalse ? whenTrue : 'unknown';
    }
    case 'template':
      return 'string';
    case 'registeredCall':
    case 'customCodeReference':
      return 'unknown';
  }
}

function expressionReferences(expression: ValueExpression): string[] {
  switch (expression.kind) {
    case 'literal':
      return [];
    case 'reference':
      return [expression.symbolId];
    case 'unary':
      return expressionReferences(expression.operand);
    case 'binary':
      return [...expressionReferences(expression.left), ...expressionReferences(expression.right)];
    case 'conditional':
      return [
        ...expressionReferences(expression.condition),
        ...expressionReferences(expression.whenTrue),
        ...expressionReferences(expression.whenFalse),
      ];
    case 'template':
      return expression.parts.flatMap((part) =>
        typeof part === 'string' ? [] : expressionReferences(part),
      );
    case 'registeredCall':
    case 'customCodeReference':
      return expression.args.flatMap(expressionReferences);
  }
}

function nodeExpressions(node: UiNode): Array<{ path: string; expression: ValueExpression }> {
  switch (node.kind) {
    case 'element':
      return [
        { path: 'visible', expression: node.visible },
        ...Object.entries(node.props).map(([name, expression]) => ({
          path: `props.${name}`,
          expression,
        })),
        ...Object.entries(node.events).map(([name, expression]) => ({
          path: `events.${name}`,
          expression,
        })),
      ];
    case 'text':
      return [{ path: 'value', expression: node.value }];
    case 'expression':
      return [{ path: 'expression', expression: node.expression }];
    case 'if':
      return [{ path: 'condition', expression: node.condition }];
    case 'repeat':
      return [{ path: 'source', expression: node.source }];
    case 'fragment':
    case 'slot':
      return [];
  }
}

function pushMissingSymbolDiagnostics(
  diagnostics: DocumentDiagnostic[],
  document: UiDocument,
  node: UiNode,
): void {
  for (const entry of nodeExpressions(node)) {
    for (const symbolId of new Set(expressionReferences(entry.expression))) {
      if (!document.symbols[symbolId]) {
        diagnostics.push({
          code: 'missing-symbol',
          severity: 'error',
          path: `nodes.${node.id}.${entry.path}`,
          nodeId: node.id,
          symbolId,
          message: `Expression references missing symbol ${symbolId}`,
        });
      }
    }
  }
}

export function analyzeDocument<TImplementation>(
  document: UiDocument,
  registry: ComponentRegistry<TImplementation>,
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];

  for (const prop of Object.values(document.publicProps)) {
    const symbol = document.symbols[prop.symbolId];
    if (
      !symbol ||
      symbol.name !== prop.name ||
      symbol.valueType !== prop.valueType ||
      symbol.required !== prop.required
    ) {
      diagnostics.push({
        code: 'public-prop-symbol-mismatch',
        severity: 'error',
        path: `publicProps.${prop.name}`,
        symbolId: prop.symbolId,
        message: `Public prop ${prop.name} is not synchronized with its canonical symbol`,
      });
    }
  }

  for (const node of Object.values(document.nodes)) {
    pushMissingSymbolDiagnostics(diagnostics, document, node);

    if (node.kind === 'if') {
      const conditionType = inferExpressionType(node.condition, document.symbols);
      if (conditionType !== 'boolean' && conditionType !== 'unknown') {
        diagnostics.push({
          code: 'condition-type-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.condition`,
          nodeId: node.id,
          message: `If condition must be boolean, received ${conditionType}`,
        });
      }
      continue;
    }

    if (node.kind === 'repeat') {
      const sourceType = inferExpressionType(node.source, document.symbols);
      if (sourceType !== 'array' && sourceType !== 'unknown') {
        diagnostics.push({
          code: 'repeat-source-type-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.source`,
          nodeId: node.id,
          message: `Repeat source must be array, received ${sourceType}`,
        });
      }
      const itemSymbol = document.symbols[node.itemSymbolId];
      const indexSymbol = document.symbols[node.indexSymbolId];
      if (itemSymbol?.provider !== 'repeatItem' || indexSymbol?.provider !== 'repeatIndex') {
        diagnostics.push({
          code: 'invalid-repeat-symbol',
          severity: 'error',
          path: `nodes.${node.id}`,
          nodeId: node.id,
          message: `Repeat ${node.id} must own valid item and index scope symbols`,
        });
      }
      continue;
    }

    if (node.kind !== 'element') continue;
    const definition = registry.get(node.componentId);
    if (!definition) {
      diagnostics.push({
        code: 'unknown-component',
        severity: 'error',
        path: `nodes.${node.id}.componentId`,
        nodeId: node.id,
        message: `Component ${node.componentId} is not registered`,
      });
      continue;
    }
    const manifest = definition.manifest;
    if (node.componentVersion !== manifest.version) {
      diagnostics.push({
        code: 'component-version-mismatch',
        severity: 'error',
        path: `nodes.${node.id}.componentVersion`,
        nodeId: node.id,
        message: `Component ${node.componentId} expects version ${manifest.version}, received ${node.componentVersion}`,
      });
    }

    for (const [propName, expression] of Object.entries(node.props)) {
      const spec = manifest.props[propName];
      if (!spec) {
        diagnostics.push({
          code: 'unknown-prop',
          severity: 'error',
          path: `nodes.${node.id}.props.${propName}`,
          nodeId: node.id,
          message: `Component ${node.componentId} has no prop named ${propName}`,
        });
        continue;
      }
      const sourceType = inferExpressionType(expression, document.symbols);
      if (sourceType !== 'unknown' && !isTypeAssignable(sourceType, spec.type)) {
        diagnostics.push({
          code: 'prop-type-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.props.${propName}`,
          nodeId: node.id,
          message: `Prop ${propName} expects ${spec.type}, received ${sourceType}`,
        });
      }
    }

    for (const [propName, spec] of Object.entries(manifest.props)) {
      if (spec.required && !node.props[propName] && spec.defaultValue === undefined) {
        diagnostics.push({
          code: 'missing-required-prop',
          severity: 'error',
          path: `nodes.${node.id}.props.${propName}`,
          nodeId: node.id,
          message: `Required prop ${propName} is missing`,
        });
      }
    }

    for (const [eventName, expression] of Object.entries(node.events)) {
      if (!manifest.events[eventName]) {
        diagnostics.push({
          code: 'unknown-event',
          severity: 'error',
          path: `nodes.${node.id}.events.${eventName}`,
          nodeId: node.id,
          message: `Component ${node.componentId} has no event named ${eventName}`,
        });
        continue;
      }
      const sourceType = inferExpressionType(expression, document.symbols);
      if (sourceType !== 'event' && sourceType !== 'unknown') {
        diagnostics.push({
          code: 'event-type-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.events.${eventName}`,
          nodeId: node.id,
          message: `Event ${eventName} expects an event callback, received ${sourceType}`,
        });
      }
    }

    for (const [slotName, childIds] of Object.entries(node.slots)) {
      const slot = manifest.slots[slotName];
      if (!slot) {
        diagnostics.push({
          code: 'unknown-slot',
          severity: 'error',
          path: `nodes.${node.id}.slots.${slotName}`,
          nodeId: node.id,
          message: `Component ${node.componentId} has no slot named ${slotName}`,
        });
        continue;
      }
      if (childIds.length < slot.minChildren) {
        diagnostics.push({
          code: 'slot-underflow',
          severity: 'error',
          path: `nodes.${node.id}.slots.${slotName}`,
          nodeId: node.id,
          message: `Slot ${slotName} needs at least ${slot.minChildren} children`,
        });
      }
      if (slot.maxChildren !== undefined && childIds.length > slot.maxChildren) {
        diagnostics.push({
          code: 'slot-overflow',
          severity: 'error',
          path: `nodes.${node.id}.slots.${slotName}`,
          nodeId: node.id,
          message: `Slot ${slotName} accepts at most ${slot.maxChildren} children`,
        });
      }
      if (slot.accepts !== '*') {
        childIds.forEach((childId) => {
          const child = document.nodes[childId];
          if (child?.kind === 'element' && !slot.accepts.includes(child.componentId)) {
            diagnostics.push({
              code: 'slot-component-mismatch',
              severity: 'error',
              path: `nodes.${node.id}.slots.${slotName}`,
              nodeId: node.id,
              message: `Slot ${slotName} does not accept ${child.componentId}`,
            });
          }
        });
      }
    }
  }

  return diagnostics;
}

export function assertDocumentSemantics<TImplementation>(
  document: UiDocument,
  registry: ComponentRegistry<TImplementation>,
): void {
  const errors = analyzeDocument(document, registry).filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (errors.length > 0) {
    throw new Error(
      `Invalid Sutra document semantics: ${errors
        .slice(0, 5)
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join('; ')}`,
    );
  }
}
