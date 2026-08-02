import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@sutra/component-registry';
import { createCoreComponentRegistry } from '@sutra/core-components';
import { assertValidDocumentGraph } from '@sutra/document-engine';

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
        'sutra.avatar',
        'sutra.badge',
        'sutra.chart',
        'sutra.divider',
        'sutra.icon',
        'sutra.progress',
      ]),
    );
    assertValidDocumentGraph(document);
    expect(() => assertDocumentSemantics(document, createCoreComponentRegistry())).not.toThrow();
  });
});
