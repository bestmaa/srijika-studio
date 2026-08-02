import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createCoreComponentRegistry } from '@sutra/core-components';
import { createBlankDocument, literal, type IfNode, type RepeatNode } from '@sutra/contracts';
import { SutraRenderer } from '@sutra/react-renderer';

describe('edit-mode structural layout', () => {
  it('keeps a four-item Repeat transparent inside a four-column Grid', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_repeat_grid', 'Repeat grid');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');

    const grid = registry.require('sutra.grid').createNode('metric_grid');
    const card = registry.require('sutra.container').createNode('metric_card');
    if (grid.kind !== 'element' || card.kind !== 'element') {
      throw new Error('Expected Grid and Container elements');
    }
    grid.props['columns'] = literal(4);
    const repeat: RepeatNode = {
      kind: 'repeat',
      id: 'metric_repeat',
      name: 'Metrics',
      source: { kind: 'reference', symbolId: 'metrics', path: [] },
      itemSymbolId: 'metric_item',
      indexSymbolId: 'metric_index',
      children: [card.id],
    };
    root.slots['children'] = [grid.id];
    grid.slots['children'] = [repeat.id];
    Object.assign(document.nodes, { [grid.id]: grid, [repeat.id]: repeat, [card.id]: card });

    const { container } = render(
      <SutraRenderer
        document={document}
        registry={registry}
        mode="edit"
        selectedNodeId={repeat.id}
        symbols={{ metrics: [{}, {}, {}, {}] }}
      />,
    );

    const repeatWrapper = container.querySelector<HTMLElement>('[data-sutra-node="metric_repeat"]');
    expect(repeatWrapper).toHaveStyle({ display: 'contents' });
    expect(repeatWrapper?.querySelector('.sutra-structure-content')).toHaveStyle({
      display: 'contents',
    });
    expect(container.querySelectorAll('[data-sutra-node="metric_card"]')).toHaveLength(4);
    expect(repeatWrapper).toHaveAttribute('data-sutra-selected', 'true');
  });

  it('renders at least fifty Repeat instances in edit mode before applying its safety cap', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_large_repeat', 'Large repeat');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    const item = registry.require('sutra.text').createNode('large_repeat_item');
    if (item.kind !== 'element') throw new Error('Expected Text element');
    const repeat: RepeatNode = {
      kind: 'repeat',
      id: 'large_repeat',
      name: 'Large repeat',
      source: { kind: 'reference', symbolId: 'large_items', path: [] },
      itemSymbolId: 'large_item',
      indexSymbolId: 'large_index',
      children: [item.id],
    };
    root.slots['children'] = [repeat.id];
    Object.assign(document.nodes, { [repeat.id]: repeat, [item.id]: item });

    const { container } = render(
      <SutraRenderer
        document={document}
        registry={registry}
        mode="edit"
        symbols={{ large_items: Array.from({ length: 60 }, (_, index) => index) }}
      />,
    );

    expect(container.querySelectorAll('[data-sutra-node="large_repeat_item"]')).toHaveLength(60);
  });

  it('keeps an If branch transparent inside a horizontal Flex container', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_if_flex', 'Conditional flex');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');

    const row = registry.require('sutra.stack').createNode('action_row');
    const action = registry.require('sutra.button').createNode('conditional_action');
    if (row.kind !== 'element' || action.kind !== 'element') {
      throw new Error('Expected Stack and Button elements');
    }
    row.style.base.flexDirection = 'row';
    const condition: IfNode = {
      kind: 'if',
      id: 'action_condition',
      name: 'Action availability',
      condition: literal(true),
      whenTrue: [action.id],
      whenFalse: [],
    };
    root.slots['children'] = [row.id];
    row.slots['children'] = [condition.id];
    Object.assign(document.nodes, {
      [row.id]: row,
      [condition.id]: condition,
      [action.id]: action,
    });

    const { container } = render(
      <SutraRenderer
        document={document}
        registry={registry}
        mode="edit"
        dropTargetNodeId={condition.id}
      />,
    );

    const conditionWrapper = container.querySelector<HTMLElement>(
      '[data-sutra-node="action_condition"]',
    );
    expect(conditionWrapper).toHaveStyle({ display: 'contents' });
    expect(conditionWrapper?.querySelector('.sutra-structure-content')).toHaveStyle({
      display: 'contents',
    });
    expect(conditionWrapper).toHaveAttribute('data-sutra-drop-target', 'true');
    expect(container.querySelectorAll('[data-sutra-node="conditional_action"]')).toHaveLength(1);
  });

  it('keeps an explicit drop zone for an empty structural node', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_empty_if', 'Empty condition');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    const condition: IfNode = {
      kind: 'if',
      id: 'empty_condition',
      name: 'Empty condition',
      condition: literal(true),
      whenTrue: [],
      whenFalse: [],
    };
    root.slots['children'] = [condition.id];
    document.nodes[condition.id] = condition;

    const { getByText } = render(
      <SutraRenderer document={document} registry={registry} mode="edit" />,
    );

    expect(getByText('Drop components here')).toHaveClass('sutra-empty-structure');
  });
});
