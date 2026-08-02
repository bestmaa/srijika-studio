import { describe, expect, it } from 'vitest';

import { analyzeRepeatedSiblings } from '@sutra/component-registry';
import { createCoreComponentRegistry } from '@sutra/core-components';
import {
  createBlankDocument,
  createElementNode,
  literal,
  type ElementNode,
  type TextNode,
  type UiDocument,
} from '@sutra/contracts';
import { applyCommand, validateDocumentGraph } from '@sutra/document-engine';
import { generateTsx } from '@sutra/react-codegen';
import {
  applyOperations,
  buildRepetitionAnalysis,
  type AutomationIdFactory,
} from '@sutra/automation-protocol';

function repeatedCards(): UiDocument {
  const document = createBlankDocument('page_repeat_intelligence', 'Repeat intelligence');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected page root');

  const rows = [
    ['card_alpha', 'Alpha', 'First message'],
    ['card_beta', 'Beta', 'Second message'],
    ['card_gamma', 'Gamma', 'Third message'],
  ] as const;
  for (const [id, label, copy] of rows) {
    const textId = `${id}_text`;
    const card: ElementNode = createElementNode(id, 'sutra.container', `${label} card`, {
      props: { ariaLabel: literal(label) },
      slots: { children: [textId] },
      style: {
        base: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: { top: 12, right: 12, bottom: 12, left: 12 },
        },
      },
    });
    const text: TextNode = {
      kind: 'text',
      id: textId,
      name: 'Message',
      value: literal(copy),
    };
    root.slots['children']?.push(id);
    document.nodes[id] = card;
    document.nodes[textId] = text;
  }
  return document;
}

function ids(): AutomationIdFactory {
  let sequence = 0;
  return ({ hint }) => `${hint.replace(/[^A-Za-z0-9_-]/g, '_')}_${sequence++}`;
}

describe('repeat intelligence', () => {
  it('finds deterministic contiguous sibling templates and typed literal fields', () => {
    const document = repeatedCards();
    const first = analyzeRepeatedSiblings(document);
    const second = analyzeRepeatedSiblings(structuredClone(document));

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      parentId: 'root',
      slot: 'children',
      startIndex: 0,
      nodeIds: ['card_alpha', 'card_beta', 'card_gamma'],
      instanceCount: 3,
      templateNodeId: 'card_alpha',
      confidence: 0.98,
      fields: [
        { name: 'ariaLabel', shape: { kind: 'string' }, values: ['Alpha', 'Beta', 'Gamma'] },
        {
          name: 'text',
          shape: { kind: 'string' },
          values: ['First message', 'Second message', 'Third message'],
        },
      ],
    });

    const compact = buildRepetitionAnalysis(document, { includeValues: false });
    expect(compact.candidates[0]?.fields[0]).not.toHaveProperty('values');
    const detailed = buildRepetitionAnalysis(document, { includeValues: true });
    expect(detailed.candidates[0]?.fields[0]).toHaveProperty('values', ['Alpha', 'Beta', 'Gamma']);
    const reviewed = buildRepetitionAnalysis(document, {
      candidateId: first[0]?.candidateId,
      includeValues: true,
    });
    expect(reviewed).toMatchObject({
      revision: 0,
      totalCount: 1,
      returnedCount: 1,
      candidates: [{ candidateId: first[0]?.candidateId }],
    });
    expect(
      buildRepetitionAnalysis(document, {
        candidateId: 'repeat_missing',
        includeValues: true,
      }),
    ).toMatchObject({ totalCount: 0, candidates: [] });
  });

  it('converts one candidate atomically into a typed page array and Repeat template', () => {
    const document = repeatedCards();
    const candidate = analyzeRepeatedSiblings(document)[0];
    if (!candidate) throw new Error('Expected a repeat candidate');

    const converted = applyCommand(document, {
      kind: 'convertRepeatedSiblings',
      candidateId: candidate.candidateId,
      repeatNodeId: 'message_repeat',
      repeatName: 'Messages',
      propName: 'messages',
      propDisplayName: 'Messages',
      propSymbolId: 'prop_messages',
      itemSymbolId: 'message_item',
      indexSymbolId: 'message_index',
    }).document;

    expect(validateDocumentGraph(converted)).toEqual([]);
    expect(converted.nodes['root']).toMatchObject({ slots: { children: ['message_repeat'] } });
    expect(converted.nodes['message_repeat']).toMatchObject({
      kind: 'repeat',
      source: { kind: 'reference', symbolId: 'prop_messages', path: [] },
      itemSymbolId: 'message_item',
      indexSymbolId: 'message_index',
      children: ['card_alpha'],
    });
    expect(converted.nodes['card_beta']).toBeUndefined();
    expect(converted.nodes['card_gamma']).toBeUndefined();
    expect(converted.publicProps['messages']).toMatchObject({
      valueType: 'array',
      required: false,
      valueShape: {
        kind: 'array',
        item: {
          kind: 'object',
          fields: {
            ariaLabel: { required: true, shape: { kind: 'string' } },
            text: { required: true, shape: { kind: 'string' } },
          },
        },
      },
      defaultValue: [
        { ariaLabel: 'Alpha', text: 'First message' },
        { ariaLabel: 'Beta', text: 'Second message' },
        { ariaLabel: 'Gamma', text: 'Third message' },
      ],
    });
    expect((converted.nodes['card_alpha'] as ElementNode).props['ariaLabel']).toEqual({
      kind: 'reference',
      symbolId: 'message_item',
      path: ['ariaLabel'],
    });
    expect((converted.nodes['card_alpha_text'] as TextNode).value).toEqual({
      kind: 'reference',
      symbolId: 'message_item',
      path: ['text'],
    });
    const generated = generateTsx(converted);
    expect(generated).toContain('Array.isArray((props.messages ??');
    expect(generated).toContain('.map((message, messageIndex) => (');
    expect(generated).toContain('message?.["ariaLabel"]');
    expect(generated).toContain('message?.["text"]');
    expect(analyzeRepeatedSiblings(converted)).toEqual([]);
  });

  it('exposes opt-in conversion and breakpoint style writes through atomic operations', () => {
    const document = repeatedCards();
    const candidate = analyzeRepeatedSiblings(document)[0];
    if (!candidate) throw new Error('Expected a repeat candidate');
    const result = applyOperations(
      document,
      0,
      [
        {
          kind: 'convertRepeatedSiblings',
          operationId: 'messages',
          candidateId: candidate.candidateId,
          propName: 'messages',
        },
        {
          kind: 'setStyle',
          nodeId: 'root',
          breakpoint: 'mobile',
          style: { gap: 12, flexDirection: 'column' },
        },
      ],
      createCoreComponentRegistry(),
      ids(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(1);
    expect(result.createdIds).toMatchObject({
      messages: 'messages_repeat_0',
      'messages.propSymbol': 'prop_messages_1',
      'messages.itemSymbol': 'messages_repeat_0_item_2',
      'messages.indexSymbol': 'messages_repeat_0_index_3',
    });
    expect((result.document.nodes['root'] as ElementNode).style.breakpoints?.['mobile']).toEqual({
      gap: 12,
      flexDirection: 'column',
    });
  });

  it('does not suggest visually different layouts or candidates already inside Repeat', () => {
    const mismatched = repeatedCards();
    const beta = mismatched.nodes['card_beta'];
    if (!beta || beta.kind !== 'element') throw new Error('Expected beta card');
    beta.style.base.gap = 20;
    expect(analyzeRepeatedSiblings(mismatched)).toEqual([]);

    const converted = repeatedCards();
    const candidate = analyzeRepeatedSiblings(converted)[0];
    if (!candidate) throw new Error('Expected a repeat candidate');
    const result = applyCommand(converted, {
      kind: 'convertRepeatedSiblings',
      candidateId: candidate.candidateId,
      repeatNodeId: 'repeat_cards',
      propName: 'cards',
      propSymbolId: 'prop_cards',
      itemSymbolId: 'card_item',
      indexSymbolId: 'card_index',
    }).document;
    expect(analyzeRepeatedSiblings(result)).toEqual([]);
  });
});
