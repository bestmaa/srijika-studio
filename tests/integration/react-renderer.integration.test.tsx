import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createCoreComponentRegistry } from '@sutra/core-components';
import { createBlankDocument, createElementNode, literal, type IfNode } from '@sutra/contracts';
import { SutraRenderer } from '@sutra/react-renderer';

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
  const button = createElementNode('button', 'sutra.button', 'Save button', {
    props: { label: literal('Save'), disabled: literal(false) },
    events: {
      onClick: { kind: 'reference', symbolId: 'save', path: [] },
    },
    slots: {},
  });
  const fallback = createElementNode('fallback', 'sutra.text', 'Fallback', {
    props: { text: literal('Hidden') },
    slots: {},
  });
  root.slots['children'] = [condition.id];
  document.nodes[condition.id] = condition;
  document.nodes[button.id] = button;
  document.nodes[fallback.id] = fallback;

  return { registry, document };
}

describe('SutraRenderer', () => {
  it('renders conditions and dispatches typed preview events', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { registry, document } = createRendererFixture();

    const { rerender } = render(
      <SutraRenderer
        document={document}
        registry={registry}
        mode="preview"
        symbols={{ show: true }}
        events={{ save: onSave }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).not.toHaveAttribute('data-sutra-node');
    await user.click(button);
    expect(onSave).toHaveBeenCalledOnce();

    rerender(
      <SutraRenderer
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

  it('selects edit nodes without running their preview action', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onSelectNode = vi.fn();
    const { registry, document } = createRendererFixture();

    render(
      <SutraRenderer
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

    expect(button).toHaveAttribute('data-sutra-node', 'button');
    expect(button).toHaveAttribute('data-sutra-selected', 'true');
    await user.click(button);
    expect(onSelectNode).toHaveBeenCalledWith('button');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders repeat scopes, fragments, slots and registered expressions', () => {
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.slots['children'] = ['fragment', 'slot', 'repeat'];
    Object.assign(document.nodes, {
      fragment: {
        kind: 'fragment',
        id: 'fragment',
        name: 'Fragment',
        children: ['registered'],
      },
      registered: {
        kind: 'expression',
        id: 'registered',
        name: 'Registered expression',
        expression: {
          kind: 'registeredCall',
          functionId: 'formatTitle',
          args: [literal('Sutra')],
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
      <SutraRenderer
        document={document}
        registry={registry}
        mode="preview"
        symbols={{ people: [{ name: 'Ada' }, { name: 'Grace' }] }}
        registeredFunctions={{ formatTitle: (value) => `${String(value)} Studio` }}
      />,
    );

    const renderedPage = screen.getByRole('main');
    expect(renderedPage).toHaveTextContent('Sutra Studio');
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
    const title = createElementNode('card_title', 'sutra.heading', 'Card title', {
      props: { text: literal('Named header'), level: literal(2) },
      slots: {},
    });
    const copy = createElementNode('card_copy', 'sutra.text', 'Card copy', {
      props: { text: literal('Named body') },
      slots: {},
    });
    root.slots['children'] = ['card'];
    Object.assign(document.nodes, { card, card_title: title, card_copy: copy });

    render(<SutraRenderer document={document} registry={registry} mode="preview" />);

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
      <SutraRenderer document={document} registry={registry} mode="edit" />,
    );
    expect(screen.getByText('Missing component: custom.missing')).toBeInTheDocument();

    rerender(<SutraRenderer document={document} registry={registry} mode="preview" />);
    expect(screen.queryByText('Missing component: custom.missing')).not.toBeInTheDocument();
  });

  it('preserves canonical text wrapping styles in the rendered DOM', () => {
    const { registry, document } = createRendererFixture();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const heading = createElementNode('mobile_heading', 'sutra.heading', 'Mobile heading', {
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

    render(<SutraRenderer document={document} registry={registry} mode="preview" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveStyle({
      minWidth: 0,
      maxWidth: '760px',
      overflowWrap: 'anywhere',
    });
  });
});
