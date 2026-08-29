import { SRIJIKA_UI_COMPLEXITY_POLICY } from '@srijika/tsx-compiler';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeNextSource, compileUiSource } from '../src/compiler-adapter';

describe('VS Code compiler adapter', () => {
  it('surfaces the shared Next.js server boundary diagnostics', () => {
    const result = analyzeNextSource({
      fileName: 'src/app/page.tsx',
      source: `import { useState } from 'react';
export default function Page() { useState(false); return <main>Page</main>; }`,
    });

    expect(result).toMatchObject({ boundary: 'server', routeKind: 'page' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SRIJIKA5004' }));
  });

  it('surfaces the shared Srijika contract limit without a duplicate extension rule', () => {
    const members = Array.from(
      { length: SRIJIKA_UI_COMPLEXITY_POLICY.maxTopLevelContractMembers + 1 },
      (_, index) => `  value${index + 1}: string;`,
    );
    const source = [
      'export interface CardUIProps {',
      ...members,
      '}',
      'export function CardUI(props: CardUIProps) {',
      '  return <main>{props.value1}</main>;',
      '}',
    ].join('\n');

    const result = compileUiSource({ fileName: 'Card.ui.tsx', source });

    expect(result.diagnostics.find(({ code }) => code === 'SRIJIKA3003')).toMatchObject({
      severity: 'error',
    });
  });

  it('resolves one canonical owner-local type-only props contract', () => {
    const fileName = resolve('/project/src/features/home/Home.ui.tsx');
    const typesFileName = resolve('/project/src/features/home/Home.types.ts');
    const result = compileUiSource(
      {
        fileName,
        source: `import type { HomeUIProps } from './Home.types';
export function HomeUI(props: HomeUIProps) { return <main>{props.title}</main>; }`,
      },
      {
        sourceByFileName: new Map([
          [typesFileName, 'export interface HomeUIProps { title: string; }'],
        ]),
      },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.componentContract[0]).toMatchObject({
      name: 'title',
      contractSource: {
        kind: 'imported',
        fileName: typesFileName.replaceAll('\\', '/'),
      },
    });
  });

  it('uses the exact project component manifests supplied by workspace config', () => {
    const result = compileUiSource(
      {
        fileName: 'Home.ui.tsx',
        source: `import { Card } from './Card';
export function HomeUI() { return <Card title="Account">Home</Card>; }`,
      },
      {
        projectComponents: [
          {
            id: 'project.shared.card',
            version: 1,
            moduleSpecifier: './Card',
            exportName: 'Card',
            displayName: 'Shared Card',
            props: { title: { type: 'string', required: true, previewProp: 'ariaLabel' } },
            children: 'optional',
            preview: { kind: 'container', element: 'section' },
            source: 'project',
          },
        ],
      },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.framework.primitives[0]).toMatchObject({
      adapterId: 'srijika.project-components',
    });
  });
});
