import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@srijika/component-registry';
import { validateUiDocument } from '@srijika/contracts';
import { assertValidDocumentGraph } from '@srijika/document-engine';
import { generateTsx } from '@srijika/react-codegen';

import {
  learningExampleById,
  studioLearningExamples,
} from '../../apps/studio/src/lib/learning-examples';
import { componentRegistry } from '../../apps/studio/src/lib/registry';

const expectedCatalog = [
  ['props-values', 'Text & Numbers from Props'],
  ['props-style', 'Colors & Style from Props'],
  ['array-loop', 'Array Loop (.map)'],
  ['nested-repeat', 'Nested Object + Array Loop'],
  ['if-else', 'If / Else Branches'],
  ['logical-and', 'Logical AND (&&)'],
  ['logical-or', 'Logical OR (||)'],
  ['logical-not', 'Logical NOT (!)'],
  ['ternary', 'Ternary Value (? :)'],
  ['nullish-fallback', 'Default Fallback (??)'],
  ['typed-event-argument', 'Typed Event Argument'],
] as const;

function documentFor(exampleId: string) {
  const example = learningExampleById(exampleId);
  expect(example, `Missing learning example ${exampleId}`).toBeDefined();
  return example!.createDocument(`page_${exampleId.replaceAll('-', '_')}`);
}

function jsxFor(exampleId: string): string {
  return generateTsx(documentFor(exampleId));
}

describe('Studio learning examples', () => {
  it('ships eleven clearly named, small, independent working documents', () => {
    expect(studioLearningExamples.map(({ id, name }) => [id, name])).toEqual(expectedCatalog);
    expect(new Set(studioLearningExamples.map((example) => example.id)).size).toBe(
      studioLearningExamples.length,
    );
    expect(new Set(studioLearningExamples.map((example) => example.name)).size).toBe(
      studioLearningExamples.length,
    );

    for (const example of studioLearningExamples) {
      const document = example.createDocument(`page_${example.id.replaceAll('-', '_')}`);
      const schema = validateUiDocument(document);
      const nodeCount = Object.keys(document.nodes).length;

      expect(schema.valid, `${example.name} schema`).toBe(true);
      assertValidDocumentGraph(document);
      expect(() => assertDocumentSemantics(document, componentRegistry)).not.toThrow();
      expect(nodeCount, `${example.name} should remain a small lesson`).toBeGreaterThan(8);
      expect(nodeCount, `${example.name} should not become another mega page`).toBeLessThanOrEqual(
        30,
      );
      expect(Object.keys(document.publicProps).length).toBeLessThanOrEqual(3);
      const jsx = generateTsx(document);
      expect(jsx).toMatch(/export function \w+Page/);
      expect(jsx).not.toContain('runtimeFunctions');
    }
  });

  it('keeps props, loops, conditions, expressions and events in separate ASTs', () => {
    expect(documentFor('props-style').nodes['lesson_stage']).toMatchObject({
      kind: 'element',
      props: {
        style: { kind: 'reference', symbolId: 'prop_theme', path: ['cardStyle'] },
      },
    });

    expect(documentFor('array-loop').nodes['array_item_repeat']).toMatchObject({
      kind: 'repeat',
      source: { kind: 'reference', symbolId: 'prop_items', path: [] },
    });

    const nested = documentFor('nested-repeat');
    expect(nested.publicProps['guideData']).toMatchObject({
      valueType: 'object',
      valueShape: {
        kind: 'object',
        fields: {
          groups: {
            shape: {
              kind: 'array',
              item: {
                kind: 'object',
                fields: {
                  items: { shape: { kind: 'array' } },
                },
              },
            },
          },
        },
      },
    });
    expect(nested.nodes['nested_group_repeat']).toMatchObject({
      kind: 'repeat',
      source: { kind: 'reference', symbolId: 'prop_guideData', path: ['groups'] },
    });
    expect(nested.nodes['nested_item_repeat']).toMatchObject({
      kind: 'repeat',
      source: {
        kind: 'reference',
        symbolId: 'nested_group_repeat_item',
        path: ['items'],
      },
    });

    expect(documentFor('if-else').nodes['if_else_condition']).toMatchObject({
      kind: 'if',
      whenTrue: ['if_true_branch'],
      whenFalse: ['if_false_branch'],
    });
    expect(documentFor('logical-and').nodes['logical_and_condition']).toMatchObject({
      kind: 'if',
      condition: { kind: 'binary', operator: 'and' },
      whenFalse: [],
    });
    expect(documentFor('logical-or').nodes['logical_or_condition']).toMatchObject({
      kind: 'if',
      condition: { kind: 'binary', operator: 'or' },
      whenFalse: [],
    });
    expect(documentFor('logical-not').nodes['logical_not_condition']).toMatchObject({
      kind: 'if',
      condition: { kind: 'unary', operator: 'not' },
      whenFalse: [],
    });
    expect(documentFor('ternary').nodes['ternary_plan_badge']).toMatchObject({
      kind: 'element',
      props: { label: { kind: 'conditional' } },
    });
    expect(documentFor('typed-event-argument').nodes['event_select_button']).toMatchObject({
      kind: 'element',
      events: { onClick: { kind: 'reference', symbolId: 'event_onSelectItem' } },
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: {
            kind: 'reference',
            symbolId: 'event_item_repeat_item',
            path: ['id'],
          },
        },
      },
    });
  });

  it('generates only the focused React pattern for every lesson', () => {
    const valuesJsx = jsxFor('props-values');
    const styleJsx = jsxFor('props-style');
    const arrayJsx = jsxFor('array-loop');
    const nestedJsx = jsxFor('nested-repeat');
    const ifElseJsx = jsxFor('if-else');
    const andJsx = jsxFor('logical-and');
    const orJsx = jsxFor('logical-or');
    const notJsx = jsxFor('logical-not');
    const ternaryJsx = jsxFor('ternary');
    const nullishJsx = jsxFor('nullish-fallback');
    const eventJsx = jsxFor('typed-event-argument');

    expect(valuesJsx).toContain('props.headline');
    expect(valuesJsx).toContain('props.memberCount');
    expect(styleJsx).toContain('srijikaStyle');
    expect(styleJsx).not.toContain('.map((item, index)');
    expect(arrayJsx).toContain('.map((item, index)');
    expect(nestedJsx).toContain('.map((item, index)');
    expect(ifElseJsx).toContain('? (');
    expect(ifElseJsx).toContain(': (');
    expect(andJsx).toContain('(props.isSignedIn ?? true) && (props.hasNotifications ?? true)');
    expect(andJsx).not.toContain('.map((item, index)');
    expect(orJsx).toContain('(props.isOwner ?? false) || (props.isAdmin ?? true)');
    expect(notJsx).toContain('!((props.isLoading ?? false)) && (');
    expect(ternaryJsx).toContain('(props.isPro ?? false) ? "PRO PLAN" : "FREE PLAN"');
    expect(nullishJsx).toContain('(props.headline ?? "Default headline")');
    expect(eventJsx).toContain('props.onSelectItem?.(item?.["id"])');
    expect(eventJsx).toContain('.map((item, index)');
  });
});
