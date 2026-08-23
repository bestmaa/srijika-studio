import { SRIJIKA_UI_COMPLEXITY_POLICY } from '@srijika/tsx-compiler';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compileUiSource } from '../src/compiler-adapter';

describe('VS Code compiler adapter', () => {
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
        fileName: typesFileName,
      },
    });
  });
});
