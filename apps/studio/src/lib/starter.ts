import { literal, type UiDocument } from '@sutra/contracts';
import { applyCommand } from '@sutra/document-engine';

import { componentRegistry } from './registry';

export function createStarterDocument(): UiDocument {
  const page = componentRegistry.require('sutra.page').createNode('root');
  if (page.kind !== 'element') throw new Error('Page must be an element');
  page.name = 'Home Page';
  page.style = {
    base: {
      display: 'flex',
      flexDirection: 'column',
      width: { mode: 'percent', value: 100 },
      minHeight: 760,
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      gap: 32,
      backgroundColor: '#f7f7fb',
      color: '#15151a',
    },
  };

  let document: UiDocument = {
    formatVersion: 1,
    id: 'page_home',
    kind: 'page',
    name: 'Home',
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
        required: false,
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
        required: false,
      },
    },
  };

  const hero = componentRegistry.require('sutra.container').createNode('hero');
  if (hero.kind !== 'element') throw new Error('Container must be an element');
  hero.name = 'Hero Container';
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

  const badge = componentRegistry.require('sutra.text').createNode('badge');
  if (badge.kind !== 'element') throw new Error('Text must be an element');
  badge.name = 'Eyebrow';
  badge.props['text'] = literal('SUTRA STUDIO · UI MVP');
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

  const heading = componentRegistry.require('sutra.heading').createNode('hero_heading');
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

  const description = componentRegistry.require('sutra.text').createNode('hero_description');
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

  const actions = componentRegistry.require('sutra.stack').createNode('hero_actions');
  if (actions.kind !== 'element') throw new Error('Stack must be an element');
  actions.name = 'Hero Actions';
  actions.style.base = {
    ...actions.style.base,
    flexDirection: 'row',
    width: { mode: 'percent', value: 100 },
    gap: 12,
  };

  const primaryButton = componentRegistry.require('sutra.button').createNode('primary_action');
  if (primaryButton.kind !== 'element') throw new Error('Button must be an element');
  primaryButton.name = 'Get Started Button';
  primaryButton.props['label'] = literal('Start building');
  primaryButton.events['onClick'] = {
    kind: 'reference',
    symbolId: 'event_get_started',
    path: [],
  };

  const secondaryButton = componentRegistry.require('sutra.button').createNode('secondary_action');
  if (secondaryButton.kind !== 'element') throw new Error('Button must be an element');
  secondaryButton.name = 'Documentation Button';
  secondaryButton.props['label'] = literal('View architecture');
  secondaryButton.props['variant'] = literal('secondary');

  const inserts = [
    { parentId: 'root', node: hero },
    { parentId: 'hero', node: badge },
    { parentId: 'hero', node: heading },
    { parentId: 'hero', node: description },
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
