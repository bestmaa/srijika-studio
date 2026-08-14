import { describe, expect, it } from 'vitest';

import { compileSrijikaTsx, SRIJIKA_UI_COMPLEXITY_POLICY } from './index';

function uiWithChildLines(childLines: number): string {
  const children = Array.from(
    { length: childLines },
    (_, index) => `      <span>Item ${index + 1}</span>`,
  );
  return [
    'export function PolicyUI() {',
    '  return (',
    '    <main>',
    ...children,
    '    </main>',
    '  );',
    '}',
  ].join('\n');
}

function propsContract(memberCount: number): string {
  const members = Array.from(
    { length: memberCount },
    (_, index) => `  value${index + 1}${index % 2 === 0 ? '' : '?'}: string;`,
  );
  return [
    'export interface PolicyUIProps {',
    ...members,
    '}',
    '',
    'export function PolicyUI(props: PolicyUIProps) {',
    '  return <main>{props.value1}</main>;',
    '}',
  ].join('\n');
}

describe('Srijika UI complexity policy', () => {
  it('publishes the one shared set of product limits', () => {
    expect(SRIJIKA_UI_COMPLEXITY_POLICY).toEqual({
      maxComponentMeaningfulLines: 200,
      maxFileMeaningfulLines: 300,
      maxTopLevelContractMembers: 16,
    });
  });

  it('allows 200 meaningful component lines and rejects 201', () => {
    const atLimit = compileSrijikaTsx('Policy.ui.tsx', uiWithChildLines(194));
    const overLimit = compileSrijikaTsx('Policy.ui.tsx', uiWithChildLines(195));

    expect(atLimit.diagnostics.find(({ code }) => code === 'SRIJIKA3002')).toBeUndefined();
    expect(overLimit.diagnostics.find(({ code }) => code === 'SRIJIKA3002')).toMatchObject({
      severity: 'error',
      span: { line: 1, column: 17 },
    });
    expect(overLimit.document).not.toBeNull();
  });

  it('counts the complete file separately and ignores blank/comment-only lines', () => {
    const imports = Array.from(
      { length: 298 },
      (_, index) => `import type { ReactNode as ReactNode${index + 1} } from 'react';`,
    );
    const overLimit = compileSrijikaTsx(
      'Policy.ui.tsx',
      [...imports, 'export function PolicyUI() {', '  return <main>Ready</main>;', '}'].join('\n'),
    );
    const commentHeavy = compileSrijikaTsx(
      'Policy.ui.tsx',
      [
        ...Array.from({ length: 400 }, (_, index) => `// documentation ${index + 1}`),
        'export function PolicyUI() {',
        '  return <main>Ready</main>;',
        '}',
      ].join('\n'),
    );

    expect(overLimit.diagnostics.find(({ code }) => code === 'SRIJIKA3001')).toMatchObject({
      severity: 'error',
    });
    expect(overLimit.diagnostics.find(({ code }) => code === 'SRIJIKA3002')).toBeUndefined();
    expect(commentHeavy.diagnostics.find(({ code }) => code === 'SRIJIKA3001')).toBeUndefined();
  });

  it('allows 16 top-level contract members and rejects the seventeenth', () => {
    const atLimit = compileSrijikaTsx('Policy.ui.tsx', propsContract(16));
    const overLimit = compileSrijikaTsx('Policy.ui.tsx', propsContract(17));
    const diagnostic = overLimit.diagnostics.find(({ code }) => code === 'SRIJIKA3003');

    expect(atLimit.diagnostics.find(({ code }) => code === 'SRIJIKA3003')).toBeUndefined();
    expect(diagnostic).toMatchObject({
      severity: 'error',
      span: { line: 18, column: 3 },
    });
    expect(diagnostic?.message).toContain('17 top-level members');
    expect(overLimit.componentContract).toHaveLength(17);
  });
});
