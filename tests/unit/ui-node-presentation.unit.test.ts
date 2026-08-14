import { compileSrijikaTsx } from '@srijika/tsx-compiler';
import { describe, expect, it } from 'vitest';

import { buildUiNodePresentations } from '../../apps/studio/src/components/code-first/ui-node-presentation';

const SOURCE = `export interface HomeUIProps {
  name: string;
  isReady: boolean;
}

export function HomeUI(props: HomeUIProps) {
  return (
    <main className="home-shell">
      <header className="site-header">
        <nav aria-label="Primary navigation" />
      </header>
      <section className="feature-card">
        <h2>Project overview</h2>
        <p>{props.name}</p>
      </section>
      <section className="feature-card">
        <h2>Project details</h2>
      </section>
      {props.isReady && <section id="ready-state" />}
    </main>
  );
}
`;

function compileDocument() {
  const result = compileSrijikaTsx('C:/projects/srijika/src/components/home/Home.ui.tsx', SOURCE, {
    documentKind: 'page',
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.document).not.toBeNull();
  return result.document!;
}

describe('code-first UI node presentations', () => {
  it('presents the real JSX root tag without replacing its stable node identity', () => {
    const document = compileDocument();
    const labels = buildUiNodePresentations(document);

    expect(labels[document.rootNodeId]).toEqual({
      label: 'main',
      detail: 'Main',
    });
  });

  it('uses authored tag names with semantic kinds and stable sibling ordinals', () => {
    const document = compileDocument();
    const labels = buildUiNodePresentations(document);
    const values = Object.values(labels);

    expect(values).toContainEqual({ label: 'header', detail: 'Header' });
    expect(values).toContainEqual({ label: 'nav', detail: 'Navigation' });
    expect(values).toContainEqual({ label: 'section 1', detail: 'Section' });
    expect(values).toContainEqual({ label: 'section 2', detail: 'Section' });
    expect(values).toContainEqual({ label: 'h2', detail: 'Heading 2' });
    expect(values).toContainEqual({ label: 'p', detail: 'Paragraph' });
    expect(values).toContainEqual({ label: 'If Is Ready', detail: 'Condition' });
    expect(values).toContainEqual({ label: 'section', detail: 'Section' });
  });

  it('keeps every presentation keyed by the unchanged compiler node ID', () => {
    const document = compileDocument();
    const labels = buildUiNodePresentations(document);

    expect(Object.keys(labels).sort()).toEqual(Object.keys(document.nodes).sort());
    for (const [nodeId, node] of Object.entries(document.nodes)) {
      expect(node.id).toBe(nodeId);
      expect(labels[nodeId]).toBeDefined();
    }
  });
});
