import { literal, type LiteralValue, type UiDocument, type ValueShape } from '@srijika/contracts';
import { applyCommand } from '@srijika/document-engine';

import { componentRegistry } from './registry';

function createCardStyleShape(): ValueShape {
  return {
    kind: 'object',
    fields: {
      backgroundColor: { required: true, shape: { kind: 'color' } },
      borderColor: { required: true, shape: { kind: 'color' } },
      borderWidth: { required: true, shape: { kind: 'number' } },
      boxShadow: { required: true, shape: { kind: 'string' } },
    },
    additionalProperties: false,
  };
}

function createCardStyleDefault(): LiteralValue {
  return {
    backgroundColor: '#fff7ed',
    borderColor: '#f97316',
    borderWidth: 2,
    boxShadow: '0 14px 30px rgba(249, 115, 22, 0.12)',
  };
}

export function createStarterDocument(id = 'page_home', name = 'Home'): UiDocument {
  const page = componentRegistry.require('srijika.page').createNode('root');
  if (page.kind !== 'element') throw new Error('Page must be an element');
  page.name = name;
  page.locked = true;
  page.style = {
    base: {
      display: 'flex',
      flexDirection: 'column',
      width: { mode: 'percent', value: 100 },
      height: { mode: 'percent', value: 100 },
      minHeight: 760,
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      gap: 32,
      backgroundColor: '#f7f7fb',
      color: '#15151a',
    },
  };

  let document: UiDocument = {
    formatVersion: 1,
    id,
    kind: 'page',
    name,
    rootNodeId: page.id,
    revision: 0,
    nodes: { [page.id]: page },
    symbols: {
      prop_title: {
        id: 'prop_title',
        name: 'title',
        displayName: 'Title',
        provider: 'prop',
        valueType: 'string',
        required: false,
        defaultValue: 'Build applications visually',
      },
      event_get_started: {
        id: 'event_get_started',
        name: 'onGetStarted',
        displayName: 'On get started',
        provider: 'event',
        valueType: 'event',
        eventSignature: { payload: null },
        required: false,
      },
      prop_price_label: {
        id: 'prop_price_label',
        name: 'priceLabel',
        displayName: 'Price label',
        provider: 'prop',
        valueType: 'string',
        required: false,
        defaultValue: '₹499.00',
      },
      prop_card_style: {
        id: 'prop_card_style',
        name: 'cardStyle',
        displayName: 'Card style',
        provider: 'prop',
        valueType: 'object',
        valueShape: createCardStyleShape(),
        required: false,
        defaultValue: createCardStyleDefault(),
      },
    },
    publicProps: {
      title: {
        symbolId: 'prop_title',
        name: 'title',
        displayName: 'Title',
        valueType: 'string',
        required: false,
        defaultValue: 'Build applications visually',
      },
      onGetStarted: {
        symbolId: 'event_get_started',
        name: 'onGetStarted',
        displayName: 'On get started',
        valueType: 'event',
        eventSignature: { payload: null },
        required: false,
      },
      priceLabel: {
        symbolId: 'prop_price_label',
        name: 'priceLabel',
        displayName: 'Price label',
        valueType: 'string',
        required: false,
        defaultValue: '₹499.00',
      },
      cardStyle: {
        symbolId: 'prop_card_style',
        name: 'cardStyle',
        displayName: 'Card style',
        valueType: 'object',
        valueShape: createCardStyleShape(),
        required: false,
        defaultValue: createCardStyleDefault(),
      },
    },
  };

  const hero = componentRegistry.require('srijika.container').createNode('hero');
  if (hero.kind !== 'element') throw new Error('Container must be an element');
  hero.name = 'Hero Container';
  hero.props['style'] = { kind: 'reference', symbolId: 'prop_card_style', path: [] };
  hero.style.base = {
    ...hero.style.base,
    minHeight: 440,
    padding: { top: 32, right: 32, bottom: 32, left: 32 },
    gap: 20,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e3e3ec',
    borderWidth: 1,
    borderRadius: 22,
  };

  const badge = componentRegistry.require('srijika.text').createNode('badge');
  if (badge.kind !== 'element') throw new Error('Text must be an element');
  badge.name = 'Eyebrow';
  badge.props['text'] = literal('SRIJIKA STUDIO · UI MVP');
  badge.style.base = {
    ...badge.style.base,
    width: { mode: 'hug' },
    color: '#6d5dfc',
    fontSize: 12,
    fontWeight: 700,
    backgroundColor: '#efedff',
    borderRadius: 999,
    padding: { top: 7, right: 11, bottom: 7, left: 11 },
  };

  const heading = componentRegistry.require('srijika.heading').createNode('hero_heading');
  if (heading.kind !== 'element') throw new Error('Heading must be an element');
  heading.name = 'Hero Heading';
  heading.props['text'] = { kind: 'reference', symbolId: 'prop_title', path: [] };
  heading.props['level'] = literal(1);
  heading.style.base = {
    ...heading.style.base,
    minWidth: 0,
    maxWidth: 760,
    color: '#14131a',
    fontSize: 42,
    fontWeight: 700,
    overflowWrap: 'break-word',
  };

  const description = componentRegistry.require('srijika.text').createNode('hero_description');
  if (description.kind !== 'element') throw new Error('Text must be an element');
  description.name = 'Hero Description';
  description.props['text'] = literal(
    'Drag actual React components, inspect typed props, and watch the JSON and DOM stay perfectly synchronized.',
  );
  description.style.base = {
    ...description.style.base,
    maxWidth: 680,
    color: '#666573',
    fontSize: 18,
  };

  const priceLabelHeading = componentRegistry.require('srijika.heading').createNode('price_label');
  if (priceLabelHeading.kind !== 'element') throw new Error('Heading must be an element');
  priceLabelHeading.name = 'Price Label Heading';
  priceLabelHeading.props['text'] = {
    kind: 'reference',
    symbolId: 'prop_price_label',
    path: [],
  };
  priceLabelHeading.props['level'] = literal(2);
  priceLabelHeading.style.base = {
    ...priceLabelHeading.style.base,
    width: { mode: 'hug' },
    color: '#c2410c',
    fontSize: 28,
    fontWeight: 700,
  };

  const actions = componentRegistry.require('srijika.stack').createNode('hero_actions');
  if (actions.kind !== 'element') throw new Error('Stack must be an element');
  actions.name = 'Hero Actions';
  actions.style.base = {
    ...actions.style.base,
    flexDirection: 'row',
    width: { mode: 'percent', value: 100 },
    gap: 12,
  };

  const primaryButton = componentRegistry.require('srijika.button').createNode('primary_action');
  if (primaryButton.kind !== 'element') throw new Error('Button must be an element');
  primaryButton.name = 'Get Started Button';
  primaryButton.props['label'] = literal('Start building');
  primaryButton.events['onClick'] = {
    kind: 'reference',
    symbolId: 'event_get_started',
    path: [],
  };

  const secondaryButton = componentRegistry
    .require('srijika.button')
    .createNode('secondary_action');
  if (secondaryButton.kind !== 'element') throw new Error('Button must be an element');
  secondaryButton.name = 'Documentation Button';
  secondaryButton.props['label'] = literal('View architecture');
  secondaryButton.props['variant'] = literal('secondary');

  const inserts = [
    { parentId: 'root', node: hero },
    { parentId: 'hero', node: badge },
    { parentId: 'hero', node: heading },
    { parentId: 'hero', node: description },
    { parentId: 'hero', node: priceLabelHeading },
    { parentId: 'hero', node: actions },
    { parentId: 'hero_actions', node: primaryButton },
    { parentId: 'hero_actions', node: secondaryButton },
  ];

  for (const insert of inserts) {
    const parent = document.nodes[insert.parentId];
    if (!parent || parent.kind !== 'element') throw new Error('Starter parent is invalid');
    const index = parent.slots['children']?.length ?? 0;
    document = applyCommand(document, {
      kind: 'insertNode',
      parentId: insert.parentId,
      slot: 'children',
      index,
      node: insert.node,
    }).document;
  }

  document.revision = 0;
  return document;
}
