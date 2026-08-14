import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  createBlankDocument,
  createElementNode,
  eventExpressionArgument,
  literal,
  type IfNode,
  type PublicProp,
  type RepeatNode,
  type UiDocument,
} from '@srijika/contracts';
import { generateTsx } from '@srijika/react-codegen';

function createCodegenFixture(): UiDocument {
  const document = createBlankDocument('page_codegen', 'Generated home');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected root element');

  const showProp: PublicProp = {
    symbolId: 'prop_show',
    name: 'show',
    displayName: 'Show',
    valueType: 'boolean',
    required: true,
  };
  const eventProp: PublicProp = {
    symbolId: 'event_save',
    name: 'onSave',
    displayName: 'On save',
    valueType: 'event',
    required: false,
  };
  document.publicProps = { show: showProp, onSave: eventProp };
  document.symbols = {
    prop_show: { ...showProp, id: showProp.symbolId, provider: 'prop' },
    event_save: { ...eventProp, id: eventProp.symbolId, provider: 'event' },
  };

  const branch: IfNode = {
    kind: 'if',
    id: 'condition',
    name: 'Show actions',
    condition: { kind: 'reference', symbolId: 'prop_show', path: [] },
    whenTrue: ['save_button'],
    whenFalse: ['empty_text'],
  };
  const saveButton = createElementNode('save_button', 'srijika.button', 'Save button', {
    props: {
      label: literal('Save </script> safely'),
      disabled: literal(false),
    },
    events: {
      onClick: { kind: 'reference', symbolId: 'event_save', path: [] },
    },
    slots: {},
  });
  const emptyText = createElementNode('empty_text', 'srijika.text', 'Empty text', {
    props: { text: literal('Nothing to show') },
    slots: {},
  });

  root.slots['children'] = [branch.id];
  document.nodes[branch.id] = branch;
  document.nodes[saveButton.id] = saveButton;
  document.nodes[emptyText.id] = emptyText;
  return document;
}

function createStructuralFixture(): UiDocument {
  const document = createBlankDocument('page_structures', 'All structures');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected root element');
  root.style.base = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'start',
    justifyContent: 'end',
    width: { mode: 'fill' },
    height: { mode: 'hug' },
    minWidth: 320,
    maxWidth: 1440,
    gap: 12,
    padding: { top: 1, right: 2, bottom: 3, left: 4 },
    margin: { top: 4, right: 3, bottom: 2, left: 1 },
    borderWidth: 1,
  };
  document.publicProps['items'] = {
    symbolId: 'prop_items',
    name: 'items',
    displayName: 'Items',
    valueType: 'unknown',
    required: true,
  };
  document.symbols['prop_items'] = {
    id: 'prop_items',
    name: 'items',
    displayName: 'Items',
    provider: 'prop',
    valueType: 'unknown',
    required: true,
  };
  document.symbols['item'] = {
    id: 'item',
    name: 'entry',
    displayName: 'Entry',
    provider: 'repeatItem',
    valueType: 'unknown',
    required: true,
  };
  document.symbols['index'] = {
    id: 'index',
    name: 'index',
    displayName: 'Index',
    provider: 'repeatIndex',
    valueType: 'number',
    required: true,
  };

  const repeat: RepeatNode = {
    kind: 'repeat',
    id: 'repeat',
    name: 'Repeat',
    source: { kind: 'reference', symbolId: 'prop_items', path: [] },
    itemSymbolId: 'item',
    indexSymbolId: 'index',
    children: ['repeat_expression'],
  };
  const input = createElementNode('input', 'srijika.input', 'Input', {
    props: { label: literal('Name'), placeholder: literal('Enter name') },
    slots: {},
  });
  const heading = createElementNode('heading', 'srijika.heading', 'Heading', {
    props: { text: literal('Heading'), level: literal(9) },
    slots: {},
    style: {
      base: {
        minWidth: 0,
        maxWidth: 760,
        overflowWrap: 'anywhere',
      },
    },
  });
  const grid = createElementNode('grid', 'srijika.grid', 'Grid', {
    props: { columns: literal(3) },
    slots: { children: [] },
  });
  const container = createElementNode('container', 'srijika.container', 'Container', {
    props: { ariaLabel: literal('Content') },
    slots: { children: [] },
    classRefs: ['surface', 'rounded'],
    style: {
      base: {
        width: { mode: 'fixed', value: 20, unit: 'rem' },
        height: { mode: 'auto' },
      },
    },
  });
  root.slots['children'] = [
    'fragment',
    'slot',
    repeat.id,
    input.id,
    heading.id,
    grid.id,
    container.id,
  ];
  Object.assign(document.nodes, {
    fragment: {
      kind: 'fragment',
      id: 'fragment',
      name: 'Fragment',
      children: ['plain_text'],
    },
    plain_text: { kind: 'text', id: 'plain_text', name: 'Text', value: literal('Hello') },
    slot: {
      kind: 'slot',
      id: 'slot',
      name: 'Slot',
      slotName: 'content',
      fallback: ['slot_expression'],
    },
    slot_expression: {
      kind: 'expression',
      id: 'slot_expression',
      name: 'Slot expression',
      expression: literal(42),
    },
    [repeat.id]: repeat,
    repeat_expression: {
      kind: 'expression',
      id: 'repeat_expression',
      name: 'Item expression',
      expression: { kind: 'reference', symbolId: 'item', path: ['name'] },
    },
    [input.id]: input,
    [heading.id]: heading,
    [grid.id]: grid,
    [container.id]: container,
  });
  return document;
}

function createBoundContainerFixture(): UiDocument {
  const document = createBlankDocument('page_bound', 'customer dashboard');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected root element');
  const itemShape = {
    kind: 'object',
    additionalProperties: false,
    fields: {
      name: { required: true, shape: { kind: 'string' } },
    },
  } as const;
  const declarations = {
    containerClass: {
      symbolId: 'prop_class',
      name: 'containerClass',
      displayName: 'Container class',
      valueType: 'string',
      valueShape: { kind: 'string' },
      required: true,
    },
    containerStyle: {
      symbolId: 'prop_style',
      name: 'containerStyle',
      displayName: 'Container style',
      valueType: 'object',
      valueShape: {
        kind: 'object',
        additionalProperties: true,
        fields: {
          backgroundColor: { required: false, shape: { kind: 'string' } },
        },
      },
      required: true,
    },
    items: {
      symbolId: 'prop_items',
      name: 'items',
      displayName: 'Items',
      valueType: 'array',
      valueShape: { kind: 'array', item: itemShape },
      required: true,
    },
  } as const satisfies Record<string, PublicProp>;
  document.publicProps = declarations;
  document.symbols = Object.fromEntries(
    Object.values(declarations).map((prop) => [
      prop.symbolId,
      { ...prop, id: prop.symbolId, provider: 'prop' as const },
    ]),
  );
  document.symbols['item'] = {
    id: 'item',
    name: 'item',
    displayName: 'Item',
    provider: 'repeatItem',
    valueType: 'object',
    valueShape: itemShape,
    required: true,
  };
  document.symbols['index'] = {
    id: 'index',
    name: 'index',
    displayName: 'Index',
    provider: 'repeatIndex',
    valueType: 'number',
    valueShape: { kind: 'number' },
    required: true,
  };

  const container = createElementNode('surface', 'srijika.container', 'Surface', {
    props: {
      as: literal('section'),
      ariaLabel: literal('Customers'),
      className: { kind: 'reference', symbolId: 'prop_class', path: [] },
      style: { kind: 'reference', symbolId: 'prop_style', path: [] },
    },
    classRefs: ['surface'],
    slots: { children: ['repeat'] },
  });
  const repeat: RepeatNode = {
    kind: 'repeat',
    id: 'repeat',
    name: 'Customers',
    source: { kind: 'reference', symbolId: 'prop_items', path: [] },
    itemSymbolId: 'item',
    indexSymbolId: 'index',
    children: ['customer_name'],
  };
  const text = createElementNode('customer_name', 'srijika.text', 'Customer name', {
    props: {
      text: { kind: 'reference', symbolId: 'item', path: ['name'] },
    },
    slots: {},
  });
  root.slots['children'] = [container.id];
  Object.assign(document.nodes, {
    [container.id]: container,
    [repeat.id]: repeat,
    [text.id]: text,
  });
  return document;
}

function expectStrictTsxToCompile(output: string): void {
  const temporaryDirectory = mkdtempSync(join(process.cwd(), '.srijika-codegen-'));
  const generatedFile = join(temporaryDirectory, 'GeneratedPage.tsx');
  const rendererDeclaration = join(temporaryDirectory, 'srijika-react-renderer.d.ts');
  writeFileSync(generatedFile, output, 'utf8');
  writeFileSync(
    rendererDeclaration,
    [
      "declare module '@srijika/react-renderer' { import type { CSSProperties } from 'react'; export function srijikaStyle(value: unknown): CSSProperties; export function srijikaResponsiveStyle(value: unknown, viewportWidth: number): CSSProperties; export function useSrijikaViewportWidth(explicitWidth?: number): number; }",
      "declare module '@srijika/core-components' { import type { CSSProperties, ReactNode } from 'react'; interface VisualProps { [key: string]: unknown; className?: string; style?: CSSProperties; } export function srijikaInputPartStyle(value: unknown): CSSProperties; export function SrijikaAvatar(props: VisualProps): ReactNode; export function SrijikaBadge(props: VisualProps): ReactNode; export function SrijikaChart(props: VisualProps): ReactNode; export function SrijikaDivider(props: VisualProps): ReactNode; export function SrijikaIcon(props: VisualProps): ReactNode; export function SrijikaProgress(props: VisualProps): ReactNode; }",
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const result = spawnSync(
      join(process.cwd(), 'node_modules', '.bin', 'tsc'),
      [
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--jsx',
        'react-jsx',
        rendererDeclaration,
        generatedFile,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(`${result.stdout}${result.stderr}`).toBe('');
    expect(result.status).toBe(0);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

describe('React TSX code generator', () => {
  it('is deterministic, typed and free of editor-only attributes', () => {
    const document = createCodegenFixture();

    const first = generateTsx(document);
    const second = generateTsx(structuredClone(document));

    expect(second).toBe(first);
    expect(first).toContain('export interface GeneratedHomePageProps');
    expect(first).toContain('onSave?: () => void;');
    expect(first).toContain('show: boolean;');
    expect(first).toContain('props.show ? (');
    expect(first).toContain('onClick={() => props.onSave?.()}');
    expect(first).toContain('srijika-button--');
    expect(first).toContain('Save </script> safely');
    expect(first).not.toContain('data-srijika-node');
    expect(first).not.toContain('data-srijika-selected');
  });

  it('emits syntactically valid TSX', () => {
    const output = generateTsx(createCodegenFixture());
    expectStrictTsxToCompile(output);
  });

  it('emits a typed event payload and forwards the normalized Input value', () => {
    const document = createBlankDocument('page_input_event', 'Input event');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const eventProp: PublicProp = {
      symbolId: 'event_value_changed',
      name: 'onValueChanged',
      displayName: 'On value changed',
      valueType: 'event',
      eventSignature: { payload: { name: 'value', shape: { kind: 'string' } } },
      required: false,
    };
    document.publicProps[eventProp.name] = eventProp;
    document.symbols[eventProp.symbolId] = {
      ...eventProp,
      id: eventProp.symbolId,
      provider: 'event',
    };
    const input = createElementNode('name_input', 'srijika.input', 'Name input', {
      props: {
        label: literal('Name'),
        hideLabel: literal(true),
        labelStyle: literal({ color: '#8b5cf6', fontWeight: 700 }),
        controlStyle: literal({ backgroundColor: '#111827', color: '#f9fafb', borderRadius: 12 }),
      },
      events: {
        onChange: { kind: 'reference', symbolId: eventProp.symbolId, path: [] },
      },
      slots: {},
    });
    root.slots['children'] = [input.id];
    document.nodes[input.id] = input;

    const output = generateTsx(document);

    expect(output).toContain('onValueChanged?: (value: string) => void;');
    expect(output).toContain(
      'onChange={(event) => props.onValueChanged?.(event.currentTarget.value)}',
    );
    expect(output).toContain("import { srijikaInputPartStyle } from '@srijika/core-components';");
    expect(output).toContain(
      'style={srijikaInputPartStyle({"backgroundColor":"#111827","color":"#f9fafb","borderRadius":12})}',
    );
    expect(output).toContain(
      'aria-label={Boolean(true) ? String("Name") || undefined : undefined}',
    );
    expect(output).toContain('{!Boolean(true) ? <span');
    expectStrictTsxToCompile(output);
  });

  it('emits literal and page-prop event arguments with a strict optional-prop fallback', () => {
    const document = createBlankDocument('page_mapped_events', 'Mapped events');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const countProp: PublicProp = {
      symbolId: 'prop_count',
      name: 'count',
      displayName: 'Count',
      valueType: 'number',
      valueShape: { kind: 'number' },
      required: false,
      defaultValue: 3,
    };
    const fixedEvent: PublicProp = {
      symbolId: 'event_fixed_count',
      name: 'onFixedCount',
      displayName: 'On fixed count',
      valueType: 'event',
      eventSignature: { payload: { name: 'count', shape: { kind: 'number' } } },
      required: false,
    };
    const currentEvent: PublicProp = {
      symbolId: 'event_current_count',
      name: 'onCurrentCount',
      displayName: 'On current count',
      valueType: 'event',
      eventSignature: { payload: { name: 'count', shape: { kind: 'number' } } },
      required: false,
    };
    document.publicProps = {
      [countProp.name]: countProp,
      [fixedEvent.name]: fixedEvent,
      [currentEvent.name]: currentEvent,
    };
    document.symbols = Object.fromEntries(
      [countProp, fixedEvent, currentEvent].map((prop) => [
        prop.symbolId,
        {
          ...prop,
          id: prop.symbolId,
          provider: prop.valueType === 'event' ? ('event' as const) : ('prop' as const),
        },
      ]),
    );

    const button = createElementNode('fixed_count_button', 'srijika.button', 'Fixed count', {
      props: { label: literal('Use five') },
      events: {
        onClick: { kind: 'reference', symbolId: fixedEvent.symbolId, path: [] },
      },
      eventArguments: {
        onClick: eventExpressionArgument(literal(5)),
      },
      slots: {},
    });
    const input = createElementNode('current_count_input', 'srijika.input', 'Current count', {
      props: { label: literal('Current count') },
      events: {
        onChange: { kind: 'reference', symbolId: currentEvent.symbolId, path: [] },
      },
      eventArguments: {
        onChange: eventExpressionArgument({
          kind: 'reference',
          symbolId: countProp.symbolId,
          path: [],
        }),
      },
      slots: {},
    });
    root.slots['children'] = [button.id, input.id];
    document.nodes[button.id] = button;
    document.nodes[input.id] = input;

    const output = generateTsx(document);

    expect(output).toContain('count?: number;');
    expect(output).toContain('onFixedCount?: (count: number) => void;');
    expect(output).toContain('onCurrentCount?: (count: number) => void;');
    expect(output).toContain('onClick={() => props.onFixedCount?.(5)}');
    expect(output).toContain('props.onCurrentCount?.(');
    expect(output).toContain('(props.count ?? 3)');
    expect(output).not.toContain('props.onCurrentCount?.(event.currentTarget.value)');
    expectStrictTsxToCompile(output);
  });

  it('preserves optional page-prop defaults in component content and nested references', () => {
    const document = createBlankDocument('page_default_bindings', 'Default bindings');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const titleProp: PublicProp = {
      symbolId: 'prop_title',
      name: 'title',
      displayName: 'Title',
      valueType: 'string',
      required: false,
      defaultValue: 'Ship faster',
    };
    const cardProp: PublicProp = {
      symbolId: 'prop_card',
      name: 'card',
      displayName: 'Card',
      valueType: 'object',
      valueShape: {
        kind: 'object',
        fields: { label: { shape: { kind: 'string' }, required: true } },
        additionalProperties: false,
      },
      required: false,
      defaultValue: { label: 'Default card' },
    };
    document.publicProps = { title: titleProp, card: cardProp };
    document.symbols = {
      [titleProp.symbolId]: { ...titleProp, id: titleProp.symbolId, provider: 'prop' },
      [cardProp.symbolId]: { ...cardProp, id: cardProp.symbolId, provider: 'prop' },
    };
    const title = createElementNode('default_title', 'srijika.heading', 'Default title', {
      props: { text: { kind: 'reference', symbolId: titleProp.symbolId, path: [] } },
      slots: {},
    });
    const label = createElementNode('default_label', 'srijika.text', 'Default label', {
      props: {
        text: { kind: 'reference', symbolId: cardProp.symbolId, path: ['label'] },
      },
      slots: {},
    });
    root.slots['children'] = [title.id, label.id];
    document.nodes[title.id] = title;
    document.nodes[label.id] = label;

    const output = generateTsx(document);

    expect(output).toContain('{(props.title ?? "Ship faster")}');
    expect(output).toContain('{(props.card ?? {"label":"Default card"})?.["label"]}');
    expectStrictTsxToCompile(output);
  });

  it('escapes reserved Repeat callback names while keeping expression bindings valid', () => {
    const document = createStructuralFixture();
    document.symbols['item']!.name = 'case';
    const output = generateTsx(document);

    expect(output).toContain('.map((_case, index) => (');
    expect(output).toContain('_case?.["name"]');
    expectStrictTsxToCompile(output);
  });

  it('emits repeat-scoped event arguments inside the repeat callback', () => {
    const document = createBlankDocument('page_repeat_events', 'Repeat events');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const itemsProp: PublicProp = {
      symbolId: 'prop_items',
      name: 'items',
      displayName: 'Items',
      valueType: 'array',
      valueShape: { kind: 'array', item: { kind: 'string' } },
      required: true,
    };
    const selectEvent: PublicProp = {
      symbolId: 'event_select',
      name: 'onSelect',
      displayName: 'On select',
      valueType: 'event',
      eventSignature: { payload: { name: 'index', shape: { kind: 'number' } } },
      required: false,
    };
    document.publicProps = { items: itemsProp, onSelect: selectEvent };
    document.symbols = {
      [itemsProp.symbolId]: {
        ...itemsProp,
        id: itemsProp.symbolId,
        provider: 'prop',
      },
      [selectEvent.symbolId]: {
        ...selectEvent,
        id: selectEvent.symbolId,
        provider: 'event',
      },
      repeat_item: {
        id: 'repeat_item',
        name: 'item',
        displayName: 'Item',
        provider: 'repeatItem',
        valueType: 'string',
        valueShape: { kind: 'string' },
        required: true,
      },
      repeat_index: {
        id: 'repeat_index',
        name: 'index',
        displayName: 'Index',
        provider: 'repeatIndex',
        valueType: 'number',
        valueShape: { kind: 'number' },
        required: true,
      },
    };
    const repeat: RepeatNode = {
      kind: 'repeat',
      id: 'repeat_actions',
      name: 'Repeat actions',
      source: { kind: 'reference', symbolId: itemsProp.symbolId, path: [] },
      itemSymbolId: 'repeat_item',
      indexSymbolId: 'repeat_index',
      children: ['select_button'],
    };
    const button = createElementNode('select_button', 'srijika.button', 'Select item', {
      props: { label: literal('Select') },
      events: {
        onClick: { kind: 'reference', symbolId: selectEvent.symbolId, path: [] },
      },
      eventArguments: {
        onClick: eventExpressionArgument({
          kind: 'reference',
          symbolId: 'repeat_index',
          path: [],
        }),
      },
      slots: {},
    });
    root.slots['children'] = [repeat.id];
    document.nodes[repeat.id] = repeat;
    document.nodes[button.id] = button;

    const output = generateTsx(document);

    expect(output).toContain('.map((item, index) => (');
    expect(output).toContain('props.onSelect?.(index)');
    expectStrictTsxToCompile(output);
  });

  it('keeps custom connector references inert without runtime imports', () => {
    const document = createBlankDocument('page_connector', 'Connector reference');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.slots['children'] = ['connector_expression'];
    document.nodes['connector_expression'] = {
      kind: 'expression',
      id: 'connector_expression',
      name: 'Connector expression',
      expression: {
        kind: 'customCodeReference',
        moduleId: 'customer_connector',
        exportName: 'displayName',
        args: [literal('ignored argument')],
      },
    };

    const output = generateTsx(document);

    expect(output).toContain('undefined /* customer_connector.displayName */');
    expect(output).not.toContain('ignored argument');
    expect(output).not.toContain('runtimeFunctions');
    expect(output).not.toContain('./runtime-functions');
    expectStrictTsxToCompile(output);
  });

  it('emits structural nodes, component semantics and CSS length modes', () => {
    const output = generateTsx(createStructuralFixture());

    expect(output).toContain('Array.isArray(props.items)');
    expect(output).toContain('.map((entry, index) => (');
    expect(output).toContain('<Fragment key={index}>');
    expect(output).toContain('entry?.["name"]');
    expect(output).toContain('<label');
    expect(output).toContain('type="text"');
    expect(output).toContain('placeholder={String("Enter name")}');
    expect(output).toContain('<h6');
    expect(output).toContain('minWidth: 0');
    expect(output).toContain('maxWidth: 760');
    expect(output).toContain('overflowWrap: "anywhere"');
    expect(output).toContain(
      'gridTemplateColumns: String("") || String("") || "repeat(" + Number(3)',
    );
    expect(output).toContain('aria-label={String("Content") || undefined}');
    expect(output).toContain('className="surface rounded"');
    expect(output).toContain('width: "100%"');
    expect(output).toContain('height: "fit-content"');
    expect(output).toContain('width: "20rem"');
    expect(output).toContain('height: "auto"');
    expect(output).toContain('alignItems: "flex-start"');
    expect(output).toContain('justifyContent: "flex-end"');
    expect(output).toContain('padding: "1px 2px 3px 4px"');
    expect(output).toContain('margin: "4px 3px 2px 1px"');
    expect(output).toContain('borderStyle: "solid"');
  });

  it('emits viewport-aware breakpoint styles without duplicating the component tree', () => {
    const document = createBlankDocument('page_responsive_codegen', 'Responsive export');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.componentId = 'srijika.grid';
    root.props = {
      columns: literal(4),
      columnsTemplate: literal('repeat(4, minmax(0, 1fr))'),
      rowsTemplate: literal(''),
    };
    root.style.base.display = 'grid';
    root.style.base.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    root.style.breakpoints = {
      tablet: {
        flexDirection: 'column',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      mobile: {
        gap: 10,
        gridTemplateColumns: 'minmax(0, 1fr)',
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
      },
    };

    const output = generateTsx(document);

    expect(output).toContain(
      "import { srijikaResponsiveStyle, useSrijikaViewportWidth } from '@srijika/react-renderer';",
    );
    expect(output).toContain('const srijikaViewportWidth = useSrijikaViewportWidth();');
    expect(output).toContain('style={{ ...srijikaResponsiveStyle(');
    expect(output).toContain('"breakpoints":{"tablet"');
    expect(output).toContain('gridTemplateColumns: srijikaResponsiveStyle(');
    expect(output).toContain(
      '.gridTemplateColumns || String("repeat(4, minmax(0, 1fr))") || "repeat(" + Number(4)',
    );
    expectStrictTsxToCompile(output);
  });

  it('emits neutral Text and Heading margins before authored static and dynamic styles', () => {
    const document = createBlankDocument('page_text_margin', 'Text margin');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    document.publicProps['textStyle'] = {
      symbolId: 'prop_text_style',
      name: 'textStyle',
      displayName: 'Text style',
      valueType: 'object',
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
      required: true,
    };
    document.symbols['prop_text_style'] = {
      id: 'prop_text_style',
      name: 'textStyle',
      displayName: 'Text style',
      provider: 'prop',
      valueType: 'object',
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
      required: true,
    };
    const text = createElementNode('text', 'srijika.text', 'Text', {
      props: {
        text: literal('Paragraph'),
        style: { kind: 'reference', symbolId: 'prop_text_style', path: [] },
      },
      slots: {},
      style: {
        base: {
          color: '#123456',
          margin: { top: 8, right: 7, bottom: 6, left: 5 },
        },
      },
    });
    const heading = createElementNode('heading', 'srijika.heading', 'Heading', {
      props: { text: literal('Heading'), level: literal(2) },
      slots: {},
    });
    root.slots['children'] = [text.id, heading.id];
    document.nodes[text.id] = text;
    document.nodes[heading.id] = heading;

    const output = generateTsx(document);
    const textElement = output.slice(output.indexOf('<p '), output.indexOf('</p>'));

    expect(textElement).toContain('margin: 0');
    expect(textElement).toContain('margin: "8px 7px 6px 5px"');
    expect(textElement).toContain('...srijikaStyle(props.textStyle)');
    expect(textElement.indexOf('margin: 0')).toBeLessThan(
      textElement.indexOf('margin: "8px 7px 6px 5px"'),
    );
    expect(textElement.indexOf('margin: "8px 7px 6px 5px"')).toBeLessThan(
      textElement.indexOf('...srijikaStyle(props.textStyle)'),
    );
    expect(output).toContain('<h2 style={{ ...{ margin: 0 } }}>');
    expectStrictTsxToCompile(output);
  });

  it('emits semantic containers, bound React props and shaped repeat items as strict TSX', () => {
    const output = generateTsx(createBoundContainerFixture());

    expect(output).toContain('export interface CustomerDashboardPageProps');
    expect(output).toContain('items: ReadonlyArray<{ name: string; }>');
    expect(output).toContain('<section');
    expect(output).toContain(
      'className={["surface", String(props.containerClass ?? "")].filter(Boolean).join(" ")}',
    );
    expect(output).toContain("import { srijikaStyle } from '@srijika/react-renderer';");
    expect(output).toContain('...srijikaStyle(props.containerStyle)');
    expect(output).toContain('<Fragment key={index}>');
    expect(output).toContain('{item?.["name"]}');
    expectStrictTsxToCompile(output);
  });

  it('emits every first-party visual primitive and preserves custom grid tracks', () => {
    const document = createBlankDocument('page_visual_export', 'Visual export');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const grid = createElementNode('visual_grid', 'srijika.grid', 'Visual grid', {
      props: {
        columns: literal(2),
        columnsTemplate: literal('264px minmax(0, 1fr)'),
        rowsTemplate: literal('77px minmax(0, 1fr)'),
      },
      slots: {
        children: ['icon', 'divider', 'progress', 'badge', 'avatar', 'chart'],
      },
    });
    const nodes = [
      createElementNode('icon', 'srijika.icon', 'Overview icon', {
        props: {
          name: literal('home'),
          label: literal('Overview'),
          size: literal(20),
          strokeWidth: literal(1.75),
        },
        slots: {},
      }),
      createElementNode('divider', 'srijika.divider', 'Divider', {
        props: {
          orientation: literal('horizontal'),
          color: literal('#27313b'),
          thickness: literal(1),
        },
        slots: {},
      }),
      createElementNode('progress', 'srijika.progress', 'Storage progress', {
        props: {
          value: literal(68),
          max: literal(100),
          label: literal('Storage used'),
          fillColor: literal('#6d5dfc'),
          trackColor: literal('#2a303b'),
        },
        slots: {},
      }),
      createElementNode('badge', 'srijika.badge', 'Status badge', {
        props: { label: literal('On track'), tone: literal('success'), dot: literal(true) },
        slots: {},
      }),
      createElementNode('avatar', 'srijika.avatar', 'Alex avatar', {
        props: {
          src: literal(''),
          alt: literal('Alex Johnson'),
          fallback: literal('AJ'),
          size: literal(40),
          status: literal('online'),
        },
        slots: {},
      }),
      createElementNode('chart', 'srijika.chart', 'Activity chart', {
        props: {
          chartType: literal('line'),
          curve: literal('smooth'),
          data: literal([
            [30, 48, 39, 69],
            [14, 27, 21, 42],
          ]),
          colors: literal(['#6d5dfc', '#18b8d6']),
          label: literal('Project activity'),
          showGrid: literal(true),
          strokeWidth: literal(3),
          innerRadius: literal(58),
        },
        slots: {},
      }),
    ];
    root.slots['children'] = [grid.id];
    document.nodes[grid.id] = grid;
    nodes.forEach((node) => {
      document.nodes[node.id] = node;
    });

    const output = generateTsx(document);

    expect(output).toContain(
      "import { SrijikaAvatar, SrijikaBadge, SrijikaChart, SrijikaDivider, SrijikaIcon, SrijikaProgress } from '@srijika/core-components';",
    );
    expect(output).toContain('gridTemplateColumns: String("") || String("264px minmax(0, 1fr)")');
    expect(output).toContain('gridTemplateRows: String("") || String("77px minmax(0, 1fr)")');
    expect(output).toContain('<SrijikaIcon');
    expect(output).toContain('name={"home"}');
    expect(output).toContain('<SrijikaDivider');
    expect(output).toContain('<SrijikaProgress');
    expect(output).toContain('value={68}');
    expect(output).toContain('<SrijikaBadge');
    expect(output).toContain('tone={"success"}');
    expect(output).toContain('<SrijikaAvatar');
    expect(output).toContain('fallback={"AJ"}');
    expect(output).toContain('<SrijikaChart');
    expect(output).toContain('curve={"smooth"}');
    expect(output).toContain('data={[[30,48,39,69],[14,27,21,42]]}');
    expectStrictTsxToCompile(output);
  });

  it('rejects unavailable symbols and prototype-sensitive paths during generation', () => {
    const missing = createBlankDocument('page_missing', 'Missing binding');
    const missingRoot = missing.nodes[missing.rootNodeId];
    if (!missingRoot || missingRoot.kind !== 'element') throw new Error('Expected root element');
    missingRoot.visible = { kind: 'reference', symbolId: 'missing', path: [] };
    expect(() => generateTsx(missing)).toThrow(/unavailable symbol missing/);

    const unsafe = createBlankDocument('page_unsafe', 'Unsafe binding');
    const unsafeRoot = unsafe.nodes[unsafe.rootNodeId];
    if (!unsafeRoot || unsafeRoot.kind !== 'element') throw new Error('Expected root element');
    unsafe.publicProps['settings'] = {
      symbolId: 'settings',
      name: 'settings',
      displayName: 'Settings',
      valueType: 'object',
      required: true,
    };
    unsafe.symbols['settings'] = {
      id: 'settings',
      name: 'settings',
      displayName: 'Settings',
      provider: 'prop',
      valueType: 'object',
      required: true,
    };
    unsafeRoot.visible = {
      kind: 'reference',
      symbolId: 'settings',
      path: ['constructor'],
    };
    expect(() => generateTsx(unsafe)).toThrow(/unsafe reference path/);
  });

  it('fails safely when a custom component has no code-generation adapter', () => {
    const document = createBlankDocument('page_custom', 'Custom');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.componentId = 'custom.widget';

    expect(() => generateTsx(document)).toThrow(/no registered TSX code-generation adapter/);
  });
});
