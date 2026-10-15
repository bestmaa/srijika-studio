import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNativeProjectFileMap } from '../../../packages/native/src/scaffold';

import { positionAt } from '../src/diagnostic-model';
import { SrijikaNativeController } from '../src/native-controller';
import { editorState, Uri } from './vscode-mock';

const temporaryRoots: string[] = [];
const controllers: SrijikaNativeController[] = [];
const templates = createNativeProjectFileMap({}, 'validator', 'lock');
const logs: string[] = [];
const output = {
  appendLine: (line: string) => {
    logs.push(line);
  },
  show() {},
} as unknown as vscode.OutputChannel;

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'srijika-native-editor-'));
  temporaryRoots.push(root);
  for (const [name, source] of Object.entries(templates)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), source);
  }
  editorState.folders = [{ name: 'mobile', index: 0, uri: Uri.file(root) }];
  editorState.configUris = [Uri.file(join(root, 'srijika.config.json'))];
  editorState.markerUris = [Uri.file(join(root, 'srijika.native.json'))];
  return root;
}

function document(fileName: string, source: string) {
  const value = {
    fileName,
    uri: Uri.file(fileName),
    languageId: 'typescriptreact',
    getText: () => source,
    positionAt: (offset: number) => positionAt(source, offset),
  };
  editorState.documents = [value];
  return value as unknown as vscode.TextDocument;
}

async function controller() {
  const instance = new SrijikaNativeController(output);
  controllers.push(instance);
  await instance.refreshProjects();
  return instance;
}

beforeEach(() => {
  editorState.folders = [];
  editorState.documents = [];
  editorState.configUris = [];
  editorState.markerUris = [];
  editorState.collections.clear();
  editorState.messages = [];
  logs.length = 0;
});
afterEach(async () => {
  for (const instance of controllers.splice(0)) instance.dispose();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('Native VS Code diagnostic lifecycle', () => {
  it('routes opened Native files to the Native compiler and updates unsaved squiggles', async () => {
    const root = await project();
    const file = join(root, 'src/features/home/Home.ui.tsx');
    const instance = await controller();
    expect(instance.ownsFile(file)).toBe(true);
    const source = templates['src/features/home/Home.ui.tsx']!;
    const bad = document(file, source.replace('onChangeText=', 'onClick='));
    expect(instance.compileDocument(bad)).toBe(true);
    const entries = editorState.collections.get('srijika-native')!;
    expect(
      entries.get(bad.uri.toString())?.some((finding) => finding.code === 'SRIJIKA-NATIVE1002'),
    ).toBe(true);
    expect(instance.checkCurrentFile(bad)).toBe(true);
    expect(editorState.messages).not.toContain('Srijika Native check passed: no issues found.');
    const fixed = document(file, source);
    instance.compileDocument(fixed);
    expect(entries.get(fixed.uri.toString())).toEqual([]);
    instance.checkCurrentFile(fixed);
    expect(editorState.messages).toContain('Srijika Native check passed: no issues found.');
  });

  it('checks Native ownership and Logic from dirty buffers and clears corrected findings', async () => {
    const root = await project();
    const instance = await controller();
    const file = join(root, 'src/features/home/home.logic.ts');
    await writeFile(file, 'export function greeting() { return "hello"; }');
    document(
      file,
      "import { Platform } from 'react-native'; export function greeting() { return Platform.OS; }",
    );
    const result = await instance.checkArchitecture(() => true);
    expect(result.projects).toBe(1);
    const entries = editorState.collections.get('srijika-native-architecture')!;
    expect(
      entries
        .get(Uri.file(file).toString())
        ?.some((finding) => finding.code === 'SRIJIKA-NATIVE2001'),
    ).toBe(true);
    document(file, 'export function greeting() { return "hello"; }');
    await instance.checkArchitecture(() => true);
    expect(
      [...entries.values()].flat().some((finding) => finding.code === 'SRIJIKA-NATIVE2001'),
    ).toBe(false);
  });

  it('does not treat ordinary React projects or nested web packages as Native', async () => {
    const root = await project();
    const webRoot = join(root, 'packages/web');
    editorState.configUris.push(Uri.file(join(webRoot, 'srijika.config.json')));
    const instance = await controller();
    expect(instance.ownsFile(join(webRoot, 'Card.ui.tsx'))).toBe(false);
    expect(
      instance.compileDocument(
        document(join(webRoot, 'Card.ui.tsx'), 'export function CardUI(){ return <main/>; }'),
      ),
    ).toBe(false);
    editorState.markerUris = [];
    await instance.refreshProjects();
    expect(instance.ownsFile(join(root, 'src/features/home/Home.ui.tsx'))).toBe(false);
    expect([...editorState.collections.get('srijika-native')!.values()]).toEqual([]);
  });

  it('keeps malformed Native profiles owned, fails closed, and recovers after repair', async () => {
    const root = await project();
    await writeFile(join(root, 'srijika.native.json'), '{"version":2}');
    const instance = await controller();
    const file = join(root, 'src/features/home/Home.ui.tsx');
    expect(instance.ownsFile(file)).toBe(true);
    const config = editorState.collections.get('srijika-native-config')!;
    expect(config.get(Uri.file(join(root, 'srijika.native.json')).toString())?.[0]?.code).toBe(
      'SRIJIKA-NATIVE0001',
    );
    expect(
      instance.compileDocument(document(file, templates['src/features/home/Home.ui.tsx']!)),
    ).toBe(true);
    expect((await instance.checkArchitecture(() => true)).issues).toBeGreaterThan(0);
    await writeFile(join(root, 'srijika.native.json'), templates['srijika.native.json']!);
    await instance.refreshProjects();
    expect((await instance.checkArchitecture(() => true)).issues).toBe(0);
    expect(config.size).toBe(0);
  });

  it('does not publish cancelled architecture runs or keep closed-file UI diagnostics', async () => {
    const root = await project();
    const instance = await controller();
    const doc = document(
      join(root, 'src/features/home/Home.ui.tsx'),
      templates['src/features/home/Home.ui.tsx']!.replace('onChangeText=', 'onClick='),
    );
    instance.compileDocument(doc);
    const entries = editorState.collections.get('srijika-native')!;
    const previous = entries.get(doc.uri.toString());
    await instance.checkArchitecture(() => false);
    expect(entries.get(doc.uri.toString())).toEqual(previous);
    instance.closeDocument(doc.uri);
    expect(entries.has(doc.uri.toString())).toBe(false);
  });
});
