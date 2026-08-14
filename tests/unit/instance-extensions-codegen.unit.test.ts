import { describe, expect, it } from 'vitest';

import {
  createBlankDocument,
  createInstanceEventSpec,
  literal,
  type EventSignature,
  type UiDocument,
} from '@srijika/contracts';
import { createCoreComponentRegistry } from '@srijika/core-components';
import { generateTsx } from '@srijika/react-codegen';

function addEventProp(document: UiDocument, name: string, signature: EventSignature): string {
  const symbolId = `event_${name}`;
  document.symbols[symbolId] = {
    id: symbolId,
    name,
    displayName: name,
    provider: 'event',
    valueType: 'event',
    eventSignature: signature,
    required: false,
  };
  document.publicProps[name] = {
    symbolId,
    name,
    displayName: name,
    valueType: 'event',
    eventSignature: signature,
    required: false,
  };
  return symbolId;
}

function attach(document: UiDocument, nodeId: string): void {
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected Page root');
  root.slots['children']!.push(nodeId);
}

describe('instance extensions TSX generation', () => {
  it('emits added props and a normalized no-payload click handler', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_instance_codegen', 'Instance Codegen');
    const text = registry.require('srijika.text').createNode('subject');
    if (text.kind !== 'element') throw new Error('Expected Text element');
    text.props['text'] = literal('Hello');
    text.instanceProps = {
      title: { displayName: 'title', type: 'string', required: false },
      'data-testid': { displayName: 'data-testid', type: 'string', required: true },
    };
    text.props['title'] = literal('Details');
    text.props['data-testid'] = literal('subject');
    const click = createInstanceEventSpec('onClick');
    if (!click) throw new Error('Missing click event');
    text.instanceEvents = { onClick: click };
    const eventId = addEventProp(document, 'onTextClick', { payload: null });
    text.events['onClick'] = { kind: 'reference', symbolId: eventId, path: [] };
    document.nodes[text.id] = text;
    attach(document, text.id);

    const output = generateTsx(document);
    expect(output).toContain(
      '{...({ "title": "Details", "data-testid": "subject" } as Record<string, unknown>)}',
    );
    expect(output).toContain('onClick={() => props.onTextClick?.()}');
  });

  it('emits the approved serializable key payload instead of a React event', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_key_codegen', 'Key Codegen');
    const text = registry.require('srijika.text').createNode('subject');
    if (text.kind !== 'element') throw new Error('Expected Text element');
    const keyDown = createInstanceEventSpec('onKeyDown');
    if (!keyDown) throw new Error('Missing key event');
    text.instanceEvents = { onKeyDown: keyDown };
    const eventId = addEventProp(document, 'onKey', keyDown.signature);
    text.events['onKeyDown'] = { kind: 'reference', symbolId: eventId, path: [] };
    text.eventArguments = { onKeyDown: { kind: 'eventPayload' } };
    document.nodes[text.id] = text;
    attach(document, text.id);

    const output = generateTsx(document);
    expect(output).toContain('onKeyDown={(event) => props.onKey?.({ key: event.key');
    expect(output).toContain('repeat: event.repeat }');
    expect(output).not.toContain('props.onKey?.(event)');
  });

  it('generates expanded Input attributes and the Image adapter', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_media_codegen', 'Media Codegen');
    const input = registry.require('srijika.input').createNode('email');
    const image = registry.require('srijika.image').createNode('hero_image');
    if (input.kind !== 'element' || image.kind !== 'element') {
      throw new Error('Expected element adapters');
    }
    input.props['type'] = literal('email');
    input.props['name'] = literal('workEmail');
    input.props['required'] = literal(true);
    image.props['src'] = literal('/hero.jpg');
    image.props['alt'] = literal('Hero');
    image.props['fit'] = literal('contain');
    image.props['loading'] = literal('eager');
    document.nodes[input.id] = input;
    document.nodes[image.id] = image;
    attach(document, input.id);
    attach(document, image.id);

    const output = generateTsx(document);
    expect(output).toContain('type="email"');
    expect(output).toContain('style={srijikaInputPartStyle({})}');
    expect(output).toContain('name={String("workEmail") || undefined}');
    expect(output).toContain('required={Boolean(true)}');
    expect(output).toContain('<img style={{');
    expect(output).toContain('objectFit: "contain"');
    expect(output).toContain('src={String("/hero.jpg")}');
    expect(output).toContain('loading="eager"');
  });
});
