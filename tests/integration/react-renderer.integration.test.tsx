import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createCoreComponentRegistry } from '@srijika/core-components';
import {
  createBlankDocument,
  createElementNode,
  eventExpressionArgument,
  literal,
  type IfNode,
} from '@srijika/contracts';
import { evaluateExpression, SrijikaRenderer } from '@srijika/react-renderer';

function createRendererFixture() {
  const registry = createCoreComponentRegistry();
  const document = createBlankDocument('page_renderer', 'Renderer');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected root element');

  const condition: IfNode = {
    kind: 'if',
    id: 'condition',
    name: 'Conditional action',
    condition: { kind: 'reference', symbolId: 'show', path: [] },
    whenTrue: ['button'],
    whenFalse: ['fallback'],
  };
  const button = createElementNode('button', 'srijika.button', 'Save button', {
    props: { label: literal('Save'), disabled: literal(false) },
    events: {
      onClick: { kind: 'reference', symbolId: 'save', path: [] },
    },
    slots: {},
  });
  const fallback = createElementNode('fallback', 'srijika.text', 'Fallback', {
    props: { text: literal('Hidden') },
    slots: {},
  });
  root.slots['children'] = [condition.id];
  document.nodes[condition.id] = condition;
  document.nodes[button.id] = button;
  document.nodes[fallback.id] = fallback;
  document.symbols['save'] = {
    id: 'save',
    name: 'save',
    displayName: 'Save',
    provider: 'event',
    valueType: 'event',
    eventSignature: { payload: null },
    required: false,
  };

  return { registry, document };
}

describe('SrijikaRenderer', () => {
  it('renders conditions and dispatches typed preview events', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { registry, document } = createRendererFixture();

    const { rerender } = render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        symbols={{ show: true }}
        events={{ save: onSave }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).not.toHaveAttribute('data-srijika-node');
    await user.click(button);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith();

    rerender(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        symbols={{ show: false }}
        events={{ save: onSave }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('keeps legacy Input bindings as normalized payload passthrough', async () => {
    const user = userEvent.setup();
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_input_event', 'Input event');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const input = registry.require('srijika.input').createNode('name_input');
    if (input.kind !== 'element') throw new Error('Expected input element');
    input.props['label'] = literal('Name');
    input.events['onChange'] = { kind: 'reference', symbolId: 'name_changed', path: [] };
    root.slots['children'] = [input.id];
    document.nodes[input.id] = input;
    document.symbols['name_changed'] = {
      id: 'name_changed',
      name: 'nameChanged',
      displayName: 'Name changed',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'value', shape: { kind: 'string' } } },
      required: false,
    };
    expect(input.eventArguments).toBeUndefined();

    const onNameChanged = vi.fn();
    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        events={{ name_changed: onNameChanged }}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Srijika');

    expect(onNameChanged).toHaveBeenLastCalledWith('Srijika');
    expect(onNameChanged.mock.lastCall).toHaveLength(1);
  });

  it('dispatches an explicit literal argument from a payload-free Button event', async () => {
    const user = userEvent.setup();
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_literal_argument', 'Literal argument');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const button = registry.require('srijika.button').createNode('count_button');
    if (button.kind !== 'element') throw new Error('Expected button element');
    button.props['label'] = literal('Set count');
    button.events['onClick'] = { kind: 'reference', symbolId: 'count_changed', path: [] };
    button.eventArguments = {
      onClick: eventExpressionArgument(literal(5)),
    };
    root.slots['children'] = [button.id];
    document.nodes[button.id] = button;
    document.symbols['count_changed'] = {
      id: 'count_changed',
      name: 'countChanged',
      displayName: 'Count changed',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'count', shape: { kind: 'number' } } },
      required: false,
    };

    const onCountChanged = vi.fn();
    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        events={{ count_changed: onCountChanged }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Set count' }));

    expect(onCountChanged).toHaveBeenCalledOnce();
    expect(onCountChanged).toHaveBeenCalledWith(5);
  });

  it('lets an optional page-prop expression override the normalized Input payload', async () => {
    const user = userEvent.setup();
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_expression_argument', 'Expression argument');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const input = registry.require('srijika.input').createNode('quantity_input');
    if (input.kind !== 'element') throw new Error('Expected input element');
    input.props['label'] = literal('Quantity');
    input.events['onChange'] = { kind: 'reference', symbolId: 'quantity_changed', path: [] };
    input.eventArguments = {
      onChange: eventExpressionArgument({
        kind: 'reference',
        symbolId: 'prop_quantity',
        path: [],
      }),
    };
    root.slots['children'] = [input.id];
    document.nodes[input.id] = input;
    document.symbols['prop_quantity'] = {
      id: 'prop_quantity',
      name: 'quantity',
      displayName: 'Quantity',
      provider: 'prop',
      valueType: 'number',
      required: false,
      defaultValue: 12,
    };
    document.symbols['quantity_changed'] = {
      id: 'quantity_changed',
      name: 'quantityChanged',
      displayName: 'Quantity changed',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'quantity', shape: { kind: 'number' } } },
      required: false,
    };

    const onQuantityChanged = vi.fn();
    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        events={{ quantity_changed: onQuantityChanged }}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Quantity' }), '99');

    expect(onQuantityChanged).toHaveBeenLastCalledWith(12);
    expect(onQuantityChanged.mock.lastCall).toHaveLength(1);
  });

  it('drops an emitted payload when the declared callback has no payload', async () => {
    const user = userEvent.setup();
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_ignored_payload', 'Ignored payload');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');

    const input = registry.require('srijika.input').createNode('search_input');
    if (input.kind !== 'element') throw new Error('Expected input element');
    input.props['label'] = literal('Search');
    input.events['onChange'] = { kind: 'reference', symbolId: 'search_changed', path: [] };
    root.slots['children'] = [input.id];
    document.nodes[input.id] = input;
    document.symbols['search_changed'] = {
      id: 'search_changed',
      name: 'searchChanged',
      displayName: 'Search changed',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: null },
      required: false,
    };

    const onSearchChanged = vi.fn();
    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        events={{ search_changed: onSearchChanged }}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'x');

    expect(onSearchChanged).toHaveBeenCalledWith();
  });

  it('selects edit nodes without running their preview action', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onSelectNode = vi.fn();
    const { registry, document } = createRendererFixture();

    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="edit"
        symbols={{ show: true }}
        events={{ save: onSave }}
        selectedNodeId="button"
        onSelectNode={onSelectNode}
      />,
    );
    const button = screen.getByRole('button', { name: 'Save' });

    expect(button).toHaveAttribute('data-srijika-node', 'button');
    expect(button).toHaveAttribute('data-srijika-selected', 'true');
    await user.click(button);
    expect(onSelectNode).toHaveBeenCalledWith('button');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('gives direct text and expression AST nodes editor-only selection anchors', async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.slots['children'] = ['direct_text', 'direct_expression'];
    document.nodes['direct_text'] = {
      kind: 'text',
      id: 'direct_text',
      name: 'Direct text',
      value: literal('Selectable text'),
    };
    document.nodes['direct_expression'] = {
      kind: 'expression',
      id: 'direct_expression',
      name: 'Direct expression',
      expression: literal('Selectable expression'),
    };

    const { container, rerender } = render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="edit"
        selectedNodeId="direct_text"
        onSelectNode={onSelectNode}
      />,
    );
    const textAnchor = screen.getByText('Selectable text');
    expect(textAnchor).toHaveAttribute('data-srijika-node', 'direct_text');
    expect(textAnchor).toHaveAttribute('data-srijika-selected', 'true');
    await user.click(screen.getByText('Selectable expression'));
    expect(onSelectNode).toHaveBeenCalledWith('direct_expression');

    rerender(<SrijikaRenderer document={document} registry={registry} mode="preview" />);
    expect(container.querySelector('[data-srijika-node="direct_text"]')).toBeNull();
    expect(container.querySelector('[data-srijika-node="direct_expression"]')).toBeNull();
    expect(container).toHaveTextContent('Selectable textSelectable expression');
  });

  it('renders repeat scopes, fragments, slots and direct expressions', () => {
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.slots['children'] = ['fragment', 'slot', 'repeat'];
    Object.assign(document.nodes, {
      fragment: {
        kind: 'fragment',
        id: 'fragment',
        name: 'Fragment',
        children: ['direct_expression'],
      },
      direct_expression: {
        kind: 'expression',
        id: 'direct_expression',
        name: 'Direct expression',
        expression: {
          kind: 'template',
          parts: [literal('Srijika'), ' Studio'],
        },
      },
      slot: {
        kind: 'slot',
        id: 'slot',
        name: 'Fallback slot',
        slotName: 'content',
        fallback: ['slot_text'],
      },
      slot_text: {
        kind: 'text',
        id: 'slot_text',
        name: 'Fallback text',
        value: literal('Fallback content'),
      },
      repeat: {
        kind: 'repeat',
        id: 'repeat',
        name: 'People',
        source: { kind: 'reference', symbolId: 'people', path: [] },
        itemSymbolId: 'person',
        indexSymbolId: 'person_index',
        children: ['person_name'],
      },
      person_name: {
        kind: 'expression',
        id: 'person_name',
        name: 'Person name',
        expression: { kind: 'reference', symbolId: 'person', path: ['name'] },
      },
    });

    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        symbols={{ people: [{ name: 'Ada' }, { name: 'Grace' }] }}
      />,
    );

    const renderedPage = screen.getByRole('main');
    expect(renderedPage).toHaveTextContent('Srijika Studio');
    expect(renderedPage).toHaveTextContent('Fallback content');
    expect(renderedPage).toHaveTextContent('Ada');
    expect(renderedPage).toHaveTextContent('Grace');
  });

  it('preserves named slots when invoking registered component implementations', () => {
    const { registry, document } = createRendererFixture();
    registry.register({
      manifest: {
        id: 'test.card',
        version: 1,
        displayName: 'Card',
        description: 'Named-slot renderer fixture',
        category: 'Layout',
        icon: 'Square',
        props: {},
        events: {},
        slots: {
          header: { displayName: 'Header', accepts: '*', minChildren: 0 },
          body: { displayName: 'Body', accepts: '*', minChildren: 0 },
        },
        editor: {
          draggable: true,
          selectable: true,
          resizable: 'both',
          dropStrategy: 'flow',
        },
      },
      implementation: ({ slots }) => (
        <section>
          <header data-testid="card-header">{slots['header']}</header>
          <div data-testid="card-body">{slots['body']}</div>
        </section>
      ),
      createNode: (id) =>
        createElementNode(id, 'test.card', 'Card', {
          slots: { header: [], body: [] },
        }),
    });

    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const card = registry.require('test.card').createNode('card');
    if (card.kind !== 'element') throw new Error('Expected card element');
    card.slots['header'] = ['card_title'];
    card.slots['body'] = ['card_copy'];
    const title = createElementNode('card_title', 'srijika.heading', 'Card title', {
      props: { text: literal('Named header'), level: literal(2) },
      slots: {},
    });
    const copy = createElementNode('card_copy', 'srijika.text', 'Card copy', {
      props: { text: literal('Named body') },
      slots: {},
    });
    root.slots['children'] = ['card'];
    Object.assign(document.nodes, { card, card_title: title, card_copy: copy });

    render(<SrijikaRenderer document={document} registry={registry} mode="preview" />);

    expect(screen.getByTestId('card-header')).toHaveTextContent('Named header');
    expect(screen.getByTestId('card-body')).toHaveTextContent('Named body');
  });

  it('shows missing components only in edit mode', () => {
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const missing = createElementNode('missing', 'custom.missing', 'Missing', {
      slots: { children: [] },
    });
    root.slots['children'] = [missing.id];
    document.nodes[missing.id] = missing;

    const { rerender } = render(
      <SrijikaRenderer document={document} registry={registry} mode="edit" />,
    );
    expect(screen.getByText('Missing component: custom.missing')).toBeInTheDocument();

    rerender(<SrijikaRenderer document={document} registry={registry} mode="preview" />);
    expect(screen.queryByText('Missing component: custom.missing')).not.toBeInTheDocument();
  });

  it('preserves canonical text wrapping styles in the rendered DOM', () => {
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const heading = createElementNode('mobile_heading', 'srijika.heading', 'Mobile heading', {
      props: {
        text: literal('AnUninterruptedHeadingThatMustStayInsideItsViewport'),
        level: literal(1),
      },
      slots: {},
      style: {
        base: {
          minWidth: 0,
          maxWidth: 760,
          fontSize: 56,
          overflowWrap: 'anywhere',
        },
      },
    });
    root.slots['children'] = [heading.id];
    document.nodes[heading.id] = heading;

    render(<SrijikaRenderer document={document} registry={registry} mode="preview" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveStyle({
      minWidth: 0,
      maxWidth: '760px',
      overflowWrap: 'anywhere',
    });
  });

  it('neutralizes native Text and Heading margins while preserving authored margins', () => {
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const text = createElementNode('neutral_text', 'srijika.text', 'Neutral text', {
      props: { text: literal('Neutral paragraph') },
      slots: {},
    });
    const heading = createElementNode('authored_heading', 'srijika.heading', 'Authored heading', {
      props: { text: literal('Authored heading'), level: literal(2) },
      slots: {},
      style: {
        base: {
          margin: { top: 4, right: 8, bottom: 12, left: 16 },
        },
      },
    });
    root.slots['children'] = [text.id, heading.id];
    document.nodes[text.id] = text;
    document.nodes[heading.id] = heading;

    render(<SrijikaRenderer document={document} registry={registry} mode="preview" />);

    expect(screen.getByText('Neutral paragraph')).toHaveStyle({ margin: '0px' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveStyle({
      margin: '4px 8px 12px 16px',
    });
  });

  it('merges bound className and style values and renders semantic containers', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_semantic', 'Semantic');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const container = registry.require('srijika.container').createNode('semantic_container');
    if (container.kind !== 'element') throw new Error('Expected container element');
    container.props['as'] = literal('section');
    container.props['ariaLabel'] = literal('Bound surface');
    container.props['className'] = {
      kind: 'reference',
      symbolId: 'surface_class',
      path: [],
    };
    container.props['style'] = {
      kind: 'reference',
      symbolId: 'surface_style',
      path: [],
    };
    container.classRefs = ['static-surface'];
    container.style.base.backgroundColor = '#ffffff';
    root.slots['children'] = [container.id];
    document.nodes[container.id] = container;

    render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        symbols={{
          surface_class: 'bound-surface',
          surface_style: { backgroundColor: '#112233', padding: 20 },
        }}
      />,
    );

    const surface = screen.getByRole('region', { name: 'Bound surface' });
    expect(surface.tagName).toBe('SECTION');
    expect(surface).toHaveClass('static-surface', 'bound-surface');
    expect(surface).toHaveStyle({ backgroundColor: '#112233', padding: '20px' });
  });

  it('never traverses inherited or prototype-sensitive reference paths', () => {
    const inherited = Object.create({ secret: 'inherited' }) as Record<string, unknown>;
    inherited['safe'] = 'owned';

    expect(
      evaluateExpression(
        { kind: 'reference', symbolId: 'value', path: ['safe'] },
        { symbols: { value: inherited } },
      ),
    ).toBe('owned');
    expect(
      evaluateExpression(
        { kind: 'reference', symbolId: 'value', path: ['secret'] },
        { symbols: { value: inherited } },
      ),
    ).toBeUndefined();
    expect(
      evaluateExpression(
        { kind: 'reference', symbolId: 'value', path: ['__proto__'] },
        { symbols: { value: inherited } },
      ),
    ).toBeUndefined();
  });
});
