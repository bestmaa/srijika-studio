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
import { useMemo, useState } from 'react';

import { isTypeAssignable, type PropSpec } from '@sutra/component-registry';
import type {
  ElementNode,
  IfNode,
  LengthValue,
  RepeatNode,
  StyleProperties,
  ValueExpression,
  ValueType,
} from '@sutra/contracts';

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
  const mode = value?.mode ?? 'auto';
  const numeric = value?.mode === 'fixed' || value?.mode === 'percent' ? value.value : 0;
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="length-control">
        {(mode === 'fixed' || mode === 'percent') && (
          <input
            aria-label={`${label} value`}
            type="number"
            min={0}
            value={numeric}
            onChange={(event) =>
              onChange(
                mode === 'fixed'
                  ? { mode: 'fixed', value: Number(event.target.value), unit: 'px' }
                  : { mode: 'percent', value: Number(event.target.value) },
              )
            }
          />
        )}
        <select
          aria-label={`${label} sizing mode`}
          value={mode}
          onChange={(event) => {
            const nextMode = event.target.value as LengthValue['mode'];
            if (nextMode === 'fixed') onChange({ mode: 'fixed', value: 320, unit: 'px' });
            else if (nextMode === 'percent') onChange({ mode: 'percent', value: 100 });
            else onChange({ mode: nextMode });
          }}
        >
          <option value="auto">Auto</option>
          <option value="hug">Hug</option>
          <option value="fill">Fill</option>
          <option value="fixed">px</option>
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

function PropEditor({ node }: { node: ElementNode }) {
  const document = useStudioStore((state) => state.document);
  const setLiteralProp = useStudioStore((state) => state.setLiteralProp);
  const bindProp = useStudioStore((state) => state.bindProp);
  const manifest = componentRegistry.require(node.componentId).manifest;

  return (
    <section className="inspector-section">
      <header>
        <span>Component props</span>
        <ChevronDown size={14} />
      </header>
      <div className="inspector-fields">
        {Object.entries(manifest.props).map(([propName, spec]) => {
          const expression = node.props[propName];
          const compatibleSymbols = Object.values(document.symbols).filter(
            (symbol) =>
              symbol.provider !== 'event' && isTypeAssignable(symbol.valueType, spec.type),
          );
          return (
            <div className="prop-field" key={propName}>
              <div className="prop-field-heading">
                <label>{spec.displayName}</label>
                {spec.bindable && (
                  <select
                    className="binding-select"
                    aria-label={`${spec.displayName} value source`}
                    value={expression?.kind === 'reference' ? expression.symbolId : 'literal'}
                    onChange={(event) => {
                      if (event.target.value === 'literal') {
                        setLiteralProp(
                          node.id,
                          propName,
                          (spec.defaultValue as string | number | boolean | undefined) ?? '',
                        );
                      } else {
                        bindProp(node.id, propName, event.target.value);
                      }
                    }}
                  >
                    <option value="literal">Literal</option>
                    {compatibleSymbols.map((symbol) => (
                      <option key={symbol.id} value={symbol.id}>
                        ↳ {symbol.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {expression?.kind === 'reference' ? (
                <div className="bound-value">
                  <Link2 size={13} />
                  {document.symbols[expression.symbolId]?.name ?? expression.symbolId}
                </div>
              ) : (
                <LiteralControl
                  spec={spec}
                  expression={expression}
                  onChange={(value) => setLiteralProp(node.id, propName, value)}
                />
              )}
            </div>
          );
        })}
        {Object.keys(manifest.props).length === 0 && (
          <p className="empty-copy">This component has no content props.</p>
        )}
      </div>
    </section>
  );
}

function DesignEditor({ node }: { node: ElementNode }) {
  const setStyle = useStudioStore((state) => state.setStyle);
  const setVisibility = useStudioStore((state) => state.setVisibility);
  const setClassRefs = useStudioStore((state) => state.setClassRefs);
  const style = node.style.base;
  const set = <K extends keyof StyleProperties>(property: K, value: StyleProperties[K]): void =>
    setStyle(node.id, property, value);

  return (
    <>
      <section className="inspector-section">
        <header>
          <span>Layout</span>
          <ChevronDown size={14} />
        </header>
        <div className="inspector-fields">
          <LengthEditor
            label="Width"
            value={style.width}
            onChange={(value) => set('width', value)}
          />
          <LengthEditor
            label="Height"
            value={style.height}
            onChange={(value) => set('height', value)}
          />
          <div className="field-row">
            <label>Display</label>
            <select
              aria-label="Display mode"
              value={style.display ?? 'block'}
              onChange={(event) => set('display', event.target.value as StyleProperties['display'])}
            >
              <option value="block">Block</option>
              <option value="flex">Flex</option>
              <option value="grid">Grid</option>
              <option value="none">None</option>
            </select>
          </div>
          {style.display === 'flex' && (
            <div className="field-row">
              <label>Direction</label>
              <select
                aria-label="Flex direction"
                value={style.flexDirection ?? 'column'}
                onChange={(event) => set('flexDirection', event.target.value as 'row' | 'column')}
              >
                <option value="row">Row</option>
                <option value="column">Column</option>
              </select>
            </div>
          )}
          <div className="field-row">
            <label>Gap</label>
            <input
              aria-label="Gap"
              type="number"
              min={0}
              value={style.gap ?? 0}
              onChange={(event) => set('gap', Number(event.target.value))}
            />
          </div>
          <div className="field-row">
            <label>Padding</label>
            <input
              aria-label="Padding"
              type="number"
              min={0}
              value={style.padding?.top ?? 0}
              onChange={(event) => {
                const value = Number(event.target.value);
                set('padding', { top: value, right: value, bottom: value, left: value });
              }}
            />
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <header>
          <span>Appearance</span>
          <ChevronDown size={14} />
        </header>
        <div className="inspector-fields">
          <div className="field-row">
            <label>Background</label>
            <div className="color-control">
              <input
                aria-label="Background color picker"
                type="color"
                value={style.backgroundColor ?? '#ffffff'}
                onChange={(event) => set('backgroundColor', event.target.value)}
              />
              <input
                aria-label="Background color value"
                type="text"
                value={style.backgroundColor ?? ''}
                onChange={(event) => set('backgroundColor', event.target.value)}
              />
            </div>
          </div>
          <div className="field-row">
            <label>Text</label>
            <div className="color-control">
              <input
                aria-label="Text color picker"
                type="color"
                value={style.color ?? '#111827'}
                onChange={(event) => set('color', event.target.value)}
              />
              <input
                aria-label="Text color value"
                type="text"
                value={style.color ?? ''}
                onChange={(event) => set('color', event.target.value)}
              />
            </div>
          </div>
          <div className="field-row">
            <label>Radius</label>
            <input
              aria-label="Border radius"
              type="number"
              min={0}
              value={style.borderRadius ?? 0}
              onChange={(event) => set('borderRadius', Number(event.target.value))}
            />
          </div>
          <div className="field-row">
            <label>Font size</label>
            <input
              aria-label="Font size"
              type="number"
              min={1}
              value={style.fontSize ?? 16}
              onChange={(event) => set('fontSize', Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <header>
          <span>Responsive & reusable</span>
          <ChevronDown size={14} />
        </header>
        <div className="inspector-fields">
          <div className="prop-field">
            <div className="prop-field-heading">
              <label>CSS class references</label>
              <span className="type-pill">string[]</span>
            </div>
            <input
              aria-label="CSS class references"
              type="text"
              value={node.classRefs.join(', ')}
              placeholder="hero, card, primary"
              onChange={(event) =>
                setClassRefs(
                  node.id,
                  event.target.value.split(',').map((value) => value.trim()),
                )
              }
            />
            <p className="field-help">Class names are preserved in JSON and generated TSX.</p>
          </div>
          <div className="field-row">
            <label>Visible</label>
            <select
              aria-label="Visibility expression"
              value={
                node.visible.kind === 'reference'
                  ? `reference:${node.visible.symbolId}`
                  : node.visible.kind === 'unary' && node.visible.operand.kind === 'reference'
                    ? `not:${node.visible.operand.symbolId}`
                    : node.visible.kind === 'literal' && node.visible.value === false
                      ? 'false'
                      : 'true'
              }
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'true' || value === 'false') {
                  setVisibility(node.id, { kind: 'literal', value: value === 'true' });
                } else if (value.startsWith('not:')) {
                  setVisibility(node.id, {
                    kind: 'unary',
                    operator: 'not',
                    operand: { kind: 'reference', symbolId: value.slice(4), path: [] },
                  });
                } else {
                  setVisibility(node.id, {
                    kind: 'reference',
                    symbolId: value.slice('reference:'.length),
                    path: [],
                  });
                }
              }}
            >
              <option value="true">Always</option>
              <option value="false">Hidden</option>
              {Object.values(useStudioStore.getState().document.symbols)
                .filter((symbol) => symbol.valueType === 'boolean')
                .flatMap((symbol) => [
                  <option key={`reference:${symbol.id}`} value={`reference:${symbol.id}`}>
                    {symbol.name}
                  </option>,
                  <option key={`not:${symbol.id}`} value={`not:${symbol.id}`}>
                    !{symbol.name}
                  </option>,
                ])}
            </select>
          </div>
        </div>
      </section>
    </>
  );
}

function CustomReferenceFields({
  expression,
  onChange,
}: {
  expression: ValueExpression;
  onChange: (value: ValueExpression) => void;
}) {
  const current =
    expression.kind === 'customCodeReference'
      ? expression
      : { kind: 'customCodeReference' as const, moduleId: 'logic', exportName: 'value', args: [] };
  return (
    <div className="custom-reference-grid">
      <input
        aria-label="Custom module ID"
        value={current.moduleId}
        onChange={(event) =>
          onChange({
            ...current,
            moduleId: (() => {
              const value = event.target.value.replace(/[^A-Za-z0-9_-]/g, '_');
              if (!value) return 'logic';
              return /^[A-Za-z]/.test(value) ? value : `_${value}`;
            })(),
          })
        }
        placeholder="module"
      />
      <input
        aria-label="Custom export name"
        value={current.exportName}
        onChange={(event) =>
          onChange({
            ...current,
            exportName: (() => {
              const value = event.target.value.replace(/[^A-Za-z0-9_$]/g, '_');
              if (!value) return 'value';
              return /^[A-Za-z_$]/.test(value) ? value : `_${value}`;
            })(),
          })
        }
        placeholder="exportName"
      />
    </div>
  );
}

function ConditionEditor({ node }: { node: IfNode }) {
  const symbols = useStudioStore((state) => state.document.symbols);
  const activeBranch = useStudioStore((state) => state.activeIfBranches[node.id] ?? 'whenTrue');
  const setActiveIfBranch = useStudioStore((state) => state.setActiveIfBranch);
  const setIfCondition = useStudioStore((state) => state.setIfCondition);
  const expression = node.condition;
  const mode =
    expression.kind === 'reference'
      ? `reference:${expression.symbolId}`
      : expression.kind === 'unary' && expression.operand.kind === 'reference'
        ? `not:${expression.operand.symbolId}`
        : expression.kind === 'customCodeReference'
          ? 'custom'
          : expression.kind === 'literal' && expression.value === false
            ? 'false'
            : 'true';
  const booleanSymbols = Object.values(symbols).filter((symbol) => symbol.valueType === 'boolean');

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
              } else if (value === 'custom') {
                setIfCondition(node.id, {
                  kind: 'customCodeReference',
                  moduleId: 'logic',
                  exportName: 'condition',
                  args: [],
                });
              } else if (value.startsWith('not:')) {
                setIfCondition(node.id, {
                  kind: 'unary',
                  operator: 'not',
                  operand: { kind: 'reference', symbolId: value.slice(4), path: [] },
                });
              } else {
                setIfCondition(node.id, {
                  kind: 'reference',
                  symbolId: value.slice('reference:'.length),
                  path: [],
                });
              }
            }}
          >
            <option value="true">Literal · true branch</option>
            <option value="false">Literal · false branch</option>
            {booleanSymbols.flatMap((symbol) => [
              <option key={`reference:${symbol.id}`} value={`reference:${symbol.id}`}>
                Prop · {symbol.name}
              </option>,
              <option key={`not:${symbol.id}`} value={`not:${symbol.id}`}>
                Not · {symbol.name}
              </option>,
            ])}
            <option value="custom">Custom code reference</option>
          </select>
        </div>
        {expression.kind === 'customCodeReference' && (
          <CustomReferenceFields
            expression={expression}
            onChange={(value) => setIfCondition(node.id, value)}
          />
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
  const symbols = useStudioStore((state) => state.document.symbols);
  const setRepeatSource = useStudioStore((state) => state.setRepeatSource);
  const expression = node.source;
  const mode =
    expression.kind === 'reference'
      ? `reference:${expression.symbolId}`
      : expression.kind === 'customCodeReference'
        ? 'custom'
        : 'empty';
  const sourceSymbols = Object.values(symbols).filter(
    (symbol) =>
      (symbol.valueType === 'array' || symbol.valueType === 'unknown') &&
      symbol.provider !== 'repeatItem' &&
      symbol.provider !== 'repeatIndex',
  );

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
              else if (value === 'custom') {
                setRepeatSource(node.id, {
                  kind: 'customCodeReference',
                  moduleId: 'logic',
                  exportName: 'items',
                  args: [],
                });
              } else {
                setRepeatSource(node.id, {
                  kind: 'reference',
                  symbolId: value.slice('reference:'.length),
                  path: [],
                });
              }
            }}
          >
            <option value="empty">No collection</option>
            {sourceSymbols.map((symbol) => (
              <option key={symbol.id} value={`reference:${symbol.id}`}>
                Prop · {symbol.name} ({symbol.valueType})
              </option>
            ))}
            <option value="custom">Custom code reference</option>
          </select>
        </div>
        {expression.kind === 'customCodeReference' && (
          <CustomReferenceFields
            expression={expression}
            onChange={(value) => setRepeatSource(node.id, value)}
          />
        )}
        <div className="symbol-pair">
          <span>item → {symbols[node.itemSymbolId]?.name ?? node.itemSymbolId}</span>
          <span>index → {symbols[node.indexSymbolId]?.name ?? node.indexSymbolId}</span>
        </div>
      </div>
    </section>
  );
}

function EventsEditor({ node }: { node: ElementNode }) {
  const document = useStudioStore((state) => state.document);
  const bindEvent = useStudioStore((state) => state.bindEvent);
  const manifest = componentRegistry.require(node.componentId).manifest;
  const eventSymbols = Object.values(document.symbols).filter(
    (symbol) => symbol.valueType === 'event',
  );
  return (
    <section className="inspector-section">
      <header>
        <span>Event ports</span>
        <ChevronDown size={14} />
      </header>
      <div className="inspector-fields">
        {Object.entries(manifest.events).map(([eventName, spec]) => {
          const expression = node.events[eventName];
          return (
            <div className="prop-field" key={eventName}>
              <div className="prop-field-heading">
                <label>{spec.displayName}</label>
                <span className="type-pill">{spec.payloadType}</span>
              </div>
              <select
                aria-label={`${spec.displayName} action`}
                value={expression?.kind === 'reference' ? expression.symbolId : ''}
                onChange={(event) => bindEvent(node.id, eventName, event.target.value || null)}
              >
                <option value="">No action</option>
                {eventSymbols.map((symbol) => (
                  <option key={symbol.id} value={symbol.id}>
                    {symbol.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        {Object.keys(manifest.events).length === 0 && (
          <p className="empty-copy">This component exposes no events.</p>
        )}
      </div>
    </section>
  );
}

function PublicPropsEditor() {
  const document = useStudioStore((state) => state.document);
  const addPublicProp = useStudioStore((state) => state.addPublicProp);
  const [name, setName] = useState('');
  const [type, setType] = useState<ValueType>('string');
  return (
    <section className="inspector-section public-props-section">
      <header>
        <span>Public page props</span>
        <span className="count-pill">{Object.keys(document.publicProps).length}</span>
      </header>
      <div className="public-prop-list">
        {Object.values(document.publicProps).map((prop) => (
          <div className="public-prop" key={prop.symbolId}>
            <Braces size={13} />
            <span>{prop.name}</span>
            <small>{prop.valueType}</small>
          </div>
        ))}
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
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="color">color</option>
          <option value="event">event</option>
          <option value="array">array</option>
          <option value="object">object</option>
          <option value="unknown">unknown</option>
        </select>
        <button
          className="icon-button"
          type="button"
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

export function Inspector() {
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const tab = useStudioStore((state) => state.inspectorTab);
  const setTab = useStudioStore((state) => state.setInspectorTab);
  const dispatch = useStudioStore((state) => state.dispatch);
  const removeSelectedNode = useStudioStore((state) => state.removeSelectedNode);
  const node = document.nodes[selectedNodeId];
  const title = useMemo(() => {
    if (!node) return 'Nothing selected';
    if (node.kind === 'element')
      return componentRegistry.get(node.componentId)?.manifest.displayName ?? node.name;
    return node.kind === 'if' ? 'If / Else' : node.kind === 'repeat' ? 'Repeat' : node.kind;
  }, [node]);

  return (
    <aside className="inspector-panel">
      <div className="inspector-heading">
        <div className="selection-icon">
          <Box size={17} />
        </div>
        <div>
          <span className="eyebrow">SELECTED</span>
          <h2>{title}</h2>
        </div>
        {node && node.id !== document.rootNodeId && (
          <button
            className="icon-button danger"
            type="button"
            title="Delete node"
            onClick={removeSelectedNode}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {node && (
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

      <nav className="inspector-tabs">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={tab === item.id ? 'is-active' : ''}
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
            >
              <Icon size={13} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="inspector-scroll">
        {node?.kind === 'element' && tab === 'design' && <DesignEditor node={node} />}
        {node?.kind === 'element' && tab === 'props' && <PropEditor node={node} />}
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
        <PublicPropsEditor />
      </div>
    </aside>
  );
}
