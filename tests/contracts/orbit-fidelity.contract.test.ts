import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@srijika/component-registry';
import { createCoreComponentRegistry } from '@srijika/core-components';
import { assertValidDocumentGraph } from '@srijika/document-engine';

import { loadOrbitFidelityDocument } from '../fixtures/orbit-fidelity';

describe('Orbit fidelity fixture', () => {
  it('is a complete canonical page accepted by the graph and component contracts', () => {
    const document = loadOrbitFidelityDocument();
    expect(Object.keys(document.nodes)).toHaveLength(129);
    expect(document.nodes['stats_grid']).toBeDefined();
    expect(document.nodes['charts_grid']).toBeDefined();
    expect(document.nodes['bottom_grid']).toBeDefined();
    expect(document.nodes['activity_repeat']).toBeDefined();
    const componentIds = Object.values(document.nodes)
      .filter((node) => node.kind === 'element')
      .map((node) => node.componentId);
    expect(componentIds).toEqual(
      expect.arrayContaining([
        'srijika.avatar',
        'srijika.badge',
        'srijika.chart',
        'srijika.divider',
        'srijika.icon',
        'srijika.progress',
      ]),
    );
    assertValidDocumentGraph(document);
    expect(() => assertDocumentSemantics(document, createCoreComponentRegistry())).not.toThrow();
  });
});
