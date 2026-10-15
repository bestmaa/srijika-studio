import { describe, expect, it } from 'vitest';

import { compileSrijikaNativeTsx } from '../src/compiler.js';

const ui = (
  body: string,
  imports = "import { View, Text, Pressable, TextInput, Image, ScrollView, ActivityIndicator } from 'react-native';",
) => `${imports}
import type { ReactNode } from 'react';
export interface Props { title: string; count: number; show: boolean; onPress: () => void; onChange: (value: string) => void; content: ReactNode; }
export function ExampleUI(props: Props) { return (${body}); }`;

describe('independent Native TSX compiler', () => {
  it('derives native components, events, styles, slots and exact source spans without executing imports', () => {
    const source = ui(`<ScrollView contentContainerStyle={{padding: 24}}>
      <View><Text style={{fontSize: 20, color: '#123'}}>{props.title}</Text></View>
      <TextInput value={props.title} onChangeText={props.onChange} />
      <Pressable onPress={props.onPress}><Text>Increment</Text></Pressable>
      <Image source={{uri: 'https://example.com/logo.png'}} style={{width: 40, height: 40}} />
      <ActivityIndicator size="small" />
      <View>{props.content}</View>
    </ScrollView>`);
    const result = compileSrijikaNativeTsx(source, 'Example.ui.tsx');
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.version).toBe('srijika-native-ui-v1');
    const nodes = Object.values(result.document!.nodes);
    expect(
      nodes
        .filter((node) => node.kind === 'element')
        .map((node) => node.component)
        .sort(),
    ).toEqual(
      [
        'ScrollView',
        'View',
        'Text',
        'TextInput',
        'Pressable',
        'Text',
        'Image',
        'ActivityIndicator',
        'View',
      ].sort(),
    );
    expect(nodes).toContainEqual(expect.objectContaining({ kind: 'slot', name: 'content' }));
    const rootSpan = result.sourceMap[result.document!.rootNodeId]!;
    expect(source.slice(rootSpan.start, rootSpan.end)).toContain('<ScrollView');
    expect(compileSrijikaNativeTsx(source)).toEqual(compileSrijikaNativeTsx(source));
  });

  it('supports import aliases, fragments and conditional native JSX', () => {
    const result = compileSrijikaNativeTsx(
      ui(
        '<>{props.show && <Label>{props.count}</Label>}{props.show ? <Label>Visible</Label> : null}</>',
        "import { Text as Label } from 'react-native';",
      ),
    );
    expect(result.diagnostics).toEqual([]);
    expect(
      Object.values(result.document!.nodes).filter((node) => node.kind === 'conditional'),
    ).toHaveLength(2);
  });

  it('accepts inline type-only React imports without evaluating them', () => {
    const result = compileSrijikaNativeTsx(
      "import { type ReactNode } from 'react'; import { View } from 'react-native'; export interface Props { child: ReactNode; } export function X(props: Props) { return <View>{props.child}</View>; }",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['HTML', '<div />'],
    ['DOM events', '<Pressable onClick={props.onPress} />'],
    ['CSS', '<View style={{gridTemplateColumns: "1fr"}} />'],
    ['CSS units', '<View style={{padding: "20px"}} />'],
    ['raw text', '<View>Hello</View>'],
    ['scalar outside Text', '<View>{props.title}</View>'],
    ['inline callback', '<Pressable onPress={() => props.onPress()} />'],
    ['undeclared prop', '<Text>{props.unknown}</Text>'],
    ['spread', '<View {...props} />'],
    ['object spread', '<View style={{...props}} />'],
    ['unsafe member', '<Text>{props.title.constructor}</Text>'],
    ['missing image source', '<Image />'],
    ['void children', '<TextInput><Text>Hello</Text></TextInput>'],
    ['callback type', '<Pressable onPress={props.title} />'],
    ['string style', '<View style="padding: 20px" />'],
    ['local require', '<Image source={require("./image.png")} />'],
  ])('fails closed on unsupported %s', (_label, body) => {
    const result = compileSrijikaNativeTsx(ui(body));
    expect(result.document).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0]!.line).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.column).toBeGreaterThan(0);
  });

  it('rejects hooks, side effects, module calls and malformed TSX without evaluating them', () => {
    for (const source of [
      "import { View, StyleSheet } from 'react-native'; const styles = StyleSheet.create({}); export function X(){return <View/>;}",
      "import { View } from 'react-native'; export function X(){ fetch('https://example.com'); return <View/>;}",
      "import { useState } from 'react'; export function X(){return <View/>;}",
      "import './side-effect'; export function X(){return <View/>;}",
      "import { View } from 'react-native'; export function X(){return <View>;}",
    ]) {
      expect(compileSrijikaNativeTsx(source).document).toBeNull();
    }
  });
});
