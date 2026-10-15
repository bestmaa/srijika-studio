import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileSrijikaNativeTsx } from '@srijika/native/editor';
import { createNativeProjectFileMap } from '../../../packages/native/src/scaffold';

import { analyzeNextSource, compileUiSource } from '../src/compiler-adapter';
import {
  nativeDiagnosticToEditorDiagnostic,
  nativeProjectDiagnostics,
} from '../src/native-adapter';
import { nativeEditorRuntimePlan } from '../src/native-runtime-model';
import { buildSrijikaProjectArchitectureGraph } from '../src/project-architecture-graph';
import { renderSrijikaProjectArchitectureWebview } from '../src/project-architecture-webview';
import { nearestEditorProjectRoot, parseSrijikaEditorProject } from '../src/project-profile';

const templates = createNativeProjectFileMap({}, 'validator', 'lock');
const profile = () =>
  parseSrijikaEditorProject(
    templates['srijika.config.json']!,
    templates['srijika.native.json'],
    templates['tsconfig.json'],
    templates['package.json'],
  );
const root = resolve('/workspace/mobile');
const files = Object.entries(templates)
  .filter(([name]) => /\.tsx?$/.test(name))
  .map(([name, source]) => ({ fileName: resolve(root, name), source }));

describe('Native editor profile and compiler isolation', () => {
  it('detects an explicit Expo profile and accepts only its trusted TypeScript base', () => {
    expect(profile()).toMatchObject({
      kind: 'native',
      native: { profile: 'expo-go-v1', platforms: ['android', 'ios'] },
    });
    expect(() =>
      parseSrijikaEditorProject(
        templates['srijika.config.json']!,
        undefined,
        templates['tsconfig.json'],
      ),
    ).toThrow(/extends/);
    expect(() =>
      parseSrijikaEditorProject(
        templates['srijika.config.json']!,
        '{"version":2}',
        templates['tsconfig.json'],
      ),
    ).toThrow();
    expect(() =>
      parseSrijikaEditorProject(
        templates['srijika.config.json']!,
        templates['srijika.native.json'],
        '{"extends":"../unknown.json"}',
      ),
    ).toThrow(/expo\/tsconfig.base/);
  });

  it('retains the React and Next compiler semantics', () => {
    const web = parseSrijikaEditorProject(templates['srijika.config.json']!, undefined, '{}');
    expect(web.kind).toBe('web');
    expect(
      compileUiSource({
        fileName: 'Card.ui.tsx',
        source: 'export function CardUI() { return <main>Web</main>; }',
      }).diagnostics,
    ).toEqual([]);
    const next = parseSrijikaEditorProject(
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'Home.ui.tsx',
        framework: { version: 1, profile: 'next-app-router-v1', components: [] },
      }),
    );
    expect(next.config.framework?.profile).toBe('next-app-router-v1');
    expect(
      analyzeNextSource({
        fileName: 'app/page.tsx',
        source:
          "import { useState } from 'react'; export default function Page() { useState(false); return <main/>; }",
      }).diagnostics.some((diagnostic) => diagnostic.code === 'SRIJIKA5004'),
    ).toBe(true);
    expect(() =>
      parseSrijikaEditorProject(JSON.stringify(next.config), templates['srijika.native.json']),
    ).toThrow(/web framework/);
  });

  it('routes files to the nearest project in mixed Native/web workspaces', () => {
    const roots = [root, resolve(root, 'packages/web'), resolve('/workspace/other')];
    expect(nearestEditorProjectRoot(roots, resolve(root, 'packages/web/Home.ui.tsx'))).toBe(
      resolve(root, 'packages/web'),
    );
    expect(nearestEditorProjectRoot(roots, resolve(root, 'src/Home.ui.tsx'))).toBe(root);
    expect(
      nearestEditorProjectRoot(roots, resolve('/workspace/mobile-copy/X.ui.tsx')),
    ).toBeUndefined();
  });

  it('reuses Native compiler diagnostics with exact editor source ranges', () => {
    const source =
      "import { Pressable } from 'react-native'; export interface Props { title: string; } export function CardUI(props: Props) { return <Pressable onClick={props.title} />; }";
    const diagnostic = compileSrijikaNativeTsx(source).diagnostics.find(
      (finding) => finding.code === 'SRIJIKA-NATIVE1002',
    )!;
    const mapped = nativeDiagnosticToEditorDiagnostic(source, diagnostic);
    expect(source.slice(diagnostic.start, diagnostic.end)).toContain('onClick');
    expect(mapped.range.start).toEqual({ line: 0, character: diagnostic.start });
    expect(mapped.code).toBe('SRIJIKA-NATIVE1002');
  });

  it('builds a Native Structure Graph with App, owners, imports and compiler findings', () => {
    const project = profile();
    expect(nativeProjectDiagnostics(root, project, files)).toEqual([]);
    const modified = files.map((file) =>
      file.fileName.endsWith('Home.ui.tsx')
        ? { ...file, source: file.source.replace('onChangeText=', 'onClick=') }
        : file,
    );
    const diagnostics = nativeProjectDiagnostics(root, project, modified);
    const graph = buildSrijikaProjectArchitectureGraph({
      projectName: 'mobile',
      projectRoot: root,
      platform: 'react-native-expo',
      entry: project.config.entry,
      architecture: project.config.architecture,
      files: modified,
      diagnostics,
    });
    expect(graph.nodes.some((node) => node.relativePath === 'App.tsx')).toBe(true);
    expect(graph.nodes.some((node) => node.ownerKind === 'slot')).toBe(true);
    expect(
      graph.nodes.some((node) =>
        node.imports.some((dependency) => dependency.packageName === 'react-native'),
      ),
    ).toBe(true);
    expect(
      graph.violations.some(
        (finding) =>
          finding.code === 'SRIJIKA-NATIVE1002' &&
          finding.nodeIds.some((id) => id.includes('Home.ui.tsx')),
      ),
    ).toBe(true);
    const html = renderSrijikaProjectArchitectureWebview({ nonce: 'native-test', graph });
    expect(html).toContain('React Native + Expo');
    expect(html).toContain('SRIJIKA-NATIVE1002');
  });

  it('plans only Expo Go and frozen installs for Native editor tasks', () => {
    expect(nativeEditorRuntimePlan(root, 'dev', { connection: 'tunnel' }).args).toEqual([
      'exec',
      'expo',
      'start',
      '--go',
      '--tunnel',
      '--port',
      '8081',
    ]);
    expect(nativeEditorRuntimePlan(root, 'install', { windows: true })).toMatchObject({
      executable: 'pnpm.cmd',
      args: ['install', '--frozen-lockfile'],
    });
    expect(() => nativeEditorRuntimePlan(root, 'dev', { port: 80 })).toThrow();
  });
});
