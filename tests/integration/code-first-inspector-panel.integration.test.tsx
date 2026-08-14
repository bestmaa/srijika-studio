import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compileSrijikaTsx } from '@srijika/tsx-compiler';
import { describe, expect, it, vi } from 'vitest';

import {
  CodeFirstInspectorPanel,
  type InspectorLiteralPropTarget,
} from '../../apps/studio/src/components/code-first/CodeFirstInspectorPanel';

const SOURCE = `import type { ReactNode } from 'react';

export interface HomeUIProps {
  title: string;
  isReady: boolean;
  onSave: () => void;
  toolbarSlot: ReactNode;
  unusedSlot?: ReactNode;
}

export function HomeUI(props: HomeUIProps) {
  return (
    <main className="home-shell">
      <header className="site-header">
        {props.toolbarSlot}
      </header>
      <section aria-label="Welcome content">
        <h1>{props.title}</h1>
        <button className="save-button" type="button" disabled={false} onClick={props.onSave}>
          Save changes
        </button>
        {props.isReady && <p>Ready to publish</p>}
      </section>
    </main>
  );
}
`;

function compiled() {
  const result = compileSrijikaTsx('src/components/home/Home.ui.tsx', SOURCE, {
    documentKind: 'page',
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.document).not.toBeNull();
  return {
    document: result.document!,
    sourceMap: result.sourceMap,
    componentContract: result.componentContract,
  };
}

function nodeByComponent(componentId: string) {
  const { document } = compiled();
  const node = Object.values(document.nodes).find(
    (candidate) => candidate.kind === 'element' && candidate.componentId === componentId,
  );
  if (!node) throw new Error(`Expected ${componentId} node`);
  return node;
}

describe('CodeFirstInspectorPanel', () => {
  it('leads with UI/source identity and summarizes the root contract and structure', async () => {
    const user = userEvent.setup();
    const { document, sourceMap } = compiled();
    const onRevealSource = vi.fn();

    render(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={document.rootNodeId}
        fileName="src/components/home/Home.ui.tsx"
        sourceMap={sourceMap}
        selectedNodeActions={<button type="button">Edit root text safely</button>}
        onRevealSource={onRevealSource}
      />,
    );

    const identity = screen.getByLabelText('UI identity');
    expect(within(identity).getByRole('heading', { name: 'HomeUI' })).toBeVisible();
    expect(within(identity).getByText('src/components/home/Home.ui.tsx')).toBeVisible();
    expect(within(identity).getByText('2 input props')).toBeVisible();
    expect(within(identity).getByText('1 event')).toBeVisible();
    expect(within(identity).getByText('1 slot')).toBeVisible();

    const contract = screen.getByLabelText('Component contract');
    expect(within(contract).getByText('title')).toBeVisible();
    expect(within(contract).getByText('isReady')).toBeVisible();
    await user.click(within(contract).getByRole('tab', { name: /Events/ }));
    expect(within(contract).getByText('onSave')).toBeVisible();
    expect(within(contract).getByText('Required / ()')).toBeVisible();
    await user.click(within(contract).getByRole('tab', { name: /Structure/ }));
    expect(within(contract).getByText('toolbarSlot')).toBeVisible();

    const summary = screen.getByLabelText('Selected node summary');
    expect(within(summary).getByText('Selected root')).toBeVisible();
    await user.click(within(summary).getByText('Technical details'));
    expect(within(summary).getByText(document.rootNodeId)).toBeVisible();
    expect(summary).toHaveTextContent(
      `Home.ui.tsx:${sourceMap.nodes[document.rootNodeId]!.line}:${sourceMap.nodes[document.rootNodeId]!.column}`,
    );
    expect(within(summary).getByRole('button', { name: 'Edit root text safely' })).toBeVisible();
    await user.click(within(summary).getByRole('button', { name: 'Reveal main in TSX' }));
    expect(onRevealSource).toHaveBeenCalledWith(
      document.rootNodeId,
      sourceMap.nodes[document.rootNodeId],
    );

    await user.click(
      within(screen.getByLabelText('Selected element sections')).getByRole('tab', {
        name: /Structure/,
      }),
    );
    const slots = screen.getByLabelText('Node slots');
    expect(within(slots).getByText('children')).toBeVisible();
    expect(within(slots).getByText(/header, section/)).toBeVisible();
  });

  it('marks dynamic props and events as Connector-owned read-only bindings', async () => {
    const user = userEvent.setup();
    const { document, sourceMap } = compiled();
    const heading = nodeByComponent('srijika.heading');

    const { rerender } = render(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={heading.id}
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
      />,
    );

    const textProp = within(screen.getByLabelText('Node props')).getByRole('group', {
      name: 'text prop',
    });
    expect(within(textProp).getByText('UI prop binding / read-only')).toBeVisible();
    expect(within(textProp).getByText('props.title')).toBeVisible();
    expect(within(textProp).queryByRole('textbox')).not.toBeInTheDocument();

    const button = nodeByComponent('srijika.button');
    rerender(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={button.id}
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
      />,
    );
    await user.click(
      within(screen.getByLabelText('Selected element sections')).getByRole('tab', {
        name: /Events/,
      }),
    );
    const events = screen.getByLabelText('Node events');
    expect(within(events).getByText('onClick')).toBeVisible();
    expect(within(events).getByText('props.onSave')).toBeVisible();
    expect(within(events).getByText('Connector binding / read-only')).toBeVisible();
  });

  it('offers supported intrinsic props and events as validated Inspector actions', async () => {
    const user = userEvent.setup();
    const { document, sourceMap, componentContract } = compiled();
    const onInsertLiteralProp = vi.fn(() => ({ ok: true as const }));
    const onBindEvent = vi.fn(() => ({ ok: true as const }));

    render(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={document.rootNodeId}
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
        componentContract={componentContract}
        onInsertLiteralProp={onInsertLiteralProp}
        onBindEvent={onBindEvent}
      />,
    );

    const authoring = screen.getByLabelText('Available JSX attributes');
    await user.selectOptions(within(authoring).getByLabelText('Available JSX prop'), 'tabIndex');
    await user.type(within(authoring).getByLabelText('tabIndex new value'), '0');
    await user.click(within(authoring).getByRole('button', { name: 'Add tabIndex to TSX' }));
    expect(onInsertLiteralProp).toHaveBeenCalledWith({
      nodeId: document.rootNodeId,
      propName: 'tabIndex',
      value: 0,
    });

    await user.click(
      within(screen.getByLabelText('Selected element sections')).getByRole('tab', {
        name: /Events/,
      }),
    );
    const eventAuthoring = screen.getByLabelText('Available JSX attributes');
    expect(within(eventAuthoring).getByLabelText('Available React event')).toHaveValue('onClick');
    expect(within(eventAuthoring).getByLabelText('Connector callback prop')).toHaveValue('onSave');
    await user.click(within(eventAuthoring).getByRole('button', { name: 'Connect onClick' }));
    expect(onBindEvent).toHaveBeenCalledWith({
      nodeId: document.rootNodeId,
      eventName: 'onClick',
      callbackPropName: 'onSave',
    });
  });

  it('shows declared optional slots even when they are unused by the JSX tree', async () => {
    const user = userEvent.setup();
    const { document, sourceMap, componentContract } = compiled();

    render(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={document.rootNodeId}
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
        componentContract={componentContract}
      />,
    );

    const identity = screen.getByLabelText('UI identity');
    expect(within(identity).getByText('2 slots')).toBeVisible();
    const contract = screen.getByLabelText('Component contract');
    await user.click(within(contract).getByRole('tab', { name: /Structure/ }));
    const unusedSlot = within(contract).getByText('unusedSlot').closest('div');
    expect(unusedSlot).toHaveTextContent('Optional / ReactNode');
    expect(
      Object.values(document.nodes).some(
        (node) => node.kind === 'slot' && node.slotName === 'unusedSlot',
      ),
    ).toBe(false);
  });

  it('shows exact code-authored object, array, union, unknown, and imported prop types', () => {
    const source = `export interface CatalogProps {
  filters: { query: string; states?: Array<'open' | 'closed'> };
  rows: ReadonlyArray<{ id: string; active: boolean }>;
  selection: string | number | null;
  payload: ImportedPayload;
  metadata: unknown;
}
export function CatalogUI(props: CatalogProps) {
  return <main><h1>{props.filters.query}</h1><p>{props.payload.title}</p></main>;
}`;
    const result = compileSrijikaTsx('Catalog.ui.tsx', source);
    expect(result.diagnostics).toEqual([]);

    render(
      <CodeFirstInspectorPanel
        document={result.document}
        selectedNodeId={null}
        fileName="Catalog.ui.tsx"
        sourceMap={result.sourceMap}
        componentContract={result.componentContract}
      />,
    );

    const contract = screen.getByLabelText('Component contract');
    expect(contract).toHaveTextContent("{ query: string; states?: Array<'open' | 'closed'> }");
    expect(contract).toHaveTextContent('ReadonlyArray<{ id: string; active: boolean }>');
    expect(contract).toHaveTextContent('string | number | null');
    expect(contract).toHaveTextContent('ImportedPayload');
    expect(contract).toHaveTextContent('unknown');
  });

  it('shows the total contract and authors props, events, and slots separately', async () => {
    const user = userEvent.setup();
    const { document, sourceMap, componentContract } = compiled();
    const onInsertContractMember = vi.fn(() => ({ ok: true as const }));

    render(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={null}
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
        componentContract={componentContract}
        onInsertContractMember={onInsertContractMember}
      />,
    );

    expect(screen.getByText('Total 5')).toBeVisible();
    expect(screen.getByText('5 contract members')).toBeVisible();
    await user.type(screen.getByLabelText('New prop name'), 'subtitle');
    await user.selectOptions(screen.getByLabelText('New prop type'), 'string');
    await user.click(screen.getByRole('button', { name: 'Add prop to TSX' }));
    expect(onInsertContractMember).toHaveBeenLastCalledWith({
      kind: 'prop',
      name: 'subtitle',
      required: true,
      dataType: 'string',
    });

    await user.type(screen.getByLabelText('New prop name'), 'profiles');
    await user.selectOptions(screen.getByLabelText('New prop type'), 'object');
    expect(screen.getByLabelText('New prop field 1 key')).toHaveValue('id');
    await user.click(screen.getByRole('button', { name: '+ Add object field' }));
    await user.clear(screen.getByLabelText('New prop field 2 key'));
    await user.type(screen.getByLabelText('New prop field 2 key'), 'active');
    await user.selectOptions(screen.getByLabelText('New prop.active type'), 'boolean');
    await user.click(screen.getByLabelText('New prop.active required'));
    await user.click(screen.getByRole('button', { name: 'Add prop to TSX' }));
    expect(onInsertContractMember).toHaveBeenLastCalledWith({
      kind: 'prop',
      name: 'profiles',
      required: true,
      dataType: '{ id: string; active?: boolean; }',
    });

    await user.type(screen.getByLabelText('New prop name'), 'items');
    await user.selectOptions(screen.getByLabelText('New prop type'), 'array');
    await user.selectOptions(screen.getByLabelText('New prop item type'), 'object');
    expect(screen.getByLabelText('New prop item field 1 key')).toHaveValue('id');
    await user.click(screen.getByRole('button', { name: 'Add prop to TSX' }));
    expect(onInsertContractMember).toHaveBeenLastCalledWith({
      kind: 'prop',
      name: 'items',
      required: true,
      dataType: 'ReadonlyArray<{ id: string; }>',
    });

    await user.selectOptions(screen.getByLabelText('New prop type'), 'custom');
    const customType = screen.getByLabelText('New prop custom TypeScript type');
    await user.clear(customType);
    fireEvent.change(customType, { target: { value: '{ id : string ; label?: string }' } });
    fireEvent.blur(customType);
    expect(screen.getByLabelText('New prop type')).toHaveValue('object');
    expect(screen.getByLabelText('New prop field 1 key')).toHaveValue('id');
    expect(screen.getByLabelText('New prop field 2 key')).toHaveValue('label');

    const contract = screen.getByLabelText('Component contract');
    await user.click(within(contract).getByRole('tab', { name: /Events/ }));
    await user.type(screen.getByLabelText('New event name'), 'onPublish');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add event to TSX' }));
    expect(onInsertContractMember).toHaveBeenLastCalledWith({
      kind: 'event',
      name: 'onPublish',
      required: false,
    });

    await user.click(within(contract).getByRole('tab', { name: /Structure/ }));
    await user.type(screen.getByLabelText('New structure slot name'), 'footerSlot');
    await user.click(screen.getByRole('button', { name: 'Add structure slot to TSX' }));
    expect(onInsertContractMember).toHaveBeenLastCalledWith({
      kind: 'slot',
      name: 'footerSlot',
      required: false,
    });
  });

  it('submits authorized literal edits by stable node ID and surfaces validation failures', async () => {
    const user = userEvent.setup();
    const { document, sourceMap } = compiled();
    const button = nodeByComponent('srijika.button');
    const editability = vi.fn((target: InspectorLiteralPropTarget) => ({
      editable: target.propName === 'label',
      reason: 'This value is generated or must be changed in VS Code.',
    }));
    const onApplyLiteralProp = vi.fn(() => ({
      ok: false as const,
      message: 'The TSX source changed; reload before applying this edit.',
    }));

    render(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId={button.id}
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
        isLiteralPropEditable={editability}
        onApplyLiteralProp={onApplyLiteralProp}
      />,
    );

    const labelInput = screen.getByRole('textbox', { name: 'label prop value' });
    await user.clear(labelInput);
    await user.type(labelInput, 'Publish changes');
    await user.click(screen.getByRole('button', { name: 'Apply label to TSX' }));

    expect(onApplyLiteralProp).toHaveBeenCalledWith({
      nodeId: button.id,
      propName: 'label',
      previousValue: ' Save changes ',
      value: 'Publish changes',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The TSX source changed; reload before applying this edit.',
    );
    expect(screen.getByRole('combobox', { name: 'disabled prop value' })).toBeDisabled();
    expect(
      screen.getAllByText('This value is generated or must be changed in VS Code.'),
    ).not.toHaveLength(0);
  });

  it('provides useful empty states without creating a second selection model', () => {
    const { document, sourceMap } = compiled();
    const { rerender } = render(
      <CodeFirstInspectorPanel
        document={null}
        selectedNodeId={null}
        fileName="Welcome.ui.tsx"
        sourceMap={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Open a Srijika UI file' })).toBeVisible();
    expect(screen.getByLabelText('Inspector empty state')).toHaveTextContent(
      'Select a .ui.tsx file',
    );

    rerender(
      <CodeFirstInspectorPanel
        document={document}
        selectedNodeId="missing-stable-id"
        fileName="Home.ui.tsx"
        sourceMap={sourceMap}
      />,
    );
    expect(screen.getAllByRole('heading', { name: 'HomeUI' })).toHaveLength(2);
    expect(screen.getByLabelText('Selected UI function')).toHaveTextContent('Complete contract');
  });
});
