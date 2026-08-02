import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createBlankDocument,
  createInstanceEventSpec,
  literal,
  type EventSignature,
  type UiDocument,
} from '@sutra/contracts';
import { createCoreComponentRegistry } from '@sutra/core-components';
import { SutraRenderer } from '@sutra/react-renderer';

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

describe('instance props and normalized event ports at runtime', () => {
  it('forwards added DOM props and invokes a Text click action without a browser event object', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_instance_runtime', 'Instance Runtime');
    const text = registry.require('sutra.text').createNode('subject');
    if (text.kind !== 'element') throw new Error('Expected Text element');
    text.props['text'] = literal('Clickable text');
    text.instanceProps = {
      title: { displayName: 'title', type: 'string', required: false },
      'data-testid': { displayName: 'data-testid', type: 'string', required: true },
    };
    text.props['title'] = literal('Open details');
    text.props['data-testid'] = literal('clickable-text');
    const click = createInstanceEventSpec('onClick');
    if (!click) throw new Error('Missing click event catalog entry');
    text.instanceEvents = { onClick: click };
    const eventId = addEventProp(document, 'onTextClick', { payload: null });
    text.events['onClick'] = { kind: 'reference', symbolId: eventId, path: [] };
    document.nodes[text.id] = text;
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    root.slots['children']!.push(text.id);
    const onClick = vi.fn();

    render(
      <SutraRenderer
        document={document}
        registry={registry}
        mode="preview"
        events={{ [eventId]: onClick }}
      />,
    );

    const element = screen.getByTestId('clickable-text');
    expect(element).toHaveAttribute('title', 'Open details');
    fireEvent.click(element);
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith();
  });

  it('normalizes key events to a serializable object before calling the connector action', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_key_runtime', 'Key Runtime');
    const text = registry.require('sutra.text').createNode('key_subject');
    if (text.kind !== 'element') throw new Error('Expected Text element');
    text.props['text'] = literal('Press a key');
    text.instanceProps = {
      tabIndex: { displayName: 'tabIndex', type: 'number', required: true },
      'data-testid': { displayName: 'data-testid', type: 'string', required: true },
    };
    text.props['tabIndex'] = literal(0);
    text.props['data-testid'] = literal('key-target');
    const keyDown = createInstanceEventSpec('onKeyDown');
    if (!keyDown || !keyDown.signature.payload) throw new Error('Missing key event catalog entry');
    text.instanceEvents = { onKeyDown: keyDown };
    const eventId = addEventProp(document, 'onKey', keyDown.signature);
    text.events['onKeyDown'] = { kind: 'reference', symbolId: eventId, path: [] };
    text.eventArguments = { onKeyDown: { kind: 'eventPayload' } };
    document.nodes[text.id] = text;
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    root.slots['children']!.push(text.id);
    const onKey = vi.fn();

    render(
      <SutraRenderer
        document={document}
        registry={registry}
        mode="preview"
        events={{ [eventId]: onKey }}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('key-target'), {
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      repeat: false,
    });

    expect(onKey).toHaveBeenCalledWith({
      key: 'Enter',
      code: 'Enter',
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    });
  });

  it('applies added Input props to the native input and supports the expanded type manifest', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_input_runtime', 'Input Runtime');
    const input = registry.require('sutra.input').createNode('email');
    if (input.kind !== 'element') throw new Error('Expected Input element');
    input.props['label'] = literal('Email');
    input.props['type'] = literal('email');
    input.props['name'] = literal('email');
    input.props['required'] = literal(true);
    input.props['labelStyle'] = literal({ color: '#8b5cf6', letterSpacing: '0.08em' });
    input.props['controlStyle'] = literal({
      backgroundColor: '#111827',
      borderRadius: 14,
      color: '#f9fafb',
      height: 52,
    });
    input.instanceProps = {
      'data-testid': { displayName: 'data-testid', type: 'string', required: true },
    };
    input.props['data-testid'] = literal('email-input');
    document.nodes[input.id] = input;
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    root.slots['children']!.push(input.id);

    render(<SutraRenderer document={document} registry={registry} mode="preview" />);
    const nativeInput = screen.getByTestId('email-input');
    expect(nativeInput).toHaveAttribute('type', 'email');
    expect(nativeInput).toHaveAttribute('name', 'email');
    expect(nativeInput).toBeRequired();
    expect(nativeInput).toHaveStyle({
      backgroundColor: '#111827',
      borderRadius: '14px',
      color: '#f9fafb',
      height: '52px',
    });
    const label = screen.getByText('Email');
    expect(label).toHaveStyle({ color: '#8b5cf6' });
    expect(label.style.letterSpacing).toBe('0.08em');
  });

  it('can hide the visual Input label without losing its accessible name', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_hidden_input_label', 'Hidden input label');
    const input = registry.require('sutra.input').createNode('search');
    if (input.kind !== 'element') throw new Error('Expected Input element');
    input.props['label'] = literal('Search projects');
    input.props['hideLabel'] = literal(true);
    document.nodes[input.id] = input;
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    root.slots['children']!.push(input.id);

    render(<SutraRenderer document={document} registry={registry} mode="preview" />);

    expect(screen.queryByText('Search projects')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search projects' })).toBeInTheDocument();
  });
});
