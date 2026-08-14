import {
  Box,
  Braces,
  ChevronDown,
  Link2,
  MousePointerClick,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import {
  isEventSignatureAssignable,
  isTypeAssignable,
  isValueDeclarationAssignableToShape,
  literalMatchesValueShape,
  type EventSpec,
  type PropSpec,
} from '@srijika/component-registry';
import {
  NORMALIZED_INSTANCE_EVENT_PORTS,
  createInstanceEventSpec,
  instancePropNameError,
} from '@srijika/contracts';
import type {
  ElementNode,
  EventArgumentMapping,
  EventSignature,
  IfNode,
  LengthValue,
  LiteralValue,
  PublicProp,
  RepeatNode,
  StyleProperties,
  SymbolDeclaration,
  UiDocument,
  ValueExpression,
  ValueShape,
  ValueType,
  InstancePropSpec,
  InstancePropValueType,
} from '@srijika/contracts';
import { deriveParentIndex } from '@srijika/document-engine';

import { componentRegistry } from '../lib/registry';
import { useStudioStore } from '../store/studio-store';

const tabs = [
  { id: 'design' as const, label: 'Design', icon: SlidersHorizontal },
  { id: 'props' as const, label: 'Props', icon: Braces },
  { id: 'events' as const, label: 'Events', icon: MousePointerClick },
];

function literalValue(expression: ValueExpression | undefined): string | number | boolean | null {
  if (expression?.kind !== 'literal') return null;
  return typeof expression.value === 'string' ||
    typeof expression.value === 'number' ||
    typeof expression.value === 'boolean'
    ? expression.value
    : null;
}

function LengthEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LengthValue | undefined;
  onChange: (value: LengthValue) => void;
}) {
  const mode = value?.mode === 'fixed' ? value.unit : (value?.mode ?? 'auto');
  const numeric = value?.mode === 'fixed' || value?.mode === 'percent' ? value.value : 0;
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="length-control">
        {(mode === 'px' || mode === 'rem' || mode === 'percent') && (
          <input
            aria-label={`${label} value`}
            type="number"
            min={0}
            value={numeric}
            onChange={(event) =>
              onChange(
                mode === 'px' || mode === 'rem'
                  ? { mode: 'fixed', value: Number(event.target.value), unit: mode }
                  : { mode: 'percent', value: Number(event.target.value) },
              )
            }
          />
        )}
        <select
          aria-label={`${label} sizing mode`}
          value={mode}
          onChange={(event) => {
            const nextMode = event.target.value;
            if (nextMode === 'px' || nextMode === 'rem') {
              onChange({ mode: 'fixed', value: nextMode === 'px' ? 320 : 20, unit: nextMode });
            } else if (nextMode === 'percent') onChange({ mode: 'percent', value: 100 });
            else onChange({ mode: nextMode as 'auto' | 'hug' | 'fill' });
          }}
        >
          <option value="auto">Auto</option>
          <option value="hug">Hug</option>
          <option value="fill">Fill</option>
          <option value="px">px</option>
          <option value="rem">rem</option>
          <option value="percent">%</option>
        </select>
      </div>
    </div>
  );
}

function LiteralControl({
  spec,
  expression,
  onChange,
}: {
  spec: PropSpec;
  expression: ValueExpression | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  const defaultValue = spec.defaultValue;
  const primitiveDefault =
    typeof defaultValue === 'string' ||
    typeof defaultValue === 'number' ||
    typeof defaultValue === 'boolean'
      ? defaultValue
      : '';
  const value = literalValue(expression) ?? primitiveDefault;
  if (spec.control === 'toggle') {
    return (
      <button
        className={value === true ? 'toggle is-on' : 'toggle'}
        type="button"
        role="switch"
        aria-label={spec.displayName}
        aria-checked={value === true}
        onClick={() => onChange(value !== true)}
      >
        <span />
      </button>
    );
  }
  if (spec.control === 'select') {
    return (
      <select
        aria-label={spec.displayName}
        value={String(value)}
        onChange={(event) =>
          onChange(spec.type === 'number' ? Number(event.target.value) : event.target.value)
        }
      >
        {spec.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (spec.control === 'number') {
    return (
      <input
        aria-label={spec.displayName}
        type="number"
        value={Number(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }
  if (spec.control === 'textarea') {
    return (
      <textarea
        aria-label={spec.displayName}
        value={String(value)}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      aria-label={spec.displayName}
      type="text"
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

interface BindingChoice {
  key: string;
  label: string;
  path: string[];
  symbolId: string;
  valueType: ValueType;
}

function shapeType(shape: ValueShape): ValueType {
  return shape.kind;
}

function shapeAtPath(shape: ValueShape, path: readonly string[]): ValueShape | undefined {
  let current = shape;
  for (const segment of path) {
    if (current.kind === 'object') {
      const field = current.fields[segment];
      if (!field) return undefined;
      current = field.shape;
    } else if (current.kind === 'array' && /^(?:0|[1-9][0-9]*)$/.test(segment)) {
      current = current.item;
    } else {
      return undefined;
    }
  }
  return current;
}

function repeatItemShape(document: UiDocument, symbol: SymbolDeclaration): ValueShape | undefined {
  if (symbol.provider !== 'repeatItem') return symbol.valueShape;
  const repeat = Object.values(document.nodes).find(
    (node): node is RepeatNode => node.kind === 'repeat' && node.itemSymbolId === symbol.id,
  );
  if (!repeat || repeat.source.kind !== 'reference') return symbol.valueShape;
  const source = document.symbols[repeat.source.symbolId];
  if (!source?.valueShape) return symbol.valueShape;
  const sourceShape = shapeAtPath(source.valueShape, repeat.source.path);
  return sourceShape?.kind === 'array' ? sourceShape.item : symbol.valueShape;
}

function symbolsVisibleAtNode(document: UiDocument, nodeId: string): SymbolDeclaration[] {
  const repeatScope = new Set<string>();
  const parents = deriveParentIndex(document);
  let currentId = nodeId;
  while (currentId !== document.rootNodeId) {
    const parentLocation = parents.get(currentId);
    if (!parentLocation) break;
    const parent = document.nodes[parentLocation.parentId];
    if (parent?.kind === 'repeat') {
      repeatScope.add(parent.itemSymbolId);
      repeatScope.add(parent.indexSymbolId);
    }
    currentId = parentLocation.parentId;
  }

  return Object.values(document.symbols).filter(
    (symbol) =>
      (symbol.provider !== 'repeatItem' && symbol.provider !== 'repeatIndex') ||
      repeatScope.has(symbol.id),
  );
}

function nestedShapeChoices(
  symbol: SymbolDeclaration,
  shape: ValueShape,
  path: readonly string[] = [],
): BindingChoice[] {
  const serializedPath = [...path];
  const currentChoice: BindingChoice[] =
    path.length > 0
      ? [
          {
            key: JSON.stringify([symbol.id, serializedPath]),
            label: `${symbol.name}.${path.join('.')}`,
            path: serializedPath,
            symbolId: symbol.id,
            valueType: shapeType(shape),
          },
        ]
      : [];
  if (shape.kind === 'object') {
    return [
      ...currentChoice,
      ...Object.entries(shape.fields).flatMap(([name, field]) =>
        nestedShapeChoices(symbol, field.shape, [...path, name]),
      ),
    ];
  }
  return currentChoice;
}

function bindingChoices(
  document: UiDocument,
  nodeId: string,
  expectedType: ValueType,
): BindingChoice[] {
  return symbolsVisibleAtNode(document, nodeId)
    .filter((symbol) => symbol.provider !== 'event')
    .flatMap((symbol) => {
      const shape = repeatItemShape(document, symbol) ?? symbol.valueShape;
      const effectiveType = shape ? shapeType(shape) : symbol.valueType;
      const choices: BindingChoice[] = [];
      if (isTypeAssignable(effectiveType, expectedType)) {
        choices.push({
          key: symbol.id,
          label: symbol.name,
          path: [],
          symbolId: symbol.id,
          valueType: effectiveType,
        });
      }
      if (shape?.kind === 'object') choices.push(...nestedShapeChoices(symbol, shape));
      return choices.filter((choice) => isTypeAssignable(choice.valueType, expectedType));
    });
}

function decodeBindingKey(key: string): { path: string[]; symbolId: string } {
  if (!key.startsWith('[')) return { symbolId: key, path: [] };
  const [symbolId, path] = JSON.parse(key) as [string, string[]];
  return { symbolId, path };
}

function referenceOptionValue(expression: ValueExpression): string | null {
  if (expression.kind === 'reference') {
    const key = expression.path.length
      ? JSON.stringify([expression.symbolId, expression.path])
      : expression.symbolId;
    return `reference:${key}`;
  }
  if (expression.kind === 'unary' && expression.operand.kind === 'reference') {
    const key = expression.operand.path.length
      ? JSON.stringify([expression.operand.symbolId, expression.operand.path])
      : expression.operand.symbolId;
    return `not:${key}`;
  }
  return null;
}

function expressionFromReferenceOption(value: string): ValueExpression {
  const negated = value.startsWith('not:');
  const key = value.slice(negated ? 4 : 'reference:'.length);
  const binding = decodeBindingKey(key);
  const reference: ValueExpression = { kind: 'reference', ...binding };
  return negated ? { kind: 'unary', operator: 'not', operand: reference } : reference;
}

const instancePropTypes: readonly InstancePropValueType[] = [
  'string',
  'number',
  'boolean',
  'color',
  'object',
  'array',
  'unknown',
];

function instancePropDefault(type: InstancePropValueType): LiteralValue {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'object') return {};
  if (type === 'array') return [];
  if (type === 'unknown') return null;
  return '';
}

function instancePropShape(type: InstancePropValueType): ValueShape | undefined {
  if (type === 'object') return { kind: 'object', fields: {}, additionalProperties: true };
  if (type === 'array') return { kind: 'array', item: { kind: 'unknown' } };
  return undefined;
}

function inspectorSpecForInstance(spec: InstancePropSpec): PropSpec {
  const control: PropSpec['control'] =
    spec.type === 'boolean'
      ? 'toggle'
      : spec.type === 'number'
        ? 'number'
        : spec.type === 'object' || spec.type === 'array' || spec.type === 'unknown'
          ? 'textarea'
          : 'text';
  return {
    type: spec.type,
    displayName: spec.displayName,
    required: spec.required,
    bindable: true,
    control,
  };
}

function StructuredInstancePropControl({
  label,
  type,
  expression,
  onApply,
}: {
  label: string;
  type: 'object' | 'array' | 'unknown';
  expression: ValueExpression | undefined;
  onApply: (value: LiteralValue) => void;
}) {
  const initialValue =
    expression?.kind === 'literal' ? expression.value : instancePropDefault(type);
  const [draft, setDraft] = useState(() => JSON.stringify(initialValue, null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="structured-instance-prop">
      <textarea
        aria-label={`${label} JSON value`}
        rows={4}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="small-action-button"
        type="button"
        onClick={() => {
          try {
            const parsed: unknown = JSON.parse(draft);
            if (
              type === 'object' &&
              (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            ) {
              throw new Error('Enter a JSON object.');
            }
            if (type === 'array' && !Array.isArray(parsed)) throw new Error('Enter a JSON array.');
            onApply(parsed as LiteralValue);
            setError(null);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Enter valid JSON.');
          }
        }}
      >
        Apply JSON
      </button>
    </div>
  );
}

function PropEditor({ node }: { node: ElementNode }) {
  const document = useStudioStore((state) => state.document);
  const setLiteralProp = useStudioStore((state) => state.setLiteralProp);
  const setPropExpression = useStudioStore((state) => state.setPropExpression);
  const bindProp = useStudioStore((state) => state.bindProp);
  const addInstanceProp = useStudioStore((state) => state.addInstanceProp);
  const updateInstanceProp = useStudioStore((state) => state.updateInstanceProp);
  const removeInstanceProp = useStudioStore((state) => state.removeInstanceProp);
  const manifest = componentRegistry.require(node.componentId).manifest;
  const [newPropName, setNewPropName] = useState('');
  const [newPropType, setNewPropType] = useState<InstancePropValueType>('string');
  const normalizedNewPropName = newPropName.trim();
  const nameError =
    (normalizedNewPropName ? instancePropNameError(normalizedNewPropName) : null) ??
    (manifest.props[normalizedNewPropName]
      ? `${normalizedNewPropName} is already a built-in component prop`
      : node.instanceProps?.[normalizedNewPropName]
        ? `${normalizedNewPropName} already exists on this component`
        : null);
  const propEntries: Array<{
    propName: string;
    spec: PropSpec;
    instanceSpec?: InstancePropSpec;
  }> = [
    ...Object.entries(manifest.props).map(([propName, spec]) => ({ propName, spec })),
    ...Object.entries(node.instanceProps ?? {}).map(([propName, instanceSpec]) => ({
      propName,
      spec: inspectorSpecForInstance(instanceSpec),
      instanceSpec,
    })),
  ];

  return (
    <section className="inspector-section">
      <header>
        <span>Component props</span>
        <ChevronDown size={14} />
      </header>
      <div className="inspector-fields">
        {propEntries.map(({ propName, spec, instanceSpec }) => {
          const expression = node.props[propName];
          const supportsLiteral =
            spec.type === 'string' ||
            spec.type === 'number' ||
            spec.type === 'boolean' ||
            spec.type === 'color';
          const supportsStructuredLiteral =
            instanceSpec !== undefined &&
            (spec.type === 'object' || spec.type === 'array' || spec.type === 'unknown');
          const choices = bindingChoices(document, node.id, spec.type);
          const hasOpaqueExpression =
            expression !== undefined &&
            expression.kind !== 'literal' &&
            expression.kind !== 'reference';
          const selectedSource =
            expression?.kind === 'reference'
              ? expression.path.length === 0
                ? expression.symbolId
                : JSON.stringify([expression.symbolId, expression.path])
              : hasOpaqueExpression
                ? 'current-expression'
                : 'literal';
          return (
            <div
              className={instanceSpec ? 'prop-field is-instance-prop' : 'prop-field'}
              key={propName}
            >
              {instanceSpec && (
                <div className="instance-definition">
                  <input
                    aria-label={`Instance prop name ${propName}`}
                    defaultValue={propName}
                    onBlur={(event) => {
                      const nextName = event.currentTarget.value.trim();
                      if (!nextName || nextName === propName) {
                        event.currentTarget.value = propName;
                        return;
                      }
                      updateInstanceProp(node.id, propName, nextName, {
                        ...instanceSpec,
                        displayName: nextName,
                      });
                    }}
                  />
                  <select
                    aria-label={`Instance prop type ${propName}`}
                    value={instanceSpec.type}
                    onChange={(event) => {
                      const nextType = event.target.value as InstancePropValueType;
                      const nextShape = instancePropShape(nextType);
                      updateInstanceProp(
                        node.id,
                        propName,
                        propName,
                        {
                          displayName: instanceSpec.displayName,
                          type: nextType,
                          required: instanceSpec.required,
                          ...(nextShape ? { valueShape: nextShape } : {}),
                        },
                        { kind: 'literal', value: instancePropDefault(nextType) },
                      );
                    }}
                  >
                    {instancePropTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <label className="instance-required-toggle">
                    <input
                      type="checkbox"
                      checked={instanceSpec.required}
                      onChange={(event) =>
                        updateInstanceProp(node.id, propName, propName, {
                          ...instanceSpec,
                          required: event.target.checked,
                        })
                      }
                    />
                    Required
                  </label>
                  <button
                    className="icon-button danger"
                    type="button"
                    aria-label={`Remove instance prop ${propName}`}
                    onClick={() => removeInstanceProp(node.id, propName)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
              <div className="prop-field-heading">
                <label>{spec.displayName}</label>
                {spec.bindable && (
                  <select
                    className="binding-select"
                    aria-label={`${spec.displayName} value source`}
                    value={selectedSource}
                    onChange={(event) => {
                      const source = event.target.value;
                      if (source === 'literal') {
                        if (supportsLiteral) {
                          setLiteralProp(
                            node.id,
                            propName,
                            instanceSpec
                              ? (instancePropDefault(instanceSpec.type) as
                                  string | number | boolean)
                              : ((spec.defaultValue as string | number | boolean | undefined) ??
                                  ''),
                          );
                        } else if (supportsStructuredLiteral && instanceSpec) {
                          setPropExpression(node.id, propName, {
                            kind: 'literal',
                            value: instancePropDefault(instanceSpec.type),
                          });
                        } else {
                          bindProp(node.id, propName, null);
                        }
                      } else if (source === 'current-expression') {
                        return;
                      } else {
                        if (source.startsWith('[')) {
                          const parsed = JSON.parse(source) as [string, string[]];
                          bindProp(node.id, propName, parsed[0], parsed[1]);
                        } else {
                          bindProp(node.id, propName, source);
                        }
                      }
                    }}
                  >
                    <option value="literal">
                      {supportsLiteral || supportsStructuredLiteral ? 'Literal' : 'Unbound'}
                    </option>
                    {hasOpaqueExpression && (
                      <option value="current-expression">Current expression</option>
                    )}
                    {choices.map((choice) => (
                      <option key={choice.key} value={choice.key}>
                        ↳ {choice.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {expression?.kind === 'reference' ? (
                <div className="bound-value">
                  <Link2 size={13} />
                  {document.symbols[expression.symbolId]?.name ?? expression.symbolId}
                  {expression.path.length > 0 ? `.${expression.path.join('.')}` : ''}
                </div>
              ) : expression && expression.kind !== 'literal' ? (
                <div className="bound-value">
                  <Braces size={13} />
                  {expression.kind} expression
                </div>
              ) : supportsLiteral ? (
                <LiteralControl
                  spec={spec}
                  expression={expression}
                  onChange={(value) => setLiteralProp(node.id, propName, value)}
                />
              ) : supportsStructuredLiteral && instanceSpec ? (
                <StructuredInstancePropControl
                  key={`${propName}:${JSON.stringify(expression)}`}
                  label={instanceSpec.displayName}
                  type={instanceSpec.type as 'object' | 'array' | 'unknown'}
                  expression={expression}
                  onApply={(value) =>
                    setPropExpression(node.id, propName, { kind: 'literal', value })
                  }
                />
              ) : (
                <div className="bound-value is-unbound">
                  <Braces size={13} />
                  Bind a compatible page prop to supply this value.
                </div>
              )}
            </div>
          );
        })}
        {propEntries.length === 0 && (
          <p className="empty-copy">This component has no content props.</p>
        )}
        <div className="add-instance-control">
          <div className="prop-field-heading">
            <label>Add instance prop</label>
            <span className="type-pill">Typed React prop</span>
          </div>
          <div className="add-instance-row">
            <input
              aria-label="New instance prop name"
              placeholder="id, title, aria-label…"
              value={newPropName}
              onChange={(event) => setNewPropName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <select
              aria-label="New instance prop type"
              value={newPropType}
              onChange={(event) => setNewPropType(event.target.value as InstancePropValueType)}
            >
              {instancePropTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button
              className="small-action-button"
              type="button"
              aria-label="Add instance prop"
              disabled={!normalizedNewPropName || Boolean(nameError)}
              onClick={() => {
                const valueShape = instancePropShape(newPropType);
                addInstanceProp(
                  node.id,
                  normalizedNewPropName,
                  {
                    displayName: normalizedNewPropName,
                    type: newPropType,
                    required: false,
                    ...(valueShape ? { valueShape } : {}),
                  },
                  { kind: 'literal', value: instancePropDefault(newPropType) },
                );
                setNewPropName('');
              }}
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {nameError && (
            <p className="field-error" role="alert">
              {nameError}
            </p>
          )}
          <p className="field-help">
            Extra props are stored on this component instance and emitted into JSX. Native events
            are added from the Events tab so browser event objects never cross the connector.
          </p>
        </div>
      </div>
    </section>
  );
}

type SpacingValue = NonNullable<StyleProperties['padding']>;

function OptionalNumberField({
  label,
  value,
  min = 0,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder="Auto"
        value={value ?? ''}
        onChange={(event) => {
          const numericValue =
            event.target.value === '' ? Math.max(min, 0) : Number(event.target.value);
          const nextValue = Math.max(min, numericValue);
          onChange(max === undefined ? nextValue : Math.min(max, nextValue));
        }}
      />
    </div>
  );
}

function SpacingEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SpacingValue | undefined;
  onChange: (value: SpacingValue) => void;
}) {
  const current = value ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  return (
    <div className="spacing-field">
      <div className="spacing-field-heading">
        <span>{label}</span>
        <small>px · T R B L</small>
      </div>
      <div className="spacing-control">
        {sides.map((side) => (
          <label key={side}>
            <span>{side.charAt(0).toUpperCase()}</span>
            <input
              aria-label={`${label} ${side}`}
              type="number"
              min="0"
              value={current[side]}
              onChange={(event) =>
                onChange({ ...current, [side]: Math.max(0, Number(event.target.value)) })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ColorEditor({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = /^#[0-9a-f]{6}$/iu.test(value ?? '') ? value! : fallback;
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="color-control">
        <input
          aria-label={`${label} color picker`}
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          aria-label={`${label} color value`}
          type="text"
          value={value ?? ''}
          placeholder="Transparent"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

type DesignPropertySection =
  'Size' | 'Layout' | 'Spacing' | 'Appearance' | 'Typography' | 'Responsive & reusable';

type DesignStylePropertyDefinition = {
  id: keyof StyleProperties;
  label: string;
  section: Exclude<DesignPropertySection, 'Responsive & reusable'>;
  defaultValue: StyleProperties[keyof StyleProperties];
};

const designPropertySections: readonly DesignPropertySection[] = [
  'Size',
  'Layout',
  'Spacing',
  'Appearance',
  'Typography',
  'Responsive & reusable',
];

const designStylePropertyDefinitions = [
  { id: 'width', label: 'Width', section: 'Size', defaultValue: { mode: 'auto' } },
  { id: 'height', label: 'Height', section: 'Size', defaultValue: { mode: 'auto' } },
  { id: 'minWidth', label: 'Min width', section: 'Size', defaultValue: 0 },
  { id: 'maxWidth', label: 'Max width', section: 'Size', defaultValue: 1200 },
  { id: 'minHeight', label: 'Min height', section: 'Size', defaultValue: 0 },
  { id: 'maxHeight', label: 'Max height', section: 'Size', defaultValue: 720 },
  { id: 'display', label: 'Display', section: 'Layout', defaultValue: 'block' },
  { id: 'flexDirection', label: 'Direction', section: 'Layout', defaultValue: 'column' },
  { id: 'flexWrap', label: 'Wrap', section: 'Layout', defaultValue: 'nowrap' },
  { id: 'flexGrow', label: 'Flex grow', section: 'Layout', defaultValue: 0 },
  { id: 'flexShrink', label: 'Flex shrink', section: 'Layout', defaultValue: 1 },
  { id: 'alignItems', label: 'Align items', section: 'Layout', defaultValue: 'stretch' },
  { id: 'justifyContent', label: 'Justify', section: 'Layout', defaultValue: 'start' },
  { id: 'alignSelf', label: 'Align self', section: 'Layout', defaultValue: 'auto' },
  { id: 'gap', label: 'Gap', section: 'Layout', defaultValue: 16 },
  { id: 'position', label: 'Position', section: 'Layout', defaultValue: 'relative' },
  { id: 'top', label: 'Top', section: 'Layout', defaultValue: 0 },
  { id: 'right', label: 'Right', section: 'Layout', defaultValue: 0 },
  { id: 'bottom', label: 'Bottom', section: 'Layout', defaultValue: 0 },
  { id: 'left', label: 'Left', section: 'Layout', defaultValue: 0 },
  { id: 'zIndex', label: 'Z index', section: 'Layout', defaultValue: 1 },
  {
    id: 'padding',
    label: 'Padding',
    section: 'Spacing',
    defaultValue: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  {
    id: 'margin',
    label: 'Margin',
    section: 'Spacing',
    defaultValue: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  {
    id: 'backgroundColor',
    label: 'Background',
    section: 'Appearance',
    defaultValue: '#ffffff',
  },
  {
    id: 'borderColor',
    label: 'Border',
    section: 'Appearance',
    defaultValue: '#d9d8e2',
  },
  { id: 'borderWidth', label: 'Border width', section: 'Appearance', defaultValue: 1 },
  { id: 'borderRadius', label: 'Radius', section: 'Appearance', defaultValue: 8 },
  {
    id: 'boxShadow',
    label: 'Shadow',
    section: 'Appearance',
    defaultValue: '0 12px 30px rgba(0,0,0,.16)',
  },
  { id: 'opacity', label: 'Opacity', section: 'Appearance', defaultValue: 1 },
  { id: 'cursor', label: 'Cursor', section: 'Appearance', defaultValue: 'auto' },
  { id: 'overflow', label: 'Overflow', section: 'Appearance', defaultValue: 'visible' },
  { id: 'overflowX', label: 'Overflow X', section: 'Appearance', defaultValue: 'visible' },
  { id: 'overflowY', label: 'Overflow Y', section: 'Appearance', defaultValue: 'visible' },
  { id: 'color', label: 'Text', section: 'Typography', defaultValue: '#111827' },
  { id: 'fontSize', label: 'Font size', section: 'Typography', defaultValue: 16 },
  { id: 'fontWeight', label: 'Weight', section: 'Typography', defaultValue: 400 },
  { id: 'fontStyle', label: 'Font style', section: 'Typography', defaultValue: 'normal' },
  { id: 'lineHeight', label: 'Line height', section: 'Typography', defaultValue: 1.5 },
  { id: 'letterSpacing', label: 'Letter spacing', section: 'Typography', defaultValue: 0 },
  { id: 'textAlign', label: 'Text align', section: 'Typography', defaultValue: 'left' },
  {
    id: 'textDecoration',
    label: 'Text decoration',
    section: 'Typography',
    defaultValue: 'none',
  },
  { id: 'whiteSpace', label: 'White space', section: 'Typography', defaultValue: 'normal' },
  { id: 'textOverflow', label: 'Text overflow', section: 'Typography', defaultValue: 'clip' },
  {
    id: 'overflowWrap',
    label: 'Word wrapping',
    section: 'Typography',
    defaultValue: 'normal',
  },
] satisfies readonly DesignStylePropertyDefinition[];

type DesignSettingId = 'classRefs' | 'visibility';

const designSettingDefinitions = [
  { id: 'classRefs', label: 'CSS classes', section: 'Responsive & reusable' },
  { id: 'visibility', label: 'Visibility', section: 'Responsive & reusable' },
] satisfies readonly {
  id: DesignSettingId;
  label: string;
  section: 'Responsive & reusable';
}[];

function DesignPropertyField({
  children,
  label,
  onRemove,
}: {
  children: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="design-property-field">
      <div className="design-property-field-control">{children}</div>
      <button
        className="design-property-remove"
        type="button"
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
        onClick={onRemove}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function StylePropertyControl({
  definition,
  style,
  set,
}: {
  definition: DesignStylePropertyDefinition;
  style: StyleProperties;
  set: <K extends keyof StyleProperties>(property: K, value: StyleProperties[K] | null) => void;
}) {
  switch (definition.id) {
    case 'width':
      return (
        <LengthEditor label="Width" value={style.width} onChange={(value) => set('width', value)} />
      );
    case 'height':
      return (
        <LengthEditor
          label="Height"
          value={style.height}
          onChange={(value) => set('height', value)}
        />
      );
    case 'minWidth':
      return (
        <OptionalNumberField
          label="Min width"
          value={style.minWidth}
          onChange={(value) => set('minWidth', value)}
        />
      );
    case 'maxWidth':
      return (
        <OptionalNumberField
          label="Max width"
          value={style.maxWidth}
          onChange={(value) => set('maxWidth', value)}
        />
      );
    case 'minHeight':
      return (
        <OptionalNumberField
          label="Min height"
          value={style.minHeight}
          onChange={(value) => set('minHeight', value)}
        />
      );
    case 'maxHeight':
      return (
        <OptionalNumberField
          label="Max height"
          value={style.maxHeight}
          onChange={(value) => set('maxHeight', value)}
        />
      );
    case 'display':
      return (
        <div className="field-row">
          <label>Display</label>
          <select
            aria-label="Display mode"
            value={style.display}
            onChange={(event) => set('display', event.target.value as StyleProperties['display'])}
          >
            <option value="block">Block</option>
            <option value="flex">Flex</option>
            <option value="grid">Grid</option>
            <option value="none">None</option>
          </select>
        </div>
      );
    case 'flexDirection':
      return (
        <div className="field-row">
          <label>Direction</label>
          <select
            aria-label="Flex direction"
            value={style.flexDirection}
            onChange={(event) =>
              set('flexDirection', event.target.value as StyleProperties['flexDirection'])
            }
          >
            <option value="row">Row</option>
            <option value="column">Column</option>
          </select>
        </div>
      );
    case 'flexWrap':
      return (
        <div className="field-row">
          <label>Wrap</label>
          <select
            aria-label="Flex wrap"
            value={style.flexWrap}
            onChange={(event) => set('flexWrap', event.target.value as StyleProperties['flexWrap'])}
          >
            <option value="nowrap">No wrap</option>
            <option value="wrap">Wrap</option>
            <option value="wrap-reverse">Reverse wrap</option>
          </select>
        </div>
      );
    case 'flexGrow':
      return (
        <OptionalNumberField
          label="Flex grow"
          value={style.flexGrow}
          onChange={(value) => set('flexGrow', value)}
        />
      );
    case 'flexShrink':
      return (
        <OptionalNumberField
          label="Flex shrink"
          value={style.flexShrink}
          onChange={(value) => set('flexShrink', value)}
        />
      );
    case 'alignItems':
      return (
        <div className="field-row">
          <label>Align</label>
          <select
            aria-label="Align items"
            value={style.alignItems}
            onChange={(event) =>
              set('alignItems', event.target.value as StyleProperties['alignItems'])
            }
          >
            <option value="stretch">Stretch</option>
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
          </select>
        </div>
      );
    case 'justifyContent':
      return (
        <div className="field-row">
          <label>Justify</label>
          <select
            aria-label="Justify content"
            value={style.justifyContent}
            onChange={(event) =>
              set('justifyContent', event.target.value as StyleProperties['justifyContent'])
            }
          >
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
            <option value="space-between">Space between</option>
            <option value="space-around">Space around</option>
            <option value="space-evenly">Space evenly</option>
          </select>
        </div>
      );
    case 'alignSelf':
      return (
        <div className="field-row">
          <label>Align self</label>
          <select
            aria-label="Align self"
            value={style.alignSelf}
            onChange={(event) =>
              set('alignSelf', event.target.value as StyleProperties['alignSelf'])
            }
          >
            <option value="auto">Auto</option>
            <option value="stretch">Stretch</option>
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
          </select>
        </div>
      );
    case 'gap':
      return (
        <OptionalNumberField
          label="Gap"
          value={style.gap}
          onChange={(value) => set('gap', value)}
        />
      );
    case 'position':
      return (
        <div className="field-row">
          <label>Position</label>
          <select
            aria-label="Position"
            value={style.position}
            onChange={(event) => set('position', event.target.value as StyleProperties['position'])}
          >
            <option value="static">Static</option>
            <option value="relative">Relative</option>
            <option value="absolute">Absolute</option>
            <option value="sticky">Sticky</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>
      );
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
    case 'zIndex': {
      const values = {
        top: style.top,
        right: style.right,
        bottom: style.bottom,
        left: style.left,
        zIndex: style.zIndex,
      };
      return (
        <OptionalNumberField
          label={definition.label}
          value={values[definition.id]}
          min={-10000}
          onChange={(value) => set(definition.id, value)}
        />
      );
    }
    case 'padding':
      return (
        <SpacingEditor
          label="Padding"
          value={style.padding}
          onChange={(value) => set('padding', value)}
        />
      );
    case 'margin':
      return (
        <SpacingEditor
          label="Margin"
          value={style.margin}
          onChange={(value) => set('margin', value)}
        />
      );
    case 'backgroundColor':
      return (
        <ColorEditor
          label="Background"
          value={style.backgroundColor}
          fallback="#ffffff"
          onChange={(value) => set('backgroundColor', value)}
        />
      );
    case 'borderColor':
      return (
        <ColorEditor
          label="Border"
          value={style.borderColor}
          fallback="#d9d8e2"
          onChange={(value) => set('borderColor', value)}
        />
      );
    case 'borderWidth':
      return (
        <OptionalNumberField
          label="Border width"
          value={style.borderWidth}
          onChange={(value) => set('borderWidth', value)}
        />
      );
    case 'borderRadius':
      return (
        <OptionalNumberField
          label="Radius"
          value={style.borderRadius}
          onChange={(value) => set('borderRadius', value)}
        />
      );
    case 'boxShadow':
      return (
        <div className="field-row">
          <label>Shadow</label>
          <input
            aria-label="Box shadow"
            type="text"
            value={style.boxShadow}
            placeholder="0 12px 30px rgba(0,0,0,.16)"
            onChange={(event) => set('boxShadow', event.target.value || null)}
          />
        </div>
      );
    case 'opacity':
      return (
        <OptionalNumberField
          label="Opacity"
          value={style.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => set('opacity', value)}
        />
      );
    case 'cursor':
      return (
        <div className="field-row">
          <label>Cursor</label>
          <select
            aria-label="Cursor"
            value={style.cursor}
            onChange={(event) => set('cursor', event.target.value as StyleProperties['cursor'])}
          >
            <option value="auto">Auto</option>
            <option value="default">Default</option>
            <option value="pointer">Pointer</option>
            <option value="text">Text</option>
            <option value="grab">Grab</option>
            <option value="not-allowed">Not allowed</option>
          </select>
        </div>
      );
    case 'overflow':
    case 'overflowX':
    case 'overflowY':
      return (
        <div className="field-row">
          <label>{definition.label}</label>
          <select
            aria-label={definition.label}
            value={style[definition.id]}
            onChange={(event) =>
              set(definition.id, event.target.value as StyleProperties[typeof definition.id])
            }
          >
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
            <option value="auto">Auto</option>
          </select>
        </div>
      );
    case 'color':
      return (
        <ColorEditor
          label="Text"
          value={style.color}
          fallback="#111827"
          onChange={(value) => set('color', value)}
        />
      );
    case 'fontSize':
      return (
        <OptionalNumberField
          label="Font size"
          value={style.fontSize}
          min={1}
          onChange={(value) => set('fontSize', value)}
        />
      );
    case 'fontWeight':
      return (
        <OptionalNumberField
          label="Weight"
          value={style.fontWeight}
          min={100}
          max={900}
          onChange={(value) => set('fontWeight', value)}
        />
      );
    case 'fontStyle':
      return (
        <div className="field-row">
          <label>Font style</label>
          <select
            aria-label="Font style"
            value={style.fontStyle}
            onChange={(event) =>
              set('fontStyle', event.target.value as StyleProperties['fontStyle'])
            }
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
            <option value="oblique">Oblique</option>
          </select>
        </div>
      );
    case 'lineHeight':
      return (
        <OptionalNumberField
          label="Line height"
          value={style.lineHeight}
          min={0}
          step={0.1}
          onChange={(value) => set('lineHeight', value)}
        />
      );
    case 'letterSpacing':
      return (
        <OptionalNumberField
          label="Letter spacing"
          value={style.letterSpacing}
          min={-100}
          step={0.1}
          onChange={(value) => set('letterSpacing', value)}
        />
      );
    case 'textAlign':
      return (
        <div className="field-row">
          <label>Text align</label>
          <select
            aria-label="Text align"
            value={style.textAlign}
            onChange={(event) =>
              set('textAlign', event.target.value as StyleProperties['textAlign'])
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      );
    case 'textDecoration':
      return (
        <div className="field-row">
          <label>Text decoration</label>
          <select
            aria-label="Text decoration"
            value={style.textDecoration}
            onChange={(event) =>
              set('textDecoration', event.target.value as StyleProperties['textDecoration'])
            }
          >
            <option value="none">None</option>
            <option value="underline">Underline</option>
            <option value="line-through">Line through</option>
            <option value="overline">Overline</option>
          </select>
        </div>
      );
    case 'whiteSpace':
      return (
        <div className="field-row">
          <label>White space</label>
          <select
            aria-label="White space"
            value={style.whiteSpace}
            onChange={(event) =>
              set('whiteSpace', event.target.value as StyleProperties['whiteSpace'])
            }
          >
            <option value="normal">Normal</option>
            <option value="nowrap">No wrap</option>
            <option value="pre-wrap">Preserve lines</option>
          </select>
        </div>
      );
    case 'textOverflow':
      return (
        <div className="field-row">
          <label>Text overflow</label>
          <select
            aria-label="Text overflow"
            value={style.textOverflow}
            onChange={(event) =>
              set('textOverflow', event.target.value as StyleProperties['textOverflow'])
            }
          >
            <option value="clip">Clip</option>
            <option value="ellipsis">Ellipsis</option>
          </select>
        </div>
      );
    case 'overflowWrap':
      return (
        <div className="field-row">
          <label>Word wrapping</label>
          <select
            aria-label="Word wrapping"
            value={style.overflowWrap}
            onChange={(event) =>
              set('overflowWrap', event.target.value as StyleProperties['overflowWrap'])
            }
          >
            <option value="normal">Normal</option>
            <option value="break-word">Break word</option>
            <option value="anywhere">Anywhere</option>
          </select>
        </div>
      );
  }
}

function DesignEditor({
  node,
  lockRootSize = false,
}: {
  node: ElementNode;
  lockRootSize?: boolean;
}) {
  const document = useStudioStore((state) => state.document);
  const setStyle = useStudioStore((state) => state.setStyle);
  const setVisibility = useStudioStore((state) => state.setVisibility);
  const setClassRefs = useStudioStore((state) => state.setClassRefs);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');
  const [revealedSettings, setRevealedSettings] = useState<Set<DesignSettingId>>(() => new Set());
  const style = node.style.base;
  const booleanChoices = bindingChoices(document, node.id, 'boolean');
  const hasStyleProperty = (property: keyof StyleProperties): boolean =>
    Object.prototype.hasOwnProperty.call(style, property);
  const isLockedRootDimension = (property: keyof StyleProperties): boolean =>
    lockRootSize && (property === 'width' || property === 'height');
  const set = <K extends keyof StyleProperties>(
    property: K,
    value: StyleProperties[K] | null,
  ): void => setStyle(node.id, property, value);
  const activeStyleDefinitions = designStylePropertyDefinitions.filter(
    (definition) => hasStyleProperty(definition.id) && !isLockedRootDimension(definition.id),
  );
  const visibilityIsUsed = !(node.visible.kind === 'literal' && node.visible.value === true);
  const showClassRefs = node.classRefs.length > 0 || revealedSettings.has('classRefs');
  const showVisibility = visibilityIsUsed || revealedSettings.has('visibility');
  const revealSetting = (setting: DesignSettingId): void =>
    setRevealedSettings((current) => new Set(current).add(setting));
  const hideSetting = (setting: DesignSettingId): void =>
    setRevealedSettings((current) => {
      const next = new Set(current);
      next.delete(setting);
      return next;
    });
  const availableStyleDefinitions = designStylePropertyDefinitions.filter(
    (definition) => !hasStyleProperty(definition.id) && !isLockedRootDimension(definition.id),
  );
  const availableSettingDefinitions = designSettingDefinitions.filter((definition) =>
    definition.id === 'classRefs' ? !showClassRefs : !showVisibility,
  );
  const normalizedSearch = propertySearch.trim().toLocaleLowerCase();
  const availableProperties = [
    ...availableStyleDefinitions.map((definition) => ({ kind: 'style' as const, definition })),
    ...availableSettingDefinitions.map((definition) => ({
      kind: 'setting' as const,
      definition,
    })),
  ].filter(
    ({ definition }) =>
      !normalizedSearch ||
      definition.label.toLocaleLowerCase().includes(normalizedSearch) ||
      definition.section.toLocaleLowerCase().includes(normalizedSearch),
  );
  const usedPropertyCount =
    activeStyleDefinitions.length +
    (lockRootSize ? 2 : 0) +
    (showClassRefs ? 1 : 0) +
    (showVisibility ? 1 : 0);

  return (
    <>
      <section className="design-property-manager" aria-label="Design field manager">
        <div className="design-property-manager-copy">
          <span>{usedPropertyCount} used</span>
          <small>Only properties stored on this layer are shown.</small>
        </div>
        <button
          className="design-property-add"
          type="button"
          aria-label="Add design property"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <Plus size={13} /> Add property
        </button>
        {pickerOpen && (
          <div className="design-property-picker" role="region" aria-label="Design properties">
            <input
              aria-label="Search design properties"
              type="search"
              value={propertySearch}
              placeholder="Search properties"
              onChange={(event) => setPropertySearch(event.target.value)}
            />
            <div className="design-property-options">
              {designPropertySections.map((section) => {
                const properties = availableProperties.filter(
                  ({ definition }) => definition.section === section,
                );
                if (properties.length === 0) return null;
                return (
                  <div className="design-property-option-group" key={section}>
                    <span>{section}</span>
                    <div>
                      {properties.map((property) => (
                        <button
                          key={`${property.kind}:${property.definition.id}`}
                          type="button"
                          aria-label={`Add ${property.definition.label}`}
                          onClick={() => {
                            if (property.kind === 'style') {
                              setStyle(
                                node.id,
                                property.definition.id,
                                property.definition.defaultValue,
                              );
                            } else {
                              revealSetting(property.definition.id);
                            }
                            setPickerOpen(false);
                            setPropertySearch('');
                          }}
                        >
                          <Plus size={11} /> {property.definition.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {availableProperties.length === 0 && (
                <p className="design-property-empty">No matching unused properties.</p>
              )}
            </div>
          </div>
        )}
      </section>

      {designPropertySections.slice(0, 5).map((section) => {
        const definitions = activeStyleDefinitions.filter(
          (definition) => definition.section === section,
        );
        const showLockedSize = section === 'Size' && lockRootSize;
        if (definitions.length === 0 && !showLockedSize) return null;
        return (
          <section className="inspector-section" key={section}>
            <header>
              <span>{section}</span>
              <ChevronDown size={14} />
            </header>
            <div className="inspector-fields">
              {showLockedSize && (
                <div className="locked-root-size" role="note">
                  <span>Width 100%</span>
                  <span>Height 100%</span>
                  <small>The Page return root always fills its design surface.</small>
                </div>
              )}
              {definitions.map((definition) => (
                <DesignPropertyField
                  key={definition.id}
                  label={definition.label}
                  onRemove={() => set(definition.id, null)}
                >
                  <StylePropertyControl definition={definition} style={style} set={set} />
                </DesignPropertyField>
              ))}
            </div>
          </section>
        );
      })}

      {(showClassRefs || showVisibility) && (
        <section className="inspector-section">
          <header>
            <span>Responsive & reusable</span>
            <ChevronDown size={14} />
          </header>
          <div className="inspector-fields">
            {showClassRefs && (
              <DesignPropertyField
                label="CSS classes"
                onRemove={() => {
                  setClassRefs(node.id, []);
                  hideSetting('classRefs');
                }}
              >
                <div className="prop-field">
                  <div className="prop-field-heading">
                    <label>Static CSS classes</label>
                    <span className="type-pill">string[]</span>
                  </div>
                  <input
                    aria-label="CSS class references"
                    type="text"
                    value={node.classRefs.join(', ')}
                    placeholder="hero, card, primary"
                    onChange={(event) => {
                      revealSetting('classRefs');
                      setClassRefs(
                        node.id,
                        event.target.value.split(',').map((value) => value.trim()),
                      );
                    }}
                  />
                  <p className="field-help">
                    Project-provided classes are preserved in JSON and generated JSX.
                  </p>
                </div>
              </DesignPropertyField>
            )}
            {showVisibility && (
              <DesignPropertyField
                label="Visibility"
                onRemove={() => {
                  setVisibility(node.id, { kind: 'literal', value: true });
                  hideSetting('visibility');
                }}
              >
                <div className="field-row">
                  <label>Visible</label>
                  <select
                    aria-label="Visibility expression"
                    value={
                      referenceOptionValue(node.visible) ??
                      (node.visible.kind === 'literal' && node.visible.value === false
                        ? 'false'
                        : 'true')
                    }
                    onChange={(event) => {
                      revealSetting('visibility');
                      const value = event.target.value;
                      if (value === 'true' || value === 'false') {
                        setVisibility(node.id, { kind: 'literal', value: value === 'true' });
                      } else {
                        setVisibility(node.id, expressionFromReferenceOption(value));
                      }
                    }}
                  >
                    <option value="true">Always</option>
                    <option value="false">Hidden</option>
                    {booleanChoices.flatMap((choice) => [
                      <option key={`reference:${choice.key}`} value={`reference:${choice.key}`}>
                        Prop · {choice.label}
                      </option>,
                      <option key={`not:${choice.key}`} value={`not:${choice.key}`}>
                        Not · {choice.label}
                      </option>,
                    ])}
                  </select>
                </div>
              </DesignPropertyField>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function booleanOperandValue(expression: ValueExpression): string {
  const reference = referenceOptionValue(expression);
  if (reference) return reference;
  return expression.kind === 'literal' && expression.value === false ? 'false' : 'true';
}

function BooleanOperandSelect({
  choices,
  expression,
  label,
  onChange,
}: {
  choices: readonly BindingChoice[];
  expression: ValueExpression;
  label: string;
  onChange: (expression: ValueExpression) => void;
}) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <select
        aria-label={label}
        value={booleanOperandValue(expression)}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            value === 'true' || value === 'false'
              ? { kind: 'literal', value: value === 'true' }
              : expressionFromReferenceOption(value),
          );
        }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
        {choices.flatMap((choice) => [
          <option key={`reference:${choice.key}`} value={`reference:${choice.key}`}>
            props.{choice.label}
          </option>,
          <option key={`not:${choice.key}`} value={`not:${choice.key}`}>
            !props.{choice.label}
          </option>,
        ])}
      </select>
    </div>
  );
}

function ConditionEditor({ node }: { node: IfNode }) {
  const document = useStudioStore((state) => state.document);
  const activeBranch = useStudioStore((state) => state.activeIfBranches[node.id] ?? 'whenTrue');
  const setActiveIfBranch = useStudioStore((state) => state.setActiveIfBranch);
  const setIfCondition = useStudioStore((state) => state.setIfCondition);
  const expression = node.condition;
  const mode =
    expression.kind === 'binary' && (expression.operator === 'and' || expression.operator === 'or')
      ? expression.operator
      : (referenceOptionValue(expression) ??
        (expression.kind === 'literal' && expression.value === false ? 'false' : 'true'));
  const booleanChoices = bindingChoices(document, node.id, 'boolean');

  return (
    <section className="inspector-section">
      <header>
        <span>Condition expression</span>
        <span className="type-pill">boolean</span>
      </header>
      <div className="inspector-fields">
        <div className="branch-switch" aria-label="Branch being designed">
          <button
            className={activeBranch === 'whenTrue' ? 'is-active' : ''}
            type="button"
            onClick={() => setActiveIfBranch(node.id, 'whenTrue')}
          >
            True branch · {node.whenTrue.length}
          </button>
          <button
            className={activeBranch === 'whenFalse' ? 'is-active' : ''}
            type="button"
            onClick={() => setActiveIfBranch(node.id, 'whenFalse')}
          >
            False branch · {node.whenFalse.length}
          </button>
        </div>
        <div className="prop-field">
          <label className="control-label">Expression source</label>
          <select
            aria-label="Condition expression source"
            value={mode}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'true' || value === 'false') {
                setIfCondition(node.id, { kind: 'literal', value: value === 'true' });
              } else if (value === 'and' || value === 'or') {
                const first = booleanChoices[0];
                const second = booleanChoices[1];
                setIfCondition(node.id, {
                  kind: 'binary',
                  operator: value,
                  left: first
                    ? expressionFromReferenceOption(`reference:${first.key}`)
                    : { kind: 'literal', value: true },
                  right: second
                    ? expressionFromReferenceOption(`reference:${second.key}`)
                    : { kind: 'literal', value: true },
                });
              } else {
                setIfCondition(node.id, expressionFromReferenceOption(value));
              }
            }}
          >
            <option value="true">Literal · true branch</option>
            <option value="false">Literal · false branch</option>
            <option value="and">All conditions · AND</option>
            <option value="or">Any condition · OR</option>
            {booleanChoices.flatMap((choice) => [
              <option key={`reference:${choice.key}`} value={`reference:${choice.key}`}>
                Prop · {choice.label}
              </option>,
              <option key={`not:${choice.key}`} value={`not:${choice.key}`}>
                Not · {choice.label}
              </option>,
            ])}
          </select>
        </div>
        {expression.kind === 'binary' &&
          (expression.operator === 'and' || expression.operator === 'or') && (
            <div className="boolean-operands">
              <BooleanOperandSelect
                label="First condition"
                expression={expression.left}
                choices={booleanChoices}
                onChange={(left) => setIfCondition(node.id, { ...expression, left })}
              />
              <BooleanOperandSelect
                label="Second condition"
                expression={expression.right}
                choices={booleanChoices}
                onChange={(right) => setIfCondition(node.id, { ...expression, right })}
              />
            </div>
          )}
        <p className="field-help">
          The design branch is editor-only state; it never changes the runtime condition. Drops
          enter the branch currently shown.
        </p>
      </div>
    </section>
  );
}

function RepeatEditor({ node }: { node: RepeatNode }) {
  const document = useStudioStore((state) => state.document);
  const setRepeatSource = useStudioStore((state) => state.setRepeatSource);
  const expression = node.source;
  const mode = referenceOptionValue(expression) ?? 'empty';
  const sourceChoices = bindingChoices(document, node.id, 'array');

  return (
    <section className="inspector-section">
      <header>
        <span>Collection expression</span>
        <span className="type-pill">unknown[]</span>
      </header>
      <div className="inspector-fields">
        <div className="prop-field">
          <label className="control-label">Items source</label>
          <select
            aria-label="Repeat collection source"
            value={mode}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'empty') setRepeatSource(node.id, { kind: 'literal', value: null });
              else {
                setRepeatSource(node.id, expressionFromReferenceOption(value));
              }
            }}
          >
            <option value="empty">No collection</option>
            {sourceChoices.map((choice) => (
              <option key={choice.key} value={`reference:${choice.key}`}>
                Prop · {choice.label} ({choice.valueType})
              </option>
            ))}
          </select>
        </div>
        <div className="symbol-pair">
          <span>item → {document.symbols[node.itemSymbolId]?.name ?? node.itemSymbolId}</span>
          <span>index → {document.symbols[node.indexSymbolId]?.name ?? node.indexSymbolId}</span>
        </div>
      </div>
    </section>
  );
}

function defaultLiteralForShape(shape: ValueShape): LiteralValue {
  switch (shape.kind) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'color':
      return '#000000';
    case 'array':
      return [];
    case 'object':
      return Object.fromEntries(
        Object.entries(shape.fields)
          .filter(([, field]) => field.required)
          .map(([name, field]) => [name, defaultLiteralForShape(field.shape)]),
      );
    case 'unknown':
      return null;
  }
}

function NumberLiteralArgument({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? String(value);
  const parsed = Number(displayedValue);
  const invalid = displayedValue.trim() === '' || !Number.isFinite(parsed);

  return (
    <>
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        type="number"
        step="any"
        value={displayedValue}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const number = Number(next);
          if (next.trim() && Number.isFinite(number)) onChange(number);
        }}
        onBlur={() => {
          if (!invalid) setDraft(null);
        }}
      />
      {invalid && (
        <p className="event-argument-error" role="alert">
          Enter a finite number.
        </p>
      )}
    </>
  );
}

function StructuredLiteralArgument({
  label,
  shape,
  value,
  onChange,
}: {
  label: string;
  shape: ValueShape;
  value: LiteralValue;
  onChange: (value: LiteralValue) => void;
}) {
  const serialized = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    let parsed: LiteralValue;
    try {
      parsed = JSON.parse(draft) as LiteralValue;
    } catch {
      setError('Enter valid JSON before applying this argument.');
      return;
    }
    if (!literalMatchesValueShape(parsed, shape)) {
      setError(`The JSON value must match the ${shape.kind} payload shape.`);
      return;
    }
    setError(null);
    onChange(parsed);
  };

  return (
    <div className="event-argument-structured">
      <textarea
        aria-label={label}
        aria-invalid={Boolean(error) || undefined}
        rows={4}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error && (
        <p className="event-argument-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" aria-label={`Apply ${label}`} onClick={apply}>
        Apply
      </button>
    </div>
  );
}

function LiteralArgumentControl({
  eventDisplayName,
  shape,
  value,
  onChange,
}: {
  eventDisplayName: string;
  shape: ValueShape;
  value: LiteralValue;
  onChange: (value: LiteralValue) => void;
}) {
  const label = `${eventDisplayName} literal argument`;
  if (shape.kind === 'number') {
    return (
      <NumberLiteralArgument
        label={label}
        value={typeof value === 'number' ? value : 0}
        onChange={onChange}
      />
    );
  }
  if (shape.kind === 'boolean') {
    return (
      <select
        aria-label={label}
        value={value === true ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  }
  if (shape.kind === 'string') {
    return (
      <input
        aria-label={label}
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (shape.kind === 'color') {
    const color = typeof value === 'string' ? value : '#000000';
    const pickerColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
    return (
      <div className="color-control">
        <input
          aria-label={`${eventDisplayName} literal argument color picker`}
          type="color"
          value={pickerColor}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          aria-label={label}
          type="text"
          value={color}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }
  return (
    <StructuredLiteralArgument
      key={JSON.stringify(value)}
      label={label}
      shape={shape}
      value={value}
      onChange={onChange}
    />
  );
}

function compatiblePageProps(document: UiDocument, target: ValueShape): PublicProp[] {
  return Object.values(document.publicProps).filter((prop) => {
    if (prop.valueType === 'event') return false;
    if (!isValueDeclarationAssignableToShape(prop.valueType, prop.valueShape, target)) return false;
    if (prop.required) return true;
    return prop.defaultValue !== undefined && literalMatchesValueShape(prop.defaultValue, target);
  });
}

function EventArgumentMappingEditor({
  node,
  eventName,
  spec,
  action,
}: {
  node: ElementNode;
  eventName: string;
  spec: EventSpec;
  action: SymbolDeclaration;
}) {
  const document = useStudioStore((state) => state.document);
  const setEventBinding = useStudioStore((state) => state.setEventBinding);
  const payload = action.eventSignature?.payload ?? null;
  if (!payload) {
    return <p className="event-argument-help">No argument is passed.</p>;
  }

  const mapping = node.eventArguments?.[eventName];
  const emitterCompatible = isEventSignatureAssignable(spec.signature, {
    payload: { name: payload.name, shape: payload.shape },
  });
  const pageProps = compatiblePageProps(document, payload.shape);
  const mappedExpression = mapping?.kind === 'expression' ? mapping.expression : undefined;
  const referencedSymbolId =
    mappedExpression?.kind === 'reference' && mappedExpression.path.length === 0
      ? mappedExpression.symbolId
      : undefined;
  const referencedPageProp = pageProps.find((prop) => prop.symbolId === referencedSymbolId);
  const source =
    mapping?.kind === 'eventPayload'
      ? 'eventPayload'
      : mapping?.kind === 'expression' && mapping.expression.kind === 'literal'
        ? 'literal'
        : referencedPageProp
          ? 'pageProp'
          : mapping === undefined
            ? 'eventPayload'
            : 'currentExpression';
  const literalValue =
    mapping?.kind === 'expression' && mapping.expression.kind === 'literal'
      ? mapping.expression.value
      : defaultLiteralForShape(payload.shape);
  const setArgument = (argument: EventArgumentMapping) =>
    setEventBinding(node.id, eventName, action.id, argument);

  return (
    <fieldset className="event-argument-editor">
      <legend>{`Argument mapping for ${spec.displayName}`}</legend>
      <div className="field-row">
        <label>Source</label>
        <select
          aria-label={`${spec.displayName} argument source`}
          value={source}
          onChange={(event) => {
            if (event.target.value === 'eventPayload') {
              setArgument({ kind: 'eventPayload' });
            } else if (event.target.value === 'literal') {
              setArgument({
                kind: 'expression',
                expression: { kind: 'literal', value: defaultLiteralForShape(payload.shape) },
              });
            } else if (event.target.value === 'pageProp' && pageProps[0]) {
              setArgument({
                kind: 'expression',
                expression: { kind: 'reference', symbolId: pageProps[0].symbolId, path: [] },
              });
            }
          }}
        >
          {source === 'currentExpression' && (
            <option value="currentExpression">Current expression</option>
          )}
          <option value="eventPayload" disabled={!emitterCompatible}>
            Emitted event value
          </option>
          <option value="literal">Literal value</option>
          <option value="pageProp" disabled={pageProps.length === 0}>
            Page prop
          </option>
        </select>
      </div>

      {!emitterCompatible && (
        <p className="event-argument-help">
          {spec.signature.payload === null
            ? `${spec.displayName} emits no value. Choose a literal or page prop.`
            : `${spec.displayName} emits ${spec.signature.payload.shape.kind}, but ${action.name} expects ${payload.shape.kind}.`}
        </p>
      )}

      {source === 'literal' && (
        <LiteralArgumentControl
          key={`${action.id}:${payload.shape.kind}`}
          eventDisplayName={spec.displayName}
          shape={payload.shape}
          value={literalValue}
          onChange={(value) =>
            setArgument({ kind: 'expression', expression: { kind: 'literal', value } })
          }
        />
      )}

      {source === 'pageProp' && (
        <div className="field-row">
          <label>Page prop</label>
          <select
            aria-label={`${spec.displayName} page prop argument`}
            value={referencedPageProp?.symbolId ?? pageProps[0]?.symbolId ?? ''}
            onChange={(event) =>
              setArgument({
                kind: 'expression',
                expression: { kind: 'reference', symbolId: event.target.value, path: [] },
              })
            }
          >
            {pageProps.map((prop) => (
              <option key={prop.symbolId} value={prop.symbolId}>
                props.{prop.name} · {prop.valueShape?.kind ?? prop.valueType}
              </option>
            ))}
          </select>
        </div>
      )}

      {pageProps.length === 0 && source !== 'currentExpression' && (
        <p className="event-argument-help">
          No page prop can safely supply {payload.shape.kind} yet.
        </p>
      )}
      {source === 'currentExpression' && (
        <p className="event-argument-help" role="status">
          This imported expression is preserved. Choose another source to replace it.
        </p>
      )}
    </fieldset>
  );
}

function EventsEditor({ node }: { node: ElementNode }) {
  const document = useStudioStore((state) => state.document);
  const setEventBinding = useStudioStore((state) => state.setEventBinding);
  const addInstanceEvent = useStudioStore((state) => state.addInstanceEvent);
  const removeInstanceEvent = useStudioStore((state) => state.removeInstanceEvent);
  const manifest = componentRegistry.require(node.componentId).manifest;
  const availablePorts = NORMALIZED_INSTANCE_EVENT_PORTS.filter(
    (port) => !manifest.events[port.eventName] && !node.instanceEvents?.[port.eventName],
  );
  const [newEventName, setNewEventName] = useState('onClick');
  const eventSymbols = Object.values(document.publicProps)
    .filter((prop) => prop.valueType === 'event')
    .map((prop) => document.symbols[prop.symbolId])
    .filter((symbol): symbol is SymbolDeclaration => symbol?.valueType === 'event');
  const eventEntries: Array<{ eventName: string; spec: EventSpec; isInstance: boolean }> = [
    ...Object.entries(manifest.events).map(([eventName, spec]) => ({
      eventName,
      spec,
      isInstance: false,
    })),
    ...Object.entries(node.instanceEvents ?? {}).map(([eventName, spec]) => ({
      eventName,
      spec,
      isInstance: true,
    })),
  ];
  const selectedAvailablePort =
    availablePorts.find((port) => port.eventName === newEventName) ?? availablePorts[0];

  return (
    <section className="inspector-section">
      <header>
        <span>Event ports</span>
        <ChevronDown size={14} />
      </header>
      <div className="inspector-fields">
        {eventEntries.map(({ eventName, spec, isInstance }) => {
          const expression = node.events[eventName];
          const selectedSymbol =
            expression?.kind === 'reference' ? document.symbols[expression.symbolId] : undefined;
          const selectedIsNotPublic =
            selectedSymbol !== undefined &&
            !eventSymbols.some((symbol) => symbol.id === selectedSymbol.id);

          return (
            <div
              className={isInstance ? 'prop-field is-instance-event' : 'prop-field'}
              key={eventName}
            >
              <div className="prop-field-heading">
                <label>{spec.displayName}</label>
                <div className="event-port-meta">
                  <span className="type-pill">
                    {spec.signature.payload
                      ? `Emits ${spec.signature.payload.shape.kind}`
                      : 'Emits no value'}
                  </span>
                  {isInstance && (
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Remove event port ${eventName}`}
                      onClick={() => removeInstanceEvent(node.id, eventName)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              <select
                aria-label={`${spec.displayName} action`}
                value={expression?.kind === 'reference' ? expression.symbolId : ''}
                onChange={(event) => {
                  const symbolId = event.target.value;
                  if (!symbolId) {
                    setEventBinding(node.id, eventName, null, null);
                    return;
                  }
                  const symbol = document.symbols[symbolId];
                  const targetPayload = symbol?.eventSignature?.payload ?? null;
                  const argument: EventArgumentMapping | null = targetPayload
                    ? isEventSignatureAssignable(spec.signature, {
                        payload: { name: targetPayload.name, shape: targetPayload.shape },
                      })
                      ? { kind: 'eventPayload' }
                      : {
                          kind: 'expression',
                          expression: {
                            kind: 'literal',
                            value: defaultLiteralForShape(targetPayload.shape),
                          },
                        }
                    : null;
                  setEventBinding(node.id, eventName, symbolId, argument);
                }}
              >
                <option value="">No action</option>
                {selectedIsNotPublic && selectedSymbol && (
                  <option value={selectedSymbol.id}>
                    Current · {selectedSymbol.name} ·{' '}
                    {eventSignatureSummary(selectedSymbol.eventSignature)}
                  </option>
                )}
                {eventSymbols.map((symbol) => (
                  <option key={symbol.id} value={symbol.id}>
                    {symbol.name} · {eventSignatureSummary(symbol.eventSignature)}
                  </option>
                ))}
              </select>
              {selectedSymbol?.valueType === 'event' && (
                <EventArgumentMappingEditor
                  node={node}
                  eventName={eventName}
                  spec={spec}
                  action={selectedSymbol}
                />
              )}
            </div>
          );
        })}
        {eventEntries.length === 0 && (
          <p className="empty-copy">This component exposes no events.</p>
        )}
        <div className="add-instance-control">
          <div className="prop-field-heading">
            <label>Add event port</label>
            <span className="type-pill">Normalized</span>
          </div>
          {availablePorts.length > 0 ? (
            <div className="add-instance-row is-event">
              <select
                aria-label="New instance event port"
                value={selectedAvailablePort?.eventName ?? ''}
                onChange={(event) => setNewEventName(event.target.value)}
              >
                {availablePorts.map((port) => (
                  <option key={port.eventName} value={port.eventName}>
                    {port.eventName} ·{' '}
                    {port.signature.payload ? port.signature.payload.shape.kind : 'no payload'}
                  </option>
                ))}
              </select>
              <button
                className="small-action-button"
                type="button"
                onClick={() => {
                  if (!selectedAvailablePort) return;
                  const spec = createInstanceEventSpec(selectedAvailablePort.eventName);
                  if (!spec) return;
                  addInstanceEvent(node.id, selectedAvailablePort.eventName, spec);
                  const next = availablePorts.find(
                    (port) => port.eventName !== selectedAvailablePort.eventName,
                  );
                  if (next) setNewEventName(next.eventName);
                }}
              >
                <Plus size={13} /> Add event
              </button>
            </div>
          ) : (
            <p className="empty-copy">All compatible native event ports are already added.</p>
          )}
          <p className="field-help">
            Mouse events expose no browser object. Key and value events emit small serializable
            payloads that can be mapped to a page action.
          </p>
        </div>
      </div>
    </section>
  );
}

const shapeKinds: Array<ValueShape['kind']> = [
  'string',
  'number',
  'boolean',
  'color',
  'object',
  'array',
  'unknown',
];

const publicPropTypes: ValueType[] = [
  'string',
  'number',
  'boolean',
  'color',
  'event',
  'array',
  'object',
  'unknown',
];

function shapeForKind(kind: ValueShape['kind']): ValueShape {
  if (kind === 'object') return { kind, fields: {}, additionalProperties: false };
  if (kind === 'array') return { kind, item: { kind: 'unknown' } };
  return { kind };
}

function eventSignatureSummary(signature: EventSignature | undefined): string {
  if (!signature || signature.payload === null) return '() => void';
  return `(${signature.payload.name}: ${signature.payload.shape.kind}) => void`;
}

function ValueShapeEditor({
  label,
  shape,
  lockKind = false,
  depth = 0,
  onChange,
}: {
  label: string;
  shape: ValueShape;
  lockKind?: boolean;
  depth?: number;
  onChange: (shape: ValueShape) => void;
}) {
  const [fieldName, setFieldName] = useState('');
  const [fieldKind, setFieldKind] = useState<ValueShape['kind']>('string');

  return (
    <div className="value-shape-editor" data-depth={depth}>
      {!lockKind && (
        <div className="field-row">
          <label>{label} type</label>
          <select
            aria-label={`${label} type`}
            value={shape.kind}
            onChange={(event) => onChange(shapeForKind(event.target.value as ValueShape['kind']))}
          >
            {shapeKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
      )}

      {shape.kind === 'object' && (
        <>
          <div className="field-row">
            <label>Object shape</label>
            <select
              aria-label={`Object shape mode for ${label}`}
              value={shape.additionalProperties ? 'open' : 'defined'}
              onChange={(event) =>
                onChange({ ...shape, additionalProperties: event.target.value === 'open' })
              }
            >
              <option value="open">Open / unknown fields</option>
              <option value="defined">Defined fields only</option>
            </select>
          </div>

          <div className="shape-field-list">
            {Object.entries(shape.fields).map(([name, field]) => (
              <div className="shape-field" key={name}>
                <div className="shape-field-heading">
                  <code>{name}</code>
                  <label>
                    <input
                      aria-label={`${label}.${name} required`}
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        onChange({
                          ...shape,
                          fields: {
                            ...shape.fields,
                            [name]: { ...field, required: event.target.checked },
                          },
                        })
                      }
                    />
                    Required
                  </label>
                  <button
                    className="shape-remove-button"
                    type="button"
                    aria-label={`Remove ${label}.${name}`}
                    onClick={() => {
                      const fields = { ...shape.fields };
                      delete fields[name];
                      onChange({ ...shape, fields });
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <ValueShapeEditor
                  label={`${label}.${name}`}
                  shape={field.shape}
                  depth={depth + 1}
                  onChange={(nextShape) =>
                    onChange({
                      ...shape,
                      fields: {
                        ...shape.fields,
                        [name]: { ...field, shape: nextShape },
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="shape-add-field">
            <input
              aria-label={`Add field to ${label} name`}
              value={fieldName}
              placeholder="fieldName"
              onChange={(event) => setFieldName(event.target.value)}
            />
            <select
              aria-label={`Add field to ${label} type`}
              value={fieldKind}
              onChange={(event) => setFieldKind(event.target.value as ValueShape['kind'])}
            >
              {shapeKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Add field to ${label}`}
              disabled={!fieldName.trim()}
              onClick={() => {
                const normalized = fieldName.trim().replace(/[^A-Za-z0-9_$]/g, '_');
                const name = /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
                if (!name || shape.fields[name]) return;
                onChange({
                  ...shape,
                  fields: {
                    ...shape.fields,
                    [name]: { required: false, shape: shapeForKind(fieldKind) },
                  },
                });
                setFieldName('');
              }}
            >
              <Plus size={13} />
              Add field
            </button>
          </div>
        </>
      )}

      {shape.kind === 'array' && (
        <div className="array-shape-editor">
          <ValueShapeEditor
            label={`${label} item`}
            shape={shape.item}
            depth={depth + 1}
            onChange={(item) => onChange({ ...shape, item })}
          />
        </div>
      )}
    </div>
  );
}

function PrimitiveDesignValueEditor({ prop }: { prop: PublicProp }) {
  const setPublicPropDefaultValue = useStudioStore((state) => state.setPublicPropDefaultValue);
  const label = `Design value for props.${prop.name}`;

  if (prop.valueType === 'boolean') {
    return (
      <div className="field-row public-prop-design-value">
        <label htmlFor={`design-value-${prop.symbolId}`}>Design value</label>
        <select
          id={`design-value-${prop.symbolId}`}
          aria-label={label}
          value={prop.defaultValue === true ? 'true' : 'false'}
          onChange={(event) => setPublicPropDefaultValue(prop.name, event.target.value === 'true')}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </div>
    );
  }

  if (prop.valueType === 'number') {
    return (
      <div className="field-row public-prop-design-value">
        <label htmlFor={`design-value-${prop.symbolId}`}>Design value</label>
        <input
          id={`design-value-${prop.symbolId}`}
          aria-label={label}
          type="number"
          value={typeof prop.defaultValue === 'number' ? prop.defaultValue : 0}
          onChange={(event) => setPublicPropDefaultValue(prop.name, Number(event.target.value))}
        />
      </div>
    );
  }

  if (prop.valueType === 'string' || prop.valueType === 'color') {
    return (
      <div className="field-row public-prop-design-value">
        <label htmlFor={`design-value-${prop.symbolId}`}>Design value</label>
        <input
          id={`design-value-${prop.symbolId}`}
          aria-label={label}
          type="text"
          placeholder={prop.valueType === 'color' ? '#6255d4' : 'Sample value'}
          value={typeof prop.defaultValue === 'string' ? prop.defaultValue : ''}
          onChange={(event) => setPublicPropDefaultValue(prop.name, event.target.value)}
        />
      </div>
    );
  }

  return null;
}

function StructuredPublicPropDesignValueEditor({ prop }: { prop: PublicProp }) {
  const setPublicPropDefaultValue = useStudioStore((state) => state.setPublicPropDefaultValue);
  const initialValue =
    prop.defaultValue ?? (prop.valueType === 'array' ? ([] satisfies LiteralValue) : {});
  const [draft, setDraft] = useState(() => JSON.stringify(initialValue, null, 2));
  const [error, setError] = useState<string | null>(null);
  const label = `Design value for props.${prop.name}`;

  if (prop.valueType !== 'object' && prop.valueType !== 'array') return null;

  return (
    <div className="public-prop-structured-value">
      <label htmlFor={`design-value-${prop.symbolId}`}>Design value (JSON)</label>
      <div className="structured-instance-prop">
        <textarea
          id={`design-value-${prop.symbolId}`}
          aria-label={`${label} JSON`}
          rows={7}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="small-action-button"
          type="button"
          onClick={() => {
            try {
              const parsed: unknown = JSON.parse(draft);
              if (
                prop.valueType === 'object' &&
                (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
              ) {
                throw new Error('Enter a JSON object.');
              }
              if (prop.valueType === 'array' && !Array.isArray(parsed)) {
                throw new Error('Enter a JSON array.');
              }
              if (
                prop.valueShape &&
                !literalMatchesValueShape(parsed as LiteralValue, prop.valueShape)
              ) {
                throw new Error('The JSON value must match the defined prop shape.');
              }
              setPublicPropDefaultValue(prop.name, parsed as LiteralValue);
              setError(null);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Enter valid JSON.');
            }
          }}
        >
          Apply design value
        </button>
      </div>
    </div>
  );
}

function normalizeEventPayloadName(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_$]/g, '_');
  if (!normalized) return '';
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function EventPayloadNameInput({
  propName,
  initialName,
  onCommit,
}: {
  propName: string;
  initialName: string;
  onCommit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  const commit = () => {
    const normalized = normalizeEventPayloadName(name);
    if (!normalized) {
      setName(initialName);
      return;
    }
    setName(normalized);
    if (normalized !== initialName) onCommit(normalized);
  };

  return (
    <input
      aria-label={`Event payload name for props.${propName}`}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setName(initialName);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function EventDefinitionEditor({ prop }: { prop: PublicProp }) {
  const setPublicPropEventSignature = useStudioStore((state) => state.setPublicPropEventSignature);
  const signature = prop.eventSignature ?? { payload: null };
  const payload = signature.payload;

  return (
    <fieldset className="public-event-editor">
      <legend>{`Event definition for props.${prop.name}`}</legend>
      <div className="field-row">
        <label>Payload mode</label>
        <select
          aria-label={`Payload mode for props.${prop.name}`}
          value={payload ? 'payload' : 'none'}
          onChange={(event) => {
            if (event.target.value === 'none') {
              setPublicPropEventSignature(prop.name, { payload: null });
              return;
            }
            setPublicPropEventSignature(prop.name, {
              payload: { name: 'payload', shape: { kind: 'unknown' } },
            });
          }}
        >
          <option value="none">No payload</option>
          <option value="payload">With payload</option>
        </select>
      </div>

      {payload && (
        <>
          <div className="field-row">
            <label>Payload name</label>
            <EventPayloadNameInput
              key={`${prop.symbolId}:${payload.name}`}
              propName={prop.name}
              initialName={payload.name}
              onCommit={(name) =>
                setPublicPropEventSignature(prop.name, {
                  payload: { ...payload, name },
                })
              }
            />
          </div>
          <div className="field-row">
            <label>Payload type</label>
            <select
              aria-label={`Event payload type for props.${prop.name}`}
              value={payload.shape.kind}
              onChange={(event) =>
                setPublicPropEventSignature(prop.name, {
                  payload: {
                    ...payload,
                    shape: shapeForKind(event.target.value as ValueShape['kind']),
                  },
                })
              }
            >
              {shapeKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
          {(payload.shape.kind === 'object' || payload.shape.kind === 'array') && (
            <ValueShapeEditor
              label={`Event payload for props.${prop.name}`}
              shape={payload.shape}
              lockKind
              onChange={(shape) =>
                setPublicPropEventSignature(prop.name, {
                  payload: { ...payload, shape },
                })
              }
            />
          )}
        </>
      )}

      <div className="field-row">
        <label>Return type</label>
        <input aria-label={`Return type for props.${prop.name}`} value="void" readOnly />
      </div>
    </fieldset>
  );
}

function PublicPropsEditor() {
  const document = useStudioStore((state) => state.document);
  const addPublicProp = useStudioStore((state) => state.addPublicProp);
  const setPublicPropShape = useStudioStore((state) => state.setPublicPropShape);
  const setPublicPropType = useStudioStore((state) => state.setPublicPropType);
  const removePublicProp = useStudioStore((state) => state.removePublicProp);
  const [name, setName] = useState('');
  const [type, setType] = useState<ValueType>('string');
  return (
    <section className="inspector-section public-props-section">
      <header>
        <span>Public page props</span>
        <span className="count-pill">{Object.keys(document.publicProps).length}</span>
      </header>
      <div className="public-prop-list">
        {Object.values(document.publicProps).length === 0 ? (
          <div className="public-props-empty">
            <Braces size={16} />
            <span>Define a page prop before binding it to component content.</span>
          </div>
        ) : (
          Object.values(document.publicProps).map((prop) => (
            <div className="public-prop public-prop-card" key={prop.symbolId}>
              <div className="public-prop-summary">
                <Braces size={13} />
                <span>
                  <strong>props.{prop.name}</strong>
                  <small>
                    {prop.valueType === 'event'
                      ? `Callback · ${eventSignatureSummary(prop.eventSignature)}`
                      : `Design value · ${
                          prop.defaultValue === undefined
                            ? 'Not set'
                            : JSON.stringify(prop.defaultValue)
                        }`}
                  </small>
                </span>
                <select
                  className="public-prop-type-select"
                  aria-label={`Type for props.${prop.name}`}
                  value={prop.valueType}
                  title="Change public prop type"
                  onChange={(event) =>
                    setPublicPropType(prop.name, event.target.value as ValueType)
                  }
                >
                  {publicPropTypes.map((valueType) => (
                    <option key={valueType} value={valueType}>
                      {valueType}
                    </option>
                  ))}
                </select>
                <button
                  className="shape-remove-button"
                  type="button"
                  aria-label={`Remove props.${prop.name}`}
                  title="Remove prop"
                  onClick={() => removePublicProp(prop.name)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <PrimitiveDesignValueEditor prop={prop} />
              <StructuredPublicPropDesignValueEditor
                key={`${prop.symbolId}:${JSON.stringify(prop.defaultValue)}`}
                prop={prop}
              />
              {prop.valueType === 'event' && <EventDefinitionEditor prop={prop} />}
              {prop.valueShape && (prop.valueType === 'object' || prop.valueType === 'array') && (
                <ValueShapeEditor
                  label={`props.${prop.name}`}
                  shape={prop.valueShape}
                  lockKind
                  onChange={(shape) => setPublicPropShape(prop.name, shape)}
                />
              )}
            </div>
          ))
        )}
      </div>
      <div className="add-prop-row">
        <input
          aria-label="New public prop name"
          value={name}
          placeholder="propName"
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="New public prop type"
          value={type}
          onChange={(event) => setType(event.target.value as ValueType)}
        >
          {publicPropTypes.map((valueType) => (
            <option key={valueType} value={valueType}>
              {valueType}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          type="button"
          aria-label="Add public prop"
          title="Add typed prop"
          onClick={() => {
            if (!name.trim()) return;
            addPublicProp(name, type);
            setName('');
          }}
        >
          <Plus size={14} />
        </button>
      </div>
    </section>
  );
}

function PageIdentityEditor() {
  const document = useStudioStore((state) => state.document);
  const selectedPageId = useStudioStore((state) => state.selectedPageId);
  const renamePage = useStudioStore((state) => state.renamePage);
  return (
    <section className="inspector-section page-identity-section">
      <header>
        <span>Page identity</span>
        <span className="type-pill">root</span>
      </header>
      <div className="inspector-fields">
        <div className="field-row">
          <label>Page</label>
          <input
            key={selectedPageId}
            aria-label="Page name"
            defaultValue={document.name}
            onBlur={(event) => {
              if (event.currentTarget.value.trim()) {
                renamePage(selectedPageId, event.currentTarget.value);
              } else {
                event.currentTarget.value = document.name;
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.currentTarget.value = document.name;
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        <div className="field-row">
          <label>Document ID</label>
          <input aria-label="Page document ID" value={document.id} readOnly />
        </div>
        <div className="page-root-facts">
          <span>
            Element <strong>&lt;main&gt;</strong>
          </span>
          <span>
            Width <strong>100%</strong>
          </span>
          <span>
            Height <strong>100%</strong>
          </span>
          <span>
            Root <strong>Locked</strong>
          </span>
        </div>
        <p className="field-help">
          The Page is the fixed React return root. Add layout and JSX structure inside it.
        </p>
      </div>
    </section>
  );
}

export function Inspector() {
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const tab = useStudioStore((state) => state.inspectorTab);
  const setTab = useStudioStore((state) => state.setInspectorTab);
  const dispatch = useStudioStore((state) => state.dispatch);
  const removeSelectedNode = useStudioStore((state) => state.removeSelectedNode);
  const node = document.nodes[selectedNodeId];
  const isPageRoot = node?.id === document.rootNodeId;
  const title = useMemo(() => {
    if (!node) return 'Nothing selected';
    if (node.id === document.rootNodeId) return document.name;
    if (node.kind === 'element')
      return componentRegistry.get(node.componentId)?.manifest.displayName ?? node.name;
    return node.kind === 'if' ? 'If / Else' : node.kind === 'repeat' ? 'Repeat' : node.kind;
  }, [document.name, document.rootNodeId, node]);

  return (
    <aside
      className={`inspector-panel${isPageRoot ? ' is-page-root' : ''}${node && node.kind !== 'element' ? ' is-structure' : ''}`}
      aria-label="Inspector"
    >
      <div className="inspector-heading">
        <div className="selection-icon">
          <Box size={17} />
        </div>
        <div>
          <span className="eyebrow">{isPageRoot ? 'SELECTED PAGE' : 'SELECTED COMPONENT'}</span>
          <h2>{title}</h2>
        </div>
        {node && (
          <button
            className="delete-node-button"
            type="button"
            aria-label={`Delete ${node.name}`}
            title={
              node.id === document.rootNodeId
                ? 'The root Page cannot be deleted'
                : 'Delete selected'
            }
            disabled={node.id === document.rootNodeId}
            onClick={removeSelectedNode}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        )}
      </div>

      {node && !isPageRoot && (
        <div className="node-name-field">
          <label htmlFor="node-name">Layer name</label>
          <input
            id="node-name"
            value={node.name}
            onChange={(event) =>
              dispatch({
                kind: 'renameNode',
                nodeId: node.id,
                name: event.target.value || 'Untitled',
              })
            }
          />
          <span>{node.id}</span>
        </div>
      )}

      {node?.kind === 'element' && (
        <nav className="inspector-tabs" aria-label="Inspector view">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={tab === item.id ? 'is-active' : ''}
                key={item.id}
                type="button"
                aria-pressed={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                <Icon size={13} />
                {item.label}
              </button>
            );
          })}
        </nav>
      )}

      <div className="inspector-scroll">
        {node?.kind === 'element' && tab === 'design' && (
          <>
            {isPageRoot && <PageIdentityEditor />}
            <DesignEditor key={node.id} node={node} lockRootSize={isPageRoot} />
          </>
        )}
        {node?.kind === 'element' &&
          tab === 'props' &&
          (isPageRoot ? <PublicPropsEditor /> : <PropEditor node={node} />)}
        {node?.kind === 'element' && tab === 'events' && <EventsEditor node={node} />}
        {node?.kind === 'if' && <ConditionEditor node={node} />}
        {node?.kind === 'repeat' && <RepeatEditor node={node} />}
        {node && node.kind !== 'element' && node.kind !== 'if' && node.kind !== 'repeat' && (
          <section className="inspector-section">
            <header>
              <span>JSX structure</span>
            </header>
            <div className="structure-summary">
              <Braces size={18} />
              <p>
                This is a typed <strong>{node.kind}</strong> node. Its branches and expression are
                stored directly in the UI AST.
              </p>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
