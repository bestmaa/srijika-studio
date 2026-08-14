import type {
  InstanceEventSpec,
  InstancePropSpec,
  SymbolDeclaration,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueShape,
  ValueType,
  LiteralValue,
} from '@srijika/contracts';
import { instancePropNameError, isApprovedInstanceEventSpec } from '@srijika/contracts';

import {
  isEventSignatureAssignable,
  isTypeAssignable,
  isValueDeclarationAssignableToShape,
  literalMatchesValueShape,
} from './compatibility';
import type { ComponentRegistry } from './registry';

export type DiagnosticSeverity = 'error' | 'warning';

export interface DocumentDiagnostic {
  code:
    | 'unknown-component'
    | 'component-version-mismatch'
    | 'unknown-prop'
    | 'unsafe-instance-prop'
    | 'instance-prop-conflict'
    | 'missing-required-prop'
    | 'prop-type-mismatch'
    | 'unknown-event'
    | 'invalid-instance-event'
    | 'instance-event-conflict'
    | 'event-type-mismatch'
    | 'event-signature-mismatch'
    | 'event-argument-mismatch'
    | 'unknown-slot'
    | 'slot-underflow'
    | 'slot-overflow'
    | 'slot-component-mismatch'
    | 'missing-symbol'
    | 'invalid-reference-path'
    | 'repeat-symbol-out-of-scope'
    | 'value-shape-mismatch'
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

function instancePropShapeMatchesType(spec: InstancePropSpec): boolean {
  return (
    spec.valueShape === undefined || spec.type === 'unknown' || spec.valueShape.kind === spec.type
  );
}

interface EffectivePropSpec {
  type: ValueType;
  required: boolean;
  defaultValue?: LiteralValue;
  valueShape?: ValueShape;
}

function effectivePropSpec(
  manifestSpec: EffectivePropSpec | undefined,
  instanceSpec: InstancePropSpec | undefined,
): EffectivePropSpec | undefined {
  return manifestSpec ?? instanceSpec;
}

function effectiveEventSpec(
  manifestSpec: { signature: InstanceEventSpec['signature'] } | undefined,
  instanceSpec: InstanceEventSpec | undefined,
): { signature: InstanceEventSpec['signature'] } | undefined {
  return manifestSpec ?? instanceSpec;
}

function literalType(value: LiteralValue): ValueType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'unknown';
}

const unknownShape: ValueShape = { kind: 'unknown' };
const blockedPathSegments = new Set(['__proto__', 'prototype', 'constructor']);

function shapeValueType(shape: ValueShape): ValueType {
  return shape.kind;
}

function shapeAtPath(
  shape: ValueShape,
  path: readonly string[],
): { shape: ValueShape; error?: string } {
  let current = shape;
  for (const segment of path) {
    if (blockedPathSegments.has(segment)) {
      return { shape: unknownShape, error: `Path segment ${segment} is not allowed` };
    }
    if (current.kind === 'unknown') return { shape: current };
    if (current.kind === 'object') {
      const field = current.fields[segment];
      if (field) {
        current = field.shape;
        continue;
      }
      if (current.additionalProperties) {
        current = unknownShape;
        continue;
      }
      return { shape: unknownShape, error: `Object shape has no field named ${segment}` };
    }
    if (current.kind === 'array') {
      if (segment === 'length') {
        current = { kind: 'number' };
        continue;
      }
      if (/^(?:0|[1-9][0-9]*)$/.test(segment)) {
        current = current.item;
        continue;
      }
      return { shape: unknownShape, error: `Array shape cannot be read through ${segment}` };
    }
    return { shape: unknownShape, error: `${current.kind} values do not have a ${segment} field` };
  }
  return { shape: current };
}

function expressionValueShape(
  expression: ValueExpression,
  symbols: Readonly<Record<string, SymbolDeclaration>>,
): ValueShape | undefined {
  if (expression.kind !== 'reference') return undefined;
  const shape = symbols[expression.symbolId]?.valueShape;
  if (!shape) return undefined;
  const result = shapeAtPath(shape, expression.path);
  return result.error ? undefined : result.shape;
}

function expressionMatchesValueShape(
  expression: ValueExpression,
  symbols: Readonly<Record<string, SymbolDeclaration>>,
  target: ValueShape,
): boolean {
  if (expression.kind === 'literal') {
    return literalMatchesValueShape(expression.value, target);
  }
  if (expression.kind === 'customCodeReference') return false;
  if (expression.kind === 'reference') {
    const symbol = symbols[expression.symbolId];
    if (!symbol || symbol.valueType === 'event') return false;

    if (expression.path.length === 0) {
      if (!isValueDeclarationAssignableToShape(symbol.valueType, symbol.valueShape, target)) {
        return false;
      }
      return (
        symbol.required ||
        (symbol.defaultValue !== undefined && literalMatchesValueShape(symbol.defaultValue, target))
      );
    }

    // Optional object paths can still evaluate to undefined. Version 1 only
    // supplies a safe generated fallback for a direct public-prop reference.
    if (!symbol.required || !symbol.valueShape) return false;
    const result = shapeAtPath(symbol.valueShape, expression.path);
    return (
      result.error === undefined &&
      isValueDeclarationAssignableToShape(result.shape.kind, result.shape, target)
    );
  }

  // Nested expressions do not currently have a place to insert a per-symbol
  // default in generated TSX, so an optional reference would reintroduce
  // undefined into an otherwise typed argument.
  if (
    expressionReferences(expression).some((reference) => !symbols[reference.symbolId]?.required)
  ) {
    return false;
  }
  const sourceType = inferExpressionType(expression, symbols);
  return isValueDeclarationAssignableToShape(sourceType, undefined, target);
}

export function inferExpressionType(
  expression: ValueExpression,
  symbols: Readonly<Record<string, SymbolDeclaration>>,
): ValueType {
  switch (expression.kind) {
    case 'literal':
      return literalType(expression.value);
    case 'reference': {
      const symbol = symbols[expression.symbolId];
      if (expression.path.length === 0) {
        return symbol?.valueType ?? 'unknown';
      }
      return symbol?.valueShape
        ? shapeValueType(shapeAtPath(symbol.valueShape, expression.path).shape)
        : 'unknown';
    }
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
        case 'coalesce': {
          const left = inferExpressionType(expression.left, symbols);
          const right = inferExpressionType(expression.right, symbols);
          return left === right ? left : 'unknown';
        }
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
    case 'customCodeReference':
      return 'unknown';
  }
}

interface ExpressionReference {
  symbolId: string;
  path: readonly string[];
}

function expressionReferences(expression: ValueExpression): ExpressionReference[] {
  switch (expression.kind) {
    case 'literal':
      return [];
    case 'reference':
      return [{ symbolId: expression.symbolId, path: expression.path }];
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
        ...Object.entries(node.eventArguments ?? {}).flatMap(([name, argument]) =>
          argument.kind === 'expression'
            ? [
                {
                  path: `eventArguments.${name}.expression`,
                  expression: argument.expression,
                },
              ]
            : [],
        ),
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

function pushReferenceDiagnostics(
  diagnostics: DocumentDiagnostic[],
  node: UiNode,
  symbols: Readonly<Record<string, SymbolDeclaration>>,
  repeatSymbolsInScope: ReadonlySet<string>,
): void {
  for (const entry of nodeExpressions(node)) {
    const references = expressionReferences(entry.expression);
    for (const reference of references) {
      const symbol = symbols[reference.symbolId];
      if (!symbol) {
        diagnostics.push({
          code: 'missing-symbol',
          severity: 'error',
          path: `nodes.${node.id}.${entry.path}`,
          nodeId: node.id,
          symbolId: reference.symbolId,
          message: `Expression references missing symbol ${reference.symbolId}`,
        });
        continue;
      }
      if (
        (symbol.provider === 'repeatItem' || symbol.provider === 'repeatIndex') &&
        !repeatSymbolsInScope.has(symbol.id)
      ) {
        diagnostics.push({
          code: 'repeat-symbol-out-of-scope',
          severity: 'error',
          path: `nodes.${node.id}.${entry.path}`,
          nodeId: node.id,
          symbolId: symbol.id,
          message: `Repeat symbol ${symbol.name} is not available at node ${node.id}`,
        });
      }
      if (symbol.valueShape && reference.path.length > 0) {
        const result = shapeAtPath(symbol.valueShape, reference.path);
        if (result.error) {
          diagnostics.push({
            code: 'invalid-reference-path',
            severity: 'error',
            path: `nodes.${node.id}.${entry.path}`,
            nodeId: node.id,
            symbolId: symbol.id,
            message: `Invalid ${symbol.name} reference: ${result.error}`,
          });
        }
      }
    }
  }
}

function childIds(node: UiNode): readonly string[] {
  switch (node.kind) {
    case 'element':
      return Object.values(node.slots).flat();
    case 'fragment':
    case 'repeat':
      return node.children;
    case 'if':
      return [...node.whenTrue, ...node.whenFalse];
    case 'slot':
      return node.fallback;
    case 'text':
    case 'expression':
      return [];
  }
}

function repeatScopes(document: UiDocument): ReadonlyMap<string, ReadonlySet<string>> {
  const scopes = new Map<string, ReadonlySet<string>>();
  const pending: Array<{ nodeId: string; symbols: ReadonlySet<string> }> = [
    { nodeId: document.rootNodeId, symbols: new Set() },
  ];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || scopes.has(entry.nodeId)) continue;
    scopes.set(entry.nodeId, entry.symbols);
    const node = document.nodes[entry.nodeId];
    if (!node) continue;
    const childSymbols =
      node.kind === 'repeat'
        ? new Set([...entry.symbols, node.itemSymbolId, node.indexSymbolId])
        : entry.symbols;
    for (const childId of childIds(node)) {
      pending.push({ nodeId: childId, symbols: childSymbols });
    }
  }

  return scopes;
}

function effectiveSymbols(document: UiDocument): Record<string, SymbolDeclaration> {
  const propShapes = new Map<string, ValueShape>();
  for (const prop of Object.values(document.publicProps)) {
    if (prop.valueShape) propShapes.set(prop.symbolId, prop.valueShape);
  }
  const result: Record<string, SymbolDeclaration> = {};
  for (const [id, symbol] of Object.entries(document.symbols)) {
    const valueShape = symbol.valueShape ?? propShapes.get(id);
    result[id] = valueShape && !symbol.valueShape ? { ...symbol, valueShape } : symbol;
  }
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'repeat') continue;
    const sourceShape = expressionValueShape(node.source, result);
    const itemSymbol = result[node.itemSymbolId];
    if (sourceShape?.kind !== 'array' || !itemSymbol || itemSymbol.valueShape) continue;
    result[node.itemSymbolId] = {
      ...itemSymbol,
      valueType:
        itemSymbol.valueType === 'unknown'
          ? shapeValueType(sourceShape.item)
          : itemSymbol.valueType,
      valueShape: sourceShape.item,
    };
  }
  return result;
}

export function analyzeDocument<TImplementation>(
  document: UiDocument,
  registry: ComponentRegistry<TImplementation>,
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const symbols = effectiveSymbols(document);
  const scopes = repeatScopes(document);

  const shapeMatchesValueType = (shape: ValueShape, valueType: ValueType): boolean =>
    valueType === 'unknown' || shape.kind === valueType;

  const serializedMatch = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);
  const signaturesMatch = (
    left: SymbolDeclaration['eventSignature'],
    right: SymbolDeclaration['eventSignature'],
  ): boolean => serializedMatch(left ?? { payload: null }, right ?? { payload: null });

  for (const prop of Object.values(document.publicProps)) {
    const symbol = document.symbols[prop.symbolId];
    if (
      !symbol ||
      symbol.name !== prop.name ||
      symbol.valueType !== prop.valueType ||
      symbol.required !== prop.required ||
      symbol.provider !== (prop.valueType === 'event' ? 'event' : 'prop') ||
      !serializedMatch(symbol.valueShape, prop.valueShape) ||
      !serializedMatch(symbol.defaultValue, prop.defaultValue) ||
      !signaturesMatch(symbol.eventSignature, prop.eventSignature)
    ) {
      diagnostics.push({
        code: 'public-prop-symbol-mismatch',
        severity: 'error',
        path: `publicProps.${prop.name}`,
        symbolId: prop.symbolId,
        message: `Public prop ${prop.name} is not synchronized with its canonical symbol`,
      });
    }
    if (prop.valueShape && !shapeMatchesValueType(prop.valueShape, prop.valueType)) {
      diagnostics.push({
        code: 'value-shape-mismatch',
        severity: 'error',
        path: `publicProps.${prop.name}.valueShape`,
        symbolId: prop.symbolId,
        message: `Public prop ${prop.name} has a ${prop.valueShape.kind} shape but is declared as ${prop.valueType}`,
      });
    }
    if (prop.eventSignature && prop.valueType !== 'event') {
      diagnostics.push({
        code: 'event-signature-mismatch',
        severity: 'error',
        path: `publicProps.${prop.name}.eventSignature`,
        symbolId: prop.symbolId,
        message: `Data prop ${prop.name} cannot declare an event signature`,
      });
    }
    if (prop.valueType === 'event' && (prop.valueShape || prop.defaultValue !== undefined)) {
      diagnostics.push({
        code: 'event-signature-mismatch',
        severity: 'error',
        path: `publicProps.${prop.name}`,
        symbolId: prop.symbolId,
        message: `Event prop ${prop.name} cannot define a design value or data shape`,
      });
    }
  }

  for (const symbol of Object.values(document.symbols)) {
    if (symbol.valueShape && !shapeMatchesValueType(symbol.valueShape, symbol.valueType)) {
      diagnostics.push({
        code: 'value-shape-mismatch',
        severity: 'error',
        path: `symbols.${symbol.id}.valueShape`,
        symbolId: symbol.id,
        message: `Symbol ${symbol.name} has a ${symbol.valueShape.kind} shape but is declared as ${symbol.valueType}`,
      });
    }
    if (symbol.eventSignature && symbol.valueType !== 'event') {
      diagnostics.push({
        code: 'event-signature-mismatch',
        severity: 'error',
        path: `symbols.${symbol.id}.eventSignature`,
        symbolId: symbol.id,
        message: `Data symbol ${symbol.name} cannot declare an event signature`,
      });
    }
    if (symbol.valueType === 'event' && (symbol.valueShape || symbol.defaultValue !== undefined)) {
      diagnostics.push({
        code: 'event-signature-mismatch',
        severity: 'error',
        path: `symbols.${symbol.id}`,
        symbolId: symbol.id,
        message: `Event symbol ${symbol.name} cannot define a design value or data shape`,
      });
    }
  }

  for (const node of Object.values(document.nodes)) {
    pushReferenceDiagnostics(diagnostics, node, symbols, scopes.get(node.id) ?? new Set());

    if (node.kind === 'if') {
      const conditionType = inferExpressionType(node.condition, symbols);
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
      const sourceType = inferExpressionType(node.source, symbols);
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

    for (const [propName, instanceSpec] of Object.entries(node.instanceProps ?? {})) {
      const nameError = instancePropNameError(propName);
      if (nameError) {
        diagnostics.push({
          code: 'unsafe-instance-prop',
          severity: 'error',
          path: `nodes.${node.id}.instanceProps.${propName}`,
          nodeId: node.id,
          message: nameError,
        });
      }
      if (manifest.props[propName]) {
        diagnostics.push({
          code: 'instance-prop-conflict',
          severity: 'error',
          path: `nodes.${node.id}.instanceProps.${propName}`,
          nodeId: node.id,
          message: `Instance prop ${propName} conflicts with the registered ${node.componentId} prop`,
        });
      }
      if (!instancePropShapeMatchesType(instanceSpec)) {
        diagnostics.push({
          code: 'value-shape-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.instanceProps.${propName}.valueShape`,
          nodeId: node.id,
          message: `Instance prop ${propName} has a ${instanceSpec.valueShape?.kind ?? 'missing'} shape but is declared as ${instanceSpec.type}`,
        });
      }
    }

    for (const [propName, expression] of Object.entries(node.props)) {
      const instanceSpec = node.instanceProps?.[propName];
      const spec = effectivePropSpec(manifest.props[propName], instanceSpec);
      if (!spec) {
        diagnostics.push({
          code: instancePropNameError(propName) ? 'unsafe-instance-prop' : 'unknown-prop',
          severity: 'error',
          path: `nodes.${node.id}.props.${propName}`,
          nodeId: node.id,
          message:
            instancePropNameError(propName) ??
            `Component ${node.componentId} has no prop named ${propName}; declare it as an instance prop first`,
        });
        continue;
      }
      const sourceType = inferExpressionType(expression, symbols);
      const colorLiteral =
        spec.type === 'color' &&
        expression.kind === 'literal' &&
        typeof expression.value === 'string';
      if (sourceType !== 'unknown' && !colorLiteral && !isTypeAssignable(sourceType, spec.type)) {
        diagnostics.push({
          code: 'prop-type-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.props.${propName}`,
          nodeId: node.id,
          message: `Prop ${propName} expects ${spec.type}, received ${sourceType}`,
        });
      } else if (
        instanceSpec?.valueShape &&
        !expressionMatchesValueShape(expression, symbols, instanceSpec.valueShape)
      ) {
        diagnostics.push({
          code: 'value-shape-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.props.${propName}`,
          nodeId: node.id,
          message: `Prop ${propName} does not match its declared ${instanceSpec.valueShape.kind} shape`,
        });
      }
    }

    const requiredPropSpecs: Record<string, EffectivePropSpec> = {
      ...(node.instanceProps ?? {}),
      ...manifest.props,
    };
    for (const [propName, spec] of Object.entries(requiredPropSpecs)) {
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

    for (const [eventName, instanceSpec] of Object.entries(node.instanceEvents ?? {})) {
      if (!isApprovedInstanceEventSpec(eventName, instanceSpec)) {
        diagnostics.push({
          code: 'invalid-instance-event',
          severity: 'error',
          path: `nodes.${node.id}.instanceEvents.${eventName}`,
          nodeId: node.id,
          message: `Event ${eventName} is not an approved normalized instance event port`,
        });
      }
      if (manifest.events[eventName]) {
        diagnostics.push({
          code: 'instance-event-conflict',
          severity: 'error',
          path: `nodes.${node.id}.instanceEvents.${eventName}`,
          nodeId: node.id,
          message: `Instance event ${eventName} conflicts with the registered ${node.componentId} event`,
        });
      }
    }

    for (const [eventName, expression] of Object.entries(node.events)) {
      const eventSpec = effectiveEventSpec(
        manifest.events[eventName],
        node.instanceEvents?.[eventName],
      );
      if (!eventSpec) {
        diagnostics.push({
          code: 'unknown-event',
          severity: 'error',
          path: `nodes.${node.id}.events.${eventName}`,
          nodeId: node.id,
          message: `Component ${node.componentId} has no event named ${eventName}`,
        });
        continue;
      }
      const sourceType = inferExpressionType(expression, symbols);
      if (expression.kind !== 'reference' || expression.path.length > 0 || sourceType !== 'event') {
        diagnostics.push({
          code: 'event-type-mismatch',
          severity: 'error',
          path: `nodes.${node.id}.events.${eventName}`,
          nodeId: node.id,
          message: `Event ${eventName} expects an event callback, received ${sourceType}`,
        });
        continue;
      }
      const symbol = symbols[expression.symbolId];
      const receiverSignature = symbol?.eventSignature ?? { payload: null };
      const argument = node.eventArguments?.[eventName];
      if (receiverSignature.payload === null) {
        if (argument !== undefined) {
          diagnostics.push({
            code: 'event-argument-mismatch',
            severity: 'error',
            path: `nodes.${node.id}.eventArguments.${eventName}`,
            nodeId: node.id,
            symbolId: expression.symbolId,
            message: `Event ${eventName} cannot pass an argument to no-payload callback ${symbol?.name ?? expression.symbolId}`,
          });
        }
        continue;
      }

      if (argument?.kind === 'expression') {
        if (
          !expressionMatchesValueShape(
            argument.expression,
            symbols,
            receiverSignature.payload.shape,
          )
        ) {
          diagnostics.push({
            code: 'event-argument-mismatch',
            severity: 'error',
            path: `nodes.${node.id}.eventArguments.${eventName}`,
            nodeId: node.id,
            symbolId: expression.symbolId,
            message: `Event ${eventName} argument is incompatible with ${symbol?.name ?? expression.symbolId} (${receiverSignature.payload.shape.kind} expected)`,
          });
        }
        continue;
      }

      // An absent argument is the version-1 legacy representation of
      // normalized payload passthrough. New bindings persist eventPayload.
      if (!isEventSignatureAssignable(eventSpec.signature, receiverSignature)) {
        diagnostics.push({
          code:
            argument?.kind === 'eventPayload'
              ? 'event-argument-mismatch'
              : 'event-signature-mismatch',
          severity: 'error',
          path:
            argument?.kind === 'eventPayload'
              ? `nodes.${node.id}.eventArguments.${eventName}`
              : `nodes.${node.id}.events.${eventName}`,
          nodeId: node.id,
          symbolId: expression.symbolId,
          message: `Event ${eventName} payload is incompatible with ${symbol?.name ?? expression.symbolId}`,
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
      `Invalid Srijika document semantics: ${errors
        .slice(0, 5)
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join('; ')}`,
    );
  }
}
