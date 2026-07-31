import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  createBlankDocument,
  createElementNode,
  literal,
  type IfNode,
  type PublicProp,
  type RepeatNode,
  type UiDocument,
} from '@sutra/contracts';
import { generateTsx } from '@sutra/react-codegen';

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
  const saveButton = createElementNode('save_button', 'sutra.button', 'Save button', {
    props: {
      label: literal('Save </script> safely'),
      disabled: literal(false),
    },
    events: {
      onClick: { kind: 'reference', symbolId: 'event_save', path: [] },
    },
    slots: {},
  });
  const emptyText = createElementNode('empty_text', 'sutra.text', 'Empty text', {
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
  const input = createElementNode('input', 'sutra.input', 'Input', {
    props: { label: literal('Name'), placeholder: literal('Enter name') },
    slots: {},
  });
  const heading = createElementNode('heading', 'sutra.heading', 'Heading', {
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
  const grid = createElementNode('grid', 'sutra.grid', 'Grid', {
    props: { columns: literal(3) },
    slots: { children: [] },
  });
  const container = createElementNode('container', 'sutra.container', 'Container', {
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

describe('React TSX code generator', () => {
  it('is deterministic, typed and free of editor-only attributes', () => {
    const document = createCodegenFixture();

    const first = generateTsx(document);
    const second = generateTsx(structuredClone(document));

    expect(second).toBe(first);
    expect(first).toContain('export interface Generated_homePageProps');
    expect(first).toContain('onSave?: () => void;');
    expect(first).toContain('show: boolean;');
    expect(first).toContain('props.show ? (');
    expect(first).toContain('onClick={props.onSave}');
    expect(first).toContain('sutra-button--');
    expect(first).toContain('Save </script> safely');
    expect(first).not.toContain('data-sutra-node');
    expect(first).not.toContain('data-sutra-selected');
  });

  it('emits syntactically valid TSX', () => {
    const output = generateTsx(createCodegenFixture());
    const temporaryDirectory = mkdtempSync(join(process.cwd(), '.sutra-codegen-'));
    const generatedFile = join(temporaryDirectory, 'GeneratedHome.tsx');
    writeFileSync(generatedFile, output, 'utf8');

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
          generatedFile,
        ],
        { cwd: process.cwd(), encoding: 'utf8' },
      );

      expect(`${result.stdout}${result.stderr}`).toBe('');
      expect(result.status).toBe(0);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('emits structural nodes, component semantics and CSS length modes', () => {
    const output = generateTsx(createStructuralFixture());

    expect(output).toContain('Array.isArray(props.items)');
    expect(output).toContain('.map((entry, index) => (');
    expect(output).toContain('entry?.["name"]');
    expect(output).toContain('<label');
    expect(output).toContain('<input placeholder={String("Enter name")}');
    expect(output).toContain('<h6');
    expect(output).toContain('minWidth: 0');
    expect(output).toContain('maxWidth: 760');
    expect(output).toContain('overflowWrap: "anywhere"');
    expect(output).toContain('gridTemplateColumns: "repeat(" + Number(3)');
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

  it('fails safely when a custom component has no code-generation adapter', () => {
    const document = createBlankDocument('page_custom', 'Custom');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.componentId = 'custom.widget';

    expect(() => generateTsx(document)).toThrow(/no registered TSX code-generation adapter/);
  });
});
