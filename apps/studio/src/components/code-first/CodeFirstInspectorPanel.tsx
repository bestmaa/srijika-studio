import { useId, useMemo, useState, type ReactNode } from 'react';

import type {
  PublicProp,
  UiDocument,
  UiNode,
  ValueExpression,
  ValueShape,
} from '@srijika/contracts';
import type {
  InsertSrijikaContractMemberInput,
  SrijikaComponentContractEntry,
  SrijikaContractTypeNode,
  SrijikaSourceMap,
  SrijikaSourceSpan,
} from '@srijika/tsx-compiler';
import {
  SRIJIKA_INTRINSIC_ATTRIBUTES,
  SRIJIKA_INTRINSIC_EVENTS,
  parseSrijikaContractType,
  printSrijikaContractType,
} from '@srijika/tsx-compiler';

import {
  buildUiNodePresentations,
  intrinsicElementTag,
  uiNodeChildren,
  type UiNodePresentation,
} from './ui-node-presentation';

export type InspectorLiteralValue = string | number | boolean;

export interface InspectorLiteralPropTarget {
  nodeId: string;
  propName: string;
  value: InspectorLiteralValue;
}

export interface InspectorLiteralPropEdit extends InspectorLiteralPropTarget {
  previousValue: InspectorLiteralValue;
}

export interface InspectorLiteralPropEditability {
  editable: boolean;
  reason?: string;
}

export type InspectorLiteralPropApplyResult = { ok: true } | { ok: false; message: string } | void;

export interface InspectorInsertPropTarget {
  nodeId: string;
  propName: string;
  value: InspectorLiteralValue;
}

export interface InspectorBindEventTarget {
  nodeId: string;
  eventName: string;
  callbackPropName: string;
}

export interface CodeFirstInspectorPanelProps {
  document: UiDocument | null;
  selectedNodeId: string | null;
  fileName: string;
  sourceMap: SrijikaSourceMap | null;
  /** Full source contract, including declared ReactNode slots that are not rendered. */
  componentContract?: readonly SrijikaComponentContractEntry[] | undefined;
  /** Extra AST-safe actions, such as Reveal or a dedicated text editor. */
  selectedNodeActions?: ReactNode;
  isLiteralPropEditable?: (
    target: InspectorLiteralPropTarget,
  ) => boolean | InspectorLiteralPropEditability;
  onApplyLiteralProp?: (edit: InspectorLiteralPropEdit) => InspectorLiteralPropApplyResult;
  onInsertLiteralProp?: (target: InspectorInsertPropTarget) => InspectorLiteralPropApplyResult;
  onBindEvent?: (target: InspectorBindEventTarget) => InspectorLiteralPropApplyResult;
  onInsertContractMember?: (
    input: InsertSrijikaContractMemberInput,
  ) => InspectorLiteralPropApplyResult;
  onRevealSource?: (nodeId: string, span: SrijikaSourceSpan) => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (character) => character.toUpperCase());
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function shapeLabel(shape: ValueShape | undefined): string {
  if (!shape) return 'unknown';
  if (shape.kind === 'array') return `${shapeLabel(shape.item)}[]`;
  if (shape.kind !== 'object') return shape.kind;
  const fields = Object.entries(shape.fields)
    .map(([name, field]) => `${name}${field.required ? '' : '?'}: ${shapeLabel(field.shape)}`)
    .join('; ');
  return fields ? `{ ${fields} }` : 'object';
}

function publicPropType(prop: PublicProp): string {
  if (prop.valueType !== 'event') return shapeLabel(prop.valueShape);
  const payload = prop.eventSignature?.payload;
  return payload ? `(${payload.name}: ${shapeLabel(payload.shape)})` : '()';
}

interface InspectorContractRow {
  name: string;
  required: boolean;
  type: string;
}

function contractEntryRow(entry: SrijikaComponentContractEntry): InspectorContractRow {
  return { name: entry.name, required: entry.required, type: entry.typeSource };
}

function publicPropRow(prop: PublicProp): InspectorContractRow {
  return {
    name: prop.name,
    required: prop.required,
    type: publicPropType(prop),
  };
}

function primitiveLiteral(expression: ValueExpression): InspectorLiteralValue | undefined {
  if (expression.kind !== 'literal') return undefined;
  return typeof expression.value === 'string' ||
    typeof expression.value === 'number' ||
    typeof expression.value === 'boolean'
    ? expression.value
    : undefined;
}

function expressionLabel(expression: ValueExpression, document: UiDocument): string {
  switch (expression.kind) {
    case 'literal':
      return typeof expression.value === 'string'
        ? expression.value
        : JSON.stringify(expression.value);
    case 'reference': {
      const symbol = document.symbols[expression.symbolId];
      const root =
        symbol?.provider === 'prop' || symbol?.provider === 'event'
          ? `props.${symbol.name}`
          : (symbol?.name ?? expression.symbolId);
      return [root, ...expression.path].join('.');
    }
    case 'template':
      return expression.parts
        .map((part) => (typeof part === 'string' ? part : `\${${expressionLabel(part, document)}}`))
        .join('');
    case 'unary':
      return `${expression.operator === 'not' ? '!' : '-'}${expressionLabel(expression.operand, document)}`;
    case 'binary':
      return `${expressionLabel(expression.left, document)} ${expression.operator} ${expressionLabel(expression.right, document)}`;
    case 'conditional':
      return `${expressionLabel(expression.condition, document)} ? ${expressionLabel(expression.whenTrue, document)} : ${expressionLabel(expression.whenFalse, document)}`;
    case 'customCodeReference':
      return `${expression.exportName}(...)`;
  }
}

function descendantCount(document: UiDocument, node: UiNode): number {
  const pending = [...uiNodeChildren(node)];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const child = document.nodes[nodeId];
    if (child) pending.push(...uiNodeChildren(child));
  }
  return visited.size;
}

function structureRows(
  document: UiDocument,
  node: UiNode,
): ReadonlyArray<readonly [string, string]> {
  const children = uiNodeChildren(node);
  const descendants = descendantCount(document, node);
  const shared: Array<readonly [string, string]> = [
    ['Direct children', String(children.length)],
    ['All descendants', String(descendants)],
  ];
  switch (node.kind) {
    case 'element':
      return [
        ['Component', `${node.componentId}@${node.componentVersion}`],
        [
          'State',
          `${node.visible.kind === 'literal' && node.visible.value === false ? 'Hidden' : 'Visible'} / ${node.locked ? 'Locked' : 'Unlocked'}`,
        ],
        ...shared,
      ];
    case 'text':
      return [['Content', expressionLabel(node.value, document)], ...shared];
    case 'expression':
      return [['Expression', expressionLabel(node.expression, document)], ...shared];
    case 'if':
      return [
        ['Condition', expressionLabel(node.condition, document)],
        ['True branch', `${node.whenTrue.length} node${node.whenTrue.length === 1 ? '' : 's'}`],
        ['False branch', `${node.whenFalse.length} node${node.whenFalse.length === 1 ? '' : 's'}`],
        ...shared,
      ];
    case 'repeat':
      return [['Collection', expressionLabel(node.source, document)], ...shared];
    case 'slot':
      return [
        ['Slot name', node.slotName],
        ['Fallback nodes', String(node.fallback.length)],
      ];
    case 'fragment':
      return shared;
  }
}

function editability(
  target: InspectorLiteralPropTarget,
  callback: CodeFirstInspectorPanelProps['isLiteralPropEditable'],
  onApply: CodeFirstInspectorPanelProps['onApplyLiteralProp'],
): InspectorLiteralPropEditability {
  if (!onApply) return { editable: false, reason: 'No validated TSX edit action is available.' };
  if (!callback) {
    return {
      editable: false,
      reason: 'The current source map has not authorized this literal for an AST-safe edit.',
    };
  }
  const result = callback(target);
  return typeof result === 'boolean' ? { editable: result } : result;
}

interface LiteralPropControlProps {
  nodeId: string;
  propName: string;
  value: InspectorLiteralValue;
  editability: InspectorLiteralPropEditability;
  onApply?: CodeFirstInspectorPanelProps['onApplyLiteralProp'];
}

function LiteralPropControl({
  nodeId,
  propName,
  value,
  editability: editing,
  onApply,
}: LiteralPropControlProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const unchanged = draft === String(value);
  const numberValid = typeof value !== 'number' || Number.isFinite(Number(draft));

  const apply = (): void => {
    if (!editing.editable || !onApply || unchanged || !numberValid) return;
    const nextValue: InspectorLiteralValue =
      typeof value === 'boolean'
        ? draft === 'true'
        : typeof value === 'number'
          ? Number(draft)
          : draft;
    try {
      const result = onApply({ nodeId, propName, previousValue: value, value: nextValue });
      setError(result && !result.ok ? result.message : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="code-first-inspector-prop" role="group" aria-label={`${propName} prop`}>
      <div className="code-first-inspector-prop-heading">
        <label htmlFor={inputId}>
          <code>{propName}</code>
        </label>
        <span className={`code-first-inspector-origin${editing.editable ? ' is-editable' : ''}`}>
          TSX literal / {editing.editable ? 'editable' : 'read-only'}
        </span>
      </div>
      {typeof value === 'boolean' ? (
        <select
          id={inputId}
          aria-label={`${propName} prop value`}
          value={draft}
          disabled={!editing.editable}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          id={inputId}
          aria-label={`${propName} prop value`}
          type={typeof value === 'number' ? 'number' : 'text'}
          value={draft}
          disabled={!editing.editable}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
        />
      )}
      {!editing.editable && editing.reason && (
        <p className="code-first-inspector-help">{editing.reason}</p>
      )}
      {editing.editable && (
        <button
          type="button"
          className="code-first-inspector-action"
          disabled={unchanged || !numberValid}
          onClick={apply}
        >
          Apply {propName} to TSX
        </button>
      )}
      {error && (
        <p className="code-first-inspector-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface ReadOnlyPropProps {
  document: UiDocument;
  propName: string;
  expression: ValueExpression;
}

function readOnlyExpressionContext(
  document: UiDocument,
  expression: ValueExpression,
): { origin: string; help: string } {
  if (expression.kind === 'literal') {
    return {
      origin: 'TSX literal / read-only',
      help: 'Edit this complex literal directly in VS Code.',
    };
  }
  if (expression.kind === 'reference') {
    const symbol = document.symbols[expression.symbolId];
    if (symbol?.provider === 'prop') {
      return {
        origin: 'UI prop binding / read-only',
        help: `The Connector supplies props.${symbol.name}; change its runtime value there.`,
      };
    }
    if (symbol?.provider === 'event') {
      return {
        origin: 'UI event binding / read-only',
        help: `The Connector owns the props.${symbol.name} callback.`,
      };
    }
    return {
      origin: `${titleCase(symbol?.provider ?? 'runtime')} binding / read-only`,
      help: 'This value comes from the surrounding runtime scope.',
    };
  }
  if (expression.kind === 'customCodeReference') {
    return {
      origin: 'Connector function / read-only',
      help: `Change ${expression.exportName} in the Connector source.`,
    };
  }
  return {
    origin: 'Computed TSX expression / read-only',
    help: 'Change this expression in the UI source through VS Code.',
  };
}

function ReadOnlyProp({ document, propName, expression }: ReadOnlyPropProps) {
  const context = readOnlyExpressionContext(document, expression);
  return (
    <div className="code-first-inspector-prop" role="group" aria-label={`${propName} prop`}>
      <div className="code-first-inspector-prop-heading">
        <code>{propName}</code>
        <span className="code-first-inspector-origin">{context.origin}</span>
      </div>
      <code className="code-first-inspector-expression">
        {expressionLabel(expression, document)}
      </code>
      <p className="code-first-inspector-help">{context.help}</p>
    </div>
  );
}

function defaultCallbackName(tag: string, eventName: string): string {
  const element = titleCase(tag).replace(/\s+/g, '');
  return `on${element}${eventName.replace(/^on/, '')}`;
}

function IntrinsicAuthoringControls({
  node,
  componentContract,
  onInsertLiteralProp,
  onBindEvent,
  mode,
}: {
  node: Extract<UiNode, { kind: 'element' }>;
  componentContract: readonly SrijikaComponentContractEntry[] | undefined;
  onInsertLiteralProp: CodeFirstInspectorPanelProps['onInsertLiteralProp'];
  onBindEvent: CodeFirstInspectorPanelProps['onBindEvent'];
  mode: 'props' | 'events';
}) {
  const tag = intrinsicElementTag(node);
  const authoredProps = new Set(Object.keys(node.props));
  const availableProps = SRIJIKA_INTRINSIC_ATTRIBUTES.filter(
    (attribute) =>
      (!attribute.tags || attribute.tags.includes(tag)) &&
      !authoredProps.has(attribute.name) &&
      !(attribute.name === 'aria-label' && authoredProps.has('ariaLabel')),
  );
  const availableEvents = SRIJIKA_INTRINSIC_EVENTS.filter(
    (event) => !Object.hasOwn(node.events, event.name),
  );
  const declaredEvents = (componentContract ?? []).filter((entry) => entry.kind === 'event');
  const [propName, setPropName] = useState(availableProps[0]?.name ?? '');
  const [propDraft, setPropDraft] = useState('');
  const [eventName, setEventName] = useState(availableEvents[0]?.name ?? 'onClick');
  const [callbackPropName, setCallbackPropName] = useState(
    declaredEvents[0]?.name ?? defaultCallbackName(tag, availableEvents[0]?.name ?? 'onClick'),
  );
  const [error, setError] = useState<string | null>(null);
  const selectedProp =
    availableProps.find((attribute) => attribute.name === propName) ?? availableProps[0];
  const selectedEvent =
    availableEvents.find((event) => event.name === eventName) ?? availableEvents[0];

  const applyProp = (): void => {
    if (!selectedProp || !onInsertLiteralProp) return;
    const value: InspectorLiteralValue =
      selectedProp.type === 'boolean'
        ? propDraft !== 'false'
        : selectedProp.type === 'number'
          ? Number(propDraft || '0')
          : propDraft;
    const result = onInsertLiteralProp({ nodeId: node.id, propName: selectedProp.name, value });
    setError(result && !result.ok ? result.message : null);
  };

  const applyEvent = (): void => {
    if (!selectedEvent || !onBindEvent || !callbackPropName.trim()) return;
    const result = onBindEvent({
      nodeId: node.id,
      eventName: selectedEvent.name,
      callbackPropName: callbackPropName.trim(),
    });
    setError(result && !result.ok ? result.message : null);
  };

  return (
    <section className="code-first-inspector-card" aria-label="Available JSX attributes">
      <div className="code-first-inspector-card-heading">
        <div>
          <p className="code-first-inspector-eyebrow">Add to &lt;{tag}&gt;</p>
          <h3>{mode === 'props' ? 'Add a prop' : 'Connect an event'}</h3>
        </div>
      </div>
      <p className="code-first-inspector-intro">
        {mode === 'props'
          ? 'Choose a supported JSX prop. Studio writes the validated literal into this tag.'
          : 'Choose a React event and connect it to a typed callback prop. Behavior stays in the Connector.'}
      </p>
      {mode === 'props' && (
        <div className="code-first-inspector-authoring-group">
          <label htmlFor={`srijika-add-prop-${node.id}`}>JSX prop</label>
          {availableProps.length > 0 ? (
            <>
              <select
                id={`srijika-add-prop-${node.id}`}
                aria-label="Available JSX prop"
                value={selectedProp?.name}
                disabled={!onInsertLiteralProp}
                onChange={(event) => {
                  setPropName(event.target.value);
                  setPropDraft('');
                  setError(null);
                }}
              >
                {availableProps.map((attribute) => (
                  <option key={attribute.name} value={attribute.name}>
                    {attribute.name} · {attribute.type}
                  </option>
                ))}
              </select>
              {selectedProp?.type === 'boolean' ? (
                <select
                  aria-label={`${selectedProp.name} new value`}
                  value={propDraft || 'true'}
                  onChange={(event) => setPropDraft(event.target.value)}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  aria-label={`${selectedProp?.name ?? 'prop'} new value`}
                  type={selectedProp?.type === 'number' ? 'number' : 'text'}
                  value={propDraft}
                  placeholder={selectedProp?.description}
                  onChange={(event) => setPropDraft(event.target.value)}
                />
              )}
              <button
                type="button"
                className="code-first-inspector-action"
                disabled={!onInsertLiteralProp}
                onClick={applyProp}
              >
                Add {selectedProp?.name} to TSX
              </button>
            </>
          ) : (
            <p className="code-first-inspector-help">All supported props are already authored.</p>
          )}
        </div>
      )}

      {mode === 'events' && (
        <div className="code-first-inspector-authoring-group">
          <label htmlFor={`srijika-add-event-${node.id}`}>React event</label>
          {availableEvents.length > 0 ? (
            <>
              <select
                id={`srijika-add-event-${node.id}`}
                aria-label="Available React event"
                value={selectedEvent?.name}
                disabled={!onBindEvent}
                onChange={(event) => {
                  const nextEvent = event.target.value;
                  setEventName(nextEvent);
                  if (declaredEvents.length === 0) {
                    setCallbackPropName(defaultCallbackName(tag, nextEvent));
                  }
                  setError(null);
                }}
              >
                {availableEvents.map((event) => (
                  <option key={event.name} value={event.name}>
                    {event.name} · {event.displayName}
                  </option>
                ))}
              </select>
              <input
                aria-label="Connector callback prop"
                list={`srijika-event-contract-${node.id}`}
                value={callbackPropName}
                placeholder={defaultCallbackName(tag, selectedEvent?.name ?? 'onClick')}
                disabled={!onBindEvent}
                onChange={(event) => {
                  setCallbackPropName(event.target.value);
                  setError(null);
                }}
              />
              <datalist id={`srijika-event-contract-${node.id}`}>
                {declaredEvents.map((event) => (
                  <option key={event.name} value={event.name} />
                ))}
              </datalist>
              <button
                type="button"
                className="code-first-inspector-action"
                disabled={!onBindEvent || !callbackPropName.trim()}
                onClick={applyEvent}
              >
                Connect {selectedEvent?.name}
              </button>
            </>
          ) : (
            <p className="code-first-inspector-help">All supported events are connected.</p>
          )}
        </div>
      )}
      {error && (
        <p className="code-first-inspector-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

type InspectorView = 'props' | 'events' | 'structure';

function InspectorTabs({
  value,
  onChange,
  counts,
  label,
}: {
  value: InspectorView;
  onChange: (value: InspectorView) => void;
  counts: Record<InspectorView, number>;
  label: string;
}) {
  return (
    <div className="code-first-inspector-tabs" role="tablist" aria-label={label}>
      {(['props', 'events', 'structure'] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={value === tab}
          className={value === tab ? 'is-active' : undefined}
          onClick={() => onChange(tab)}
        >
          {tab === 'structure' ? 'Structure' : titleCase(tab)}
          <span>{counts[tab]}</span>
        </button>
      ))}
    </div>
  );
}

type ContractTypeKind = SrijikaContractTypeNode['kind'];

const contractTypeKinds: readonly ContractTypeKind[] = [
  'string',
  'number',
  'boolean',
  'unknown',
  'object',
  'array',
  'custom',
];

function newContractType(kind: ContractTypeKind): SrijikaContractTypeNode {
  switch (kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'unknown':
      return { kind };
    case 'array':
      return { kind: 'array', item: { kind: 'unknown' } };
    case 'object':
      return {
        kind: 'object',
        fields: [{ name: 'id', required: true, type: { kind: 'string' } }],
      };
    case 'custom':
      return { kind: 'custom', source: 'UserProfile' };
  }
}

function nextObjectFieldName(type: Extract<SrijikaContractTypeNode, { kind: 'object' }>): string {
  const names = new Set(type.fields.map((field) => field.name));
  let index = type.fields.length + 1;
  while (names.has(`field${index}`)) index += 1;
  return `field${index}`;
}

function contractTypeValidationError(
  type: SrijikaContractTypeNode,
  path = 'Type',
  depth = 0,
): string | null {
  if (depth > 5) return `${path} is nested too deeply; use a named custom type.`;
  if (type.kind === 'custom') {
    return parseSrijikaContractType(type.source)
      ? null
      : `${path} must contain one valid TypeScript type.`;
  }
  if (type.kind === 'array') {
    return contractTypeValidationError(type.item, `${path} item`, depth + 1);
  }
  if (type.kind !== 'object') return null;
  if (type.fields.length === 0) return `${path} needs at least one field.`;
  if (type.fields.length > 16) return `${path} can contain at most 16 fields in Inspector.`;
  const names = new Set<string>();
  for (const [index, field] of type.fields.entries()) {
    if (!/^[$A-Z_a-z][$\w]*$/u.test(field.name)) {
      return `${path} field ${index + 1} needs a valid TypeScript key.`;
    }
    if (names.has(field.name)) return `${path} contains the duplicate key ${field.name}.`;
    names.add(field.name);
    const nested = contractTypeValidationError(field.type, `${path}.${field.name}`, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function ContractTypeEditor({
  value,
  label,
  depth = 0,
  onChange,
}: {
  value: SrijikaContractTypeNode;
  label: string;
  depth?: number;
  onChange: (value: SrijikaContractTypeNode) => void;
}) {
  const availableKinds =
    depth >= 5
      ? contractTypeKinds.filter((kind) => kind !== 'object' && kind !== 'array')
      : contractTypeKinds;
  return (
    <div className="code-first-contract-type-editor" data-depth={depth}>
      <label>
        {label} type
        <select
          aria-label={`${label} type`}
          value={value.kind}
          onChange={(event) => onChange(newContractType(event.target.value as ContractTypeKind))}
        >
          {availableKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind === 'object' ? 'object fields' : kind}
            </option>
          ))}
        </select>
      </label>

      {value.kind === 'custom' && (
        <label>
          Custom TypeScript type
          <input
            aria-label={`${label} custom TypeScript type`}
            value={value.source}
            placeholder="UserProfile | null"
            spellCheck={false}
            onChange={(event) => onChange({ kind: 'custom', source: event.target.value })}
            onBlur={() => {
              const parsed = parseSrijikaContractType(value.source);
              if (parsed && parsed.kind !== 'custom') onChange(parsed);
            }}
          />
        </label>
      )}

      {value.kind === 'array' && (
        <div className="code-first-contract-array-editor">
          <p>Every array item uses this type.</p>
          <ContractTypeEditor
            value={value.item}
            label={`${label} item`}
            depth={depth + 1}
            onChange={(item) => onChange({ kind: 'array', item })}
          />
        </div>
      )}

      {value.kind === 'object' && (
        <div className="code-first-contract-object-editor">
          <div className="code-first-contract-object-heading">
            <span>Object fields</span>
            <span>{value.fields.length}/16</span>
          </div>
          {value.fields.map((field, index) => (
            <div className="code-first-contract-object-field" key={index}>
              <div className="code-first-contract-object-field-heading">
                <label>
                  Key
                  <input
                    aria-label={`${label} field ${index + 1} key`}
                    value={field.name}
                    placeholder="fieldName"
                    spellCheck={false}
                    onChange={(event) => {
                      const fields = [...value.fields];
                      fields[index] = { ...field, name: event.target.value };
                      onChange({ kind: 'object', fields });
                    }}
                  />
                </label>
                <label className="code-first-contract-field-required">
                  <input
                    type="checkbox"
                    aria-label={`${label}.${field.name || index + 1} required`}
                    checked={field.required}
                    onChange={(event) => {
                      const fields = [...value.fields];
                      fields[index] = { ...field, required: event.target.checked };
                      onChange({ kind: 'object', fields });
                    }}
                  />
                  Required
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${label} field ${field.name || index + 1}`}
                  onClick={() =>
                    onChange({
                      kind: 'object',
                      fields: value.fields.filter((_, fieldIndex) => fieldIndex !== index),
                    })
                  }
                >
                  Remove
                </button>
              </div>
              <ContractTypeEditor
                value={field.type}
                label={`${label}.${field.name || `field${index + 1}`}`}
                depth={depth + 1}
                onChange={(type) => {
                  const fields = [...value.fields];
                  fields[index] = { ...field, type };
                  onChange({ kind: 'object', fields });
                }}
              />
            </div>
          ))}
          <button
            type="button"
            className="code-first-contract-add-field"
            disabled={value.fields.length >= 16}
            onClick={() =>
              onChange({
                kind: 'object',
                fields: [
                  ...value.fields,
                  {
                    name: nextObjectFieldName(value),
                    required: true,
                    type: { kind: 'string' },
                  },
                ],
              })
            }
          >
            + Add object field
          </button>
        </div>
      )}
    </div>
  );
}

function ContractAuthoringControl({
  view,
  onInsert,
}: {
  view: InspectorView;
  onInsert: CodeFirstInspectorPanelProps['onInsertContractMember'];
}) {
  const kind = view === 'structure' ? 'slot' : view === 'events' ? 'event' : 'prop';
  const [name, setName] = useState('');
  const [contractType, setContractType] = useState<SrijikaContractTypeNode>({ kind: 'string' });
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const label = kind === 'slot' ? 'structure slot' : kind;
  const dataType = printSrijikaContractType(contractType);
  const typeError = kind === 'prop' ? contractTypeValidationError(contractType) : null;

  const add = (): void => {
    if (!onInsert || !name.trim()) return;
    const result = onInsert({
      kind,
      name: name.trim(),
      required,
      ...(kind === 'prop' ? { dataType } : {}),
    });
    if (result && !result.ok) {
      setError(result.message);
      return;
    }
    setName('');
    setError(null);
  };

  return (
    <div className="code-first-contract-authoring" aria-label={`Add contract ${label}`}>
      <div className="code-first-contract-authoring-heading">
        <div>
          <strong>Add {label}</strong>
          <span>
            {kind === 'prop'
              ? 'A typed value supplied by the Connector.'
              : kind === 'event'
                ? 'A typed callback; behavior remains in the Connector.'
                : 'A ReactNode area where nested UI can be supplied.'}
          </span>
        </div>
      </div>
      <label>
        Name
        <input
          aria-label={`New ${label} name`}
          value={name}
          placeholder={kind === 'event' ? 'onAction' : kind === 'slot' ? 'toolbarSlot' : 'title'}
          disabled={!onInsert}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </label>
      {kind === 'prop' && (
        <>
          <ContractTypeEditor
            value={contractType}
            label="New prop"
            onChange={(value) => {
              setContractType(value);
              setError(null);
            }}
          />
          <div className="code-first-contract-type-preview">
            <span>TypeScript preview</span>
            <code>{dataType || 'Invalid type'}</code>
          </div>
          <p className="code-first-contract-type-help">
            Object and array fields generate this type safely. Custom code types are normalized from
            their TypeScript AST, so formatting spaces do not change their category.
          </p>
          {typeError && (
            <p className="code-first-inspector-error" role="alert">
              {typeError}
            </p>
          )}
        </>
      )}
      {kind !== 'prop' && (
        <div className="code-first-contract-fixed-type">
          <span>Type</span>
          <code>{kind === 'event' ? '() => void' : 'ReactNode'}</code>
        </div>
      )}
      <label className="code-first-contract-required">
        <input
          type="checkbox"
          checked={required}
          disabled={!onInsert}
          onChange={(event) => setRequired(event.target.checked)}
        />
        Required
        <span>{required ? 'No ? marker' : 'Adds ? optional marker'}</span>
      </label>
      <button
        type="button"
        className="code-first-inspector-action"
        disabled={!onInsert || !name.trim() || (kind === 'prop' && !!typeError)}
        onClick={add}
      >
        Add {label} to TSX
      </button>
      {error && (
        <p className="code-first-inspector-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ContractRows({ rows }: { rows: readonly InspectorContractRow[] }) {
  if (rows.length === 0) {
    return <p className="code-first-inspector-help">None declared in this UI contract.</p>;
  }
  return (
    <div className="code-first-inspector-contract-list">
      {rows.map((row) => (
        <div key={row.name} className="code-first-inspector-contract-row">
          <code>{row.name}</code>
          <span>
            {row.required ? 'Required' : 'Optional'} / {row.type}
          </span>
        </div>
      ))}
    </div>
  );
}

function SelectionSummary({
  document,
  node,
  presentation,
  fileName,
  span,
  actions,
  onRevealSource,
}: {
  document: UiDocument;
  node: UiNode;
  presentation: UiNodePresentation;
  fileName: string;
  span: SrijikaSourceSpan | undefined;
  actions: ReactNode;
  onRevealSource: CodeFirstInspectorPanelProps['onRevealSource'];
}) {
  const root = node.id === document.rootNodeId;
  return (
    <section className="code-first-inspector-card" aria-label="Selected node summary">
      <div className="code-first-inspector-card-heading">
        <div>
          <p className="code-first-inspector-eyebrow">{root ? 'Selected root' : 'Selected node'}</p>
          <h3>{presentation.label}</h3>
        </div>
        <span className="code-first-inspector-chip">{presentation.detail}</span>
      </div>
      <p className="code-first-inspector-selection-source">
        {baseName(fileName)}
        {span ? `:${span.line}:${span.column}` : ' / source position unavailable'}
      </p>
      {span && onRevealSource && (
        <button
          type="button"
          className="code-first-inspector-action"
          onClick={() => onRevealSource(node.id, span)}
        >
          Reveal {presentation.label} in TSX
        </button>
      )}
      {actions && <div className="code-first-inspector-selected-actions">{actions}</div>}
      <details className="code-first-inspector-details">
        <summary>Technical details</summary>
        <dl className="code-first-inspector-facts">
          <dt>Node type</dt>
          <dd>{titleCase(node.kind)}</dd>
          <dt>Stable ID</dt>
          <dd>
            <code>{node.id}</code>
          </dd>
          {structureRows(document, node).map(([label, value]) => (
            <div className="code-first-inspector-fact-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

export function CodeFirstInspectorPanel({
  document,
  selectedNodeId,
  fileName,
  sourceMap,
  componentContract,
  selectedNodeActions,
  isLiteralPropEditable,
  onApplyLiteralProp,
  onInsertLiteralProp,
  onBindEvent,
  onInsertContractMember,
  onRevealSource,
}: CodeFirstInspectorPanelProps) {
  const presentations = useMemo(
    () => (document ? buildUiNodePresentations(document) : {}),
    [document],
  );
  const [contractView, setContractView] = useState<InspectorView>('props');
  const [nodeView, setNodeView] = useState<InspectorView>('props');

  if (!document) {
    return (
      <div className="code-first-inspector-content">
        <section className="code-first-inspector-empty" aria-label="Inspector empty state">
          <p className="code-first-inspector-eyebrow">No UI source selected</p>
          <h3>Open a Srijika UI file</h3>
          <p>
            Select a <code>.ui.tsx</code> file to inspect its component contract, nodes, props,
            events, slots, and source locations.
          </p>
        </section>
      </div>
    );
  }

  const selectedNode = selectedNodeId ? document.nodes[selectedNodeId] : undefined;
  const publicProps = Object.values(document.publicProps).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const fallbackInputProps = publicProps
    .filter((prop) => prop.valueType !== 'event')
    .map(publicPropRow);
  const fallbackPublicEvents = publicProps
    .filter((prop) => prop.valueType === 'event')
    .map(publicPropRow);
  const fallbackComponentSlots = Object.values(document.nodes)
    .filter((node): node is Extract<UiNode, { kind: 'slot' }> => node.kind === 'slot')
    .sort((left, right) => left.slotName.localeCompare(right.slotName))
    .map((slot): InspectorContractRow => ({
      name: slot.slotName,
      required: true,
      type: 'ReactNode',
    }));
  const inputProps = componentContract
    ? componentContract.filter((entry) => entry.kind === 'prop').map(contractEntryRow)
    : fallbackInputProps;
  const publicEvents = componentContract
    ? componentContract.filter((entry) => entry.kind === 'event').map(contractEntryRow)
    : fallbackPublicEvents;
  const componentSlots = componentContract
    ? componentContract.filter((entry) => entry.kind === 'slot').map(contractEntryRow)
    : fallbackComponentSlots;
  const contractCounts: Record<InspectorView, number> = {
    props: inputProps.length,
    events: publicEvents.length,
    structure: componentSlots.length,
  };
  const totalContractMembers = inputProps.length + publicEvents.length + componentSlots.length;
  return (
    <div className="code-first-inspector-content">
      <section className="code-first-inspector-identity" aria-label="UI identity">
        <p className="code-first-inspector-eyebrow">
          {document.kind === 'page' ? 'Page UI' : 'Component UI'}
        </p>
        <div className="code-first-inspector-identity-heading">
          <h3>{document.name}</h3>
          <span className="code-first-inspector-chip">Source of truth</span>
        </div>
        <code className="code-first-inspector-source" title={fileName}>
          {fileName}
        </code>
        <div className="code-first-inspector-metrics" aria-label="UI summary">
          <span className="is-total">{countLabel(totalContractMembers, 'contract member')}</span>
          <span>{countLabel(Object.keys(document.nodes).length, 'node')}</span>
          <span>{countLabel(inputProps.length, 'input prop')}</span>
          <span>{countLabel(publicEvents.length, 'event')}</span>
          <span>{countLabel(componentSlots.length, 'slot')}</span>
        </div>
      </section>

      <section className="code-first-inspector-card" aria-label="Component contract">
        <div className="code-first-inspector-card-heading">
          <div>
            <p className="code-first-inspector-eyebrow">Component contract</p>
            <h3>UI contract</h3>
          </div>
          <span className="code-first-inspector-chip">Total {totalContractMembers}</span>
        </div>
        <p className="code-first-inspector-intro">
          Props carry values, Events carry behavior, and Structure accepts nested UI.
        </p>
        <InspectorTabs
          value={contractView}
          onChange={setContractView}
          counts={contractCounts}
          label="UI contract sections"
        />
        <div role="tabpanel" className="code-first-inspector-tab-panel">
          {contractView === 'props' && <ContractRows rows={inputProps} />}
          {contractView === 'events' && <ContractRows rows={publicEvents} />}
          {contractView === 'structure' && <ContractRows rows={componentSlots} />}
        </div>
        {selectedNodeId === null && (
          <ContractAuthoringControl view={contractView} onInsert={onInsertContractMember} />
        )}
      </section>

      {selectedNode ? (
        <>
          <SelectionSummary
            document={document}
            node={selectedNode}
            presentation={
              presentations[selectedNode.id] ?? {
                label: selectedNode.name,
                detail: selectedNode.kind,
              }
            }
            fileName={fileName}
            span={sourceMap?.nodes[selectedNode.id]}
            actions={selectedNodeActions}
            onRevealSource={onRevealSource}
          />

          {selectedNode.kind === 'element' && (
            <>
              <section className="code-first-inspector-card code-first-inspector-edit-mode">
                <p className="code-first-inspector-eyebrow">Edit selected element</p>
                <h3>What do you want to change?</h3>
                <InspectorTabs
                  value={nodeView}
                  onChange={setNodeView}
                  counts={{
                    props: Object.keys(selectedNode.props).length,
                    events: Object.keys(selectedNode.events).length,
                    structure: Object.values(selectedNode.slots).reduce(
                      (count, childIds) => count + childIds.length,
                      0,
                    ),
                  }}
                  label="Selected element sections"
                />
              </section>
              {nodeView === 'props' && (
                <IntrinsicAuthoringControls
                  key={`${selectedNode.id}:props:${Object.keys(selectedNode.props).join(',')}`}
                  mode="props"
                  node={selectedNode}
                  componentContract={componentContract}
                  onInsertLiteralProp={onInsertLiteralProp}
                  onBindEvent={onBindEvent}
                />
              )}
              {nodeView === 'props' && (
                <section className="code-first-inspector-card" aria-label="Node props">
                  <div className="code-first-inspector-card-heading">
                    <div>
                      <p className="code-first-inspector-eyebrow">Props</p>
                      <h3>Authored values and bindings</h3>
                    </div>
                    <span className="code-first-inspector-chip">
                      {Object.keys(selectedNode.props).length}
                    </span>
                  </div>
                  <p className="code-first-inspector-intro">
                    Literal JSX values use validated edits. Connector bindings stay read-only here.
                  </p>
                  <div className="code-first-inspector-prop-list">
                    {Object.keys(selectedNode.props).length === 0 ? (
                      <p className="code-first-inspector-help">This node has no derived props.</p>
                    ) : (
                      Object.entries(selectedNode.props)
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([propName, expression]) => {
                          const literal = primitiveLiteral(expression);
                          if (literal === undefined) {
                            return (
                              <ReadOnlyProp
                                key={propName}
                                document={document}
                                propName={propName}
                                expression={expression}
                              />
                            );
                          }
                          const target = { nodeId: selectedNode.id, propName, value: literal };
                          return (
                            <LiteralPropControl
                              key={`${propName}:${typeof literal}:${String(literal)}`}
                              {...target}
                              editability={editability(
                                target,
                                isLiteralPropEditable,
                                onApplyLiteralProp,
                              )}
                              onApply={onApplyLiteralProp}
                            />
                          );
                        })
                    )}
                  </div>
                </section>
              )}

              {nodeView === 'events' && (
                <IntrinsicAuthoringControls
                  key={`${selectedNode.id}:events:${Object.keys(selectedNode.events).join(',')}`}
                  mode="events"
                  node={selectedNode}
                  componentContract={componentContract}
                  onInsertLiteralProp={onInsertLiteralProp}
                  onBindEvent={onBindEvent}
                />
              )}
              {nodeView === 'events' && (
                <section className="code-first-inspector-card" aria-label="Node events">
                  <div className="code-first-inspector-card-heading">
                    <div>
                      <p className="code-first-inspector-eyebrow">Events</p>
                      <h3>Connector actions</h3>
                    </div>
                    <span className="code-first-inspector-chip">
                      {Object.keys(selectedNode.events).length}
                    </span>
                  </div>
                  {Object.keys(selectedNode.events).length === 0 ? (
                    <p className="code-first-inspector-help">
                      No events are connected to this node.
                    </p>
                  ) : (
                    Object.entries(selectedNode.events)
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([eventName, expression]) => (
                        <div key={eventName} className="code-first-inspector-readonly-row">
                          <code>{eventName}</code>
                          <code>{expressionLabel(expression, document)}</code>
                          <span>Connector binding / read-only</span>
                        </div>
                      ))
                  )}
                </section>
              )}

              {nodeView === 'structure' && (
                <section className="code-first-inspector-card" aria-label="Node slots">
                  <div className="code-first-inspector-card-heading">
                    <div>
                      <p className="code-first-inspector-eyebrow">Slots</p>
                      <h3>Nested UI structure</h3>
                    </div>
                    <span className="code-first-inspector-chip">
                      {Object.keys(selectedNode.slots).length}
                    </span>
                  </div>
                  {Object.keys(selectedNode.slots).length === 0 ? (
                    <p className="code-first-inspector-help">This node exposes no child slots.</p>
                  ) : (
                    Object.entries(selectedNode.slots).map(([slotName, childIds]) => (
                      <div key={slotName} className="code-first-inspector-slot-row">
                        <div>
                          <code>{slotName}</code>
                          <span>
                            {childIds.length} node{childIds.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        {childIds.length > 0 && (
                          <p>
                            {childIds
                              .map(
                                (childId) =>
                                  presentations[childId]?.label ??
                                  document.nodes[childId]?.name ??
                                  childId,
                              )
                              .join(', ')}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <section className="code-first-inspector-card" aria-label="Selected UI function">
          <div className="code-first-inspector-card-heading">
            <div>
              <p className="code-first-inspector-eyebrow">Selected UI function</p>
              <h3>{document.name}</h3>
            </div>
            <span className="code-first-inspector-chip">Complete contract</span>
          </div>
          <dl className="code-first-inspector-facts">
            <dt>Source</dt>
            <dd>
              {baseName(fileName)}
              {sourceMap?.component
                ? `:${sourceMap.component.line}:${sourceMap.component.column}`
                : ' / source position unavailable'}
            </dd>
            <dt>Function</dt>
            <dd>
              <code>{document.name}</code>
            </dd>
            <dt>Return root</dt>
            <dd>{presentations[document.rootNodeId]?.label ?? document.rootNodeId}</dd>
            <dt>Contract members</dt>
            <dd>{inputProps.length + publicEvents.length + componentSlots.length}</dd>
          </dl>
          {sourceMap?.component && onRevealSource && (
            <button
              type="button"
              className="code-first-inspector-action"
              onClick={() => onRevealSource('__srijika_component__', sourceMap.component!)}
            >
              Reveal complete {document.name} function in TSX
            </button>
          )}
        </section>
      )}
    </div>
  );
}
