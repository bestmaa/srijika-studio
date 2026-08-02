import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildComponentCatalog } from '@sutra/automation-protocol';
import { createBlankDocument, literal, type ElementNode } from '@sutra/contracts';
import { createCoreComponentRegistry } from '@sutra/core-components';
import { SutraRenderer } from '@sutra/react-renderer';

function visualNode(componentId: string, nodeId: string): ElementNode {
  const node = createCoreComponentRegistry().require(componentId).createNode(nodeId);
  if (node.kind !== 'element') throw new Error(`Expected ${componentId} element`);
  return node;
}

describe('core visual primitives', () => {
  it('registers strongly described visual primitives and custom grid tracks', () => {
    const registry = createCoreComponentRegistry();

    expect(registry.require('sutra.grid').manifest.props).toMatchObject({
      columnsTemplate: { type: 'string', bindable: true },
      rowsTemplate: { type: 'string', bindable: true },
    });
    for (const id of [
      'sutra.icon',
      'sutra.divider',
      'sutra.progress',
      'sutra.badge',
      'sutra.avatar',
      'sutra.chart',
    ]) {
      const definition = registry.require(id);
      const node = definition.createNode(`node_${id.replace('.', '_')}`);
      expect(node).toMatchObject({ kind: 'element', componentId: id, componentVersion: 1 });
    }

    const catalog = buildComponentCatalog(registry);
    const iconEntry = catalog.find(({ id }) => id === 'sutra.icon');
    const chartEntry = catalog.find(({ id }) => id === 'sutra.chart');
    expect(iconEntry?.category).toBe('Media');
    expect(iconEntry?.props).toEqual(
      expect.arrayContaining(['label', 'name', 'size', 'strokeWidth']),
    );
    expect(chartEntry?.category).toBe('Media');
    expect(chartEntry?.props).toEqual(
      expect.arrayContaining(['chartType', 'colors', 'curve', 'data', 'innerRadius']),
    );
  });

  it('renders deterministic SVG icons and accessible dashboard primitives', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('visual_primitives', 'Visual primitives');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected page root');

    const grid = visualNode('sutra.grid', 'dashboard_grid');
    const icon = visualNode('sutra.icon', 'home_icon');
    const divider = visualNode('sutra.divider', 'divider');
    const progress = visualNode('sutra.progress', 'progress');
    const badge = visualNode('sutra.badge', 'badge');
    const avatar = visualNode('sutra.avatar', 'avatar');
    const line = visualNode('sutra.chart', 'line_chart');
    const bar = visualNode('sutra.chart', 'bar_chart');
    const donut = visualNode('sutra.chart', 'donut_chart');

    grid.props['ariaLabel'] = literal('Dashboard layout');
    grid.props['columnsTemplate'] = literal('264px minmax(0, 1fr)');
    grid.props['rowsTemplate'] = literal('77px minmax(0, 1fr)');
    grid.slots['children'] = [
      icon.id,
      divider.id,
      progress.id,
      badge.id,
      avatar.id,
      line.id,
      bar.id,
      donut.id,
    ];

    icon.props['name'] = literal('home');
    icon.props['label'] = literal('Overview');
    progress.props['value'] = literal(68);
    progress.props['label'] = literal('Storage used');
    badge.props['label'] = literal('On track');
    badge.props['tone'] = literal('success');
    badge.props['dot'] = literal(true);
    avatar.props['alt'] = literal('Alex Johnson');
    avatar.props['fallback'] = literal('AJ');
    avatar.props['status'] = literal('online');
    line.props['label'] = literal('Project activity');
    line.props['curve'] = literal('smooth');
    line.props['data'] = literal([
      [30, 48, 39, 69, 31, 47, 45],
      [14, 27, 21, 42, 16, 25, 34],
    ]);
    bar.props['chartType'] = literal('bar');
    bar.props['label'] = literal('Weekly hours');
    bar.props['data'] = literal([12, 24, 18, 31]);
    donut.props['chartType'] = literal('donut');
    donut.props['label'] = literal('Task progress');
    donut.props['data'] = literal([94, 56, 34]);

    root.slots['children'] = [grid.id];
    Object.assign(document.nodes, {
      [grid.id]: grid,
      [icon.id]: icon,
      [divider.id]: divider,
      [progress.id]: progress,
      [badge.id]: badge,
      [avatar.id]: avatar,
      [line.id]: line,
      [bar.id]: bar,
      [donut.id]: donut,
    });

    const { container } = render(
      <SutraRenderer document={document} registry={registry} mode="preview" />,
    );

    expect(screen.getByLabelText('Dashboard layout')).toHaveStyle({
      gridTemplateColumns: '264px minmax(0, 1fr)',
      gridTemplateRows: '77px minmax(0, 1fr)',
    });
    const overview = screen.getByRole('img', { name: 'Overview' });
    expect(overview.querySelector('svg')).toBeInTheDocument();
    expect(overview).not.toHaveTextContent(/\p{Extended_Pictographic}/u);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByRole('progressbar', { name: 'Storage used' })).toHaveAttribute(
      'aria-valuenow',
      '68',
    );
    expect(screen.getByText('On track')).toHaveStyle({ color: '#4add8d' });
    expect(screen.getByRole('img', { name: 'Alex Johnson' })).toHaveTextContent('AJ');
    const activityLines = screen.getByRole('img', { name: 'Project activity' });
    expect(activityLines.querySelectorAll('path')).toHaveLength(2);
    expect(activityLines.querySelector('path')).toHaveAttribute('d', expect.stringContaining('C '));
    expect(screen.getByRole('img', { name: 'Weekly hours' }).querySelectorAll('rect')).toHaveLength(
      4,
    );
    expect(
      screen.getByRole('img', { name: 'Task progress' }).querySelectorAll('circle'),
    ).toHaveLength(4);
    expect(container.querySelectorAll('svg')).toHaveLength(4);
  });
});
