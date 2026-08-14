import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@srijika/component-registry';
import { validateUiDocument } from '@srijika/contracts';
import { assertValidDocumentGraph } from '@srijika/document-engine';
import { generateTsx } from '@srijika/react-codegen';

import { componentRegistry } from '../../apps/studio/src/lib/registry';
import {
  createSavedTemplateDocument,
  loadSavedTemplates,
  saveStudioTemplate,
  studioTemplates,
} from '../../apps/studio/src/lib/templates';

function memoryStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set('srijika-studio.custom-templates.v1', initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('Studio template catalog', () => {
  it('ships five unique, valid and code-generatable page templates', () => {
    expect(studioTemplates).toHaveLength(5);
    expect(new Set(studioTemplates.map((template) => template.id)).size).toBe(5);

    for (const template of studioTemplates) {
      const document = template.createDocument(`page_${template.id.replaceAll('-', '_')}`);
      const schema = validateUiDocument(document);
      expect(schema.valid, `${template.name} schema`).toBe(true);
      assertValidDocumentGraph(document);
      assertDocumentSemantics(document, componentRegistry);
      expect(
        Object.keys(document.nodes).length,
        `${template.name} should be a useful example`,
      ).toBeGreaterThan(15);
      expect(generateTsx(document)).toContain('export function');
    }
  });

  it('includes the requested YouTube hierarchy plus real If, Repeat, Image and action mappings', () => {
    const template = studioTemplates.find((candidate) => candidate.id === 'youtube-home');
    expect(template).toBeDefined();
    const document = template!.createDocument('page_youtube_test');

    expect(document.nodes['yt_header']).toMatchObject({ kind: 'element', name: 'Top Header' });
    expect(document.nodes['yt_sidebar']).toMatchObject({
      kind: 'element',
      name: 'Navigation Sidebar',
    });
    expect(document.nodes['yt_video_grid']).toMatchObject({
      kind: 'element',
      componentId: 'srijika.grid',
    });
    expect(Object.values(document.nodes).some((node) => node.kind === 'if')).toBe(true);
    expect(Object.values(document.nodes).some((node) => node.kind === 'repeat')).toBe(true);
    expect(
      Object.values(document.nodes).filter(
        (node) => node.kind === 'element' && node.componentId === 'srijika.image',
      ),
    ).toHaveLength(10);
    expect(generateTsx(document)).toContain('props.onOpenVideo?.("video-1")');
  });

  it('ships Orbit as a high-fidelity dashboard built from reusable visual primitives', () => {
    const template = studioTemplates.find((candidate) => candidate.id === 'analytics-dashboard');
    expect(template).toMatchObject({ name: 'Orbit Analytics', category: 'Dashboard' });
    const document = template!.createDocument('page_orbit_test');

    expect(document.nodes['orbit_shell']).toMatchObject({
      kind: 'element',
      componentId: 'srijika.grid',
      props: {
        columnsTemplate: { kind: 'literal', value: '264px minmax(0, 1fr)' },
      },
    });
    expect(document.nodes['orbit_metric_repeat']).toMatchObject({
      kind: 'repeat',
      source: { kind: 'literal' },
    });
    expect(document.nodes['dash_activity_repeat']).toMatchObject({
      kind: 'repeat',
      source: { kind: 'reference', symbolId: 'prop_activity' },
    });
    expect(document.nodes['orbit_activity_chart']).toMatchObject({
      kind: 'element',
      componentId: 'srijika.chart',
      props: {
        chartType: { kind: 'literal', value: 'line' },
        curve: { kind: 'literal', value: 'smooth' },
      },
    });
    expect(document.nodes['orbit_task_donut']).toMatchObject({
      kind: 'element',
      componentId: 'srijika.chart',
      props: { chartType: { kind: 'literal', value: 'donut' } },
    });

    const componentIds = new Set(
      Object.values(document.nodes).flatMap((node) =>
        node.kind === 'element' ? [node.componentId] : [],
      ),
    );
    for (const componentId of [
      'srijika.icon',
      'srijika.chart',
      'srijika.progress',
      'srijika.badge',
      'srijika.avatar',
      'srijika.divider',
    ]) {
      expect(componentIds.has(componentId), componentId).toBe(true);
    }
    expect(document.nodes['orbit_new_project']).toMatchObject({
      kind: 'element',
      events: { onClick: { kind: 'reference', symbolId: 'event_onOpenReport' } },
    });
    expect(Object.values(document.nodes).filter((node) => node.kind === 'if')).toHaveLength(2);
    expect(generateTsx(document)).toContain('SrijikaChart');
  });

  it('creates independent documents and persists custom template snapshots safely', () => {
    const source = studioTemplates[0]!.createDocument('page_source');
    const second = studioTemplates[0]!.createDocument('page_second');
    source.name = 'Edited after creation';
    expect(second.name).toBe('YouTube Home');

    const storage = memoryStorage();
    const saved = saveStudioTemplate(second, storage, new Date('2026-08-01T12:30:00.000Z'));
    second.name = 'Changed later';
    const loaded = loadSavedTemplates(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: saved.id, name: 'YouTube Home' });
    const applied = createSavedTemplateDocument(loaded[0]!, 'page_active');
    expect(applied.id).toBe('page_active');
    expect(applied.revision).toBe(0);
    expect(applied.name).toBe('YouTube Home');
  });

  it('ignores corrupted saved-template storage', () => {
    expect(loadSavedTemplates(memoryStorage('{broken'))).toEqual([]);
    expect(loadSavedTemplates(memoryStorage(JSON.stringify([{ id: 'bad' }])))).toEqual([]);
  });
});
