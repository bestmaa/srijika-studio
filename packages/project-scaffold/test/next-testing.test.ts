import { buildSrijikaTestContract } from '@srijika/architecture-rules';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildSrijikaNextTestAdapterPlan, SRIJIKA_NEXT_TEST_ADAPTER_VERSION } from '../src';

describe('Srijika Next App Router test adapter generation', () => {
  it('routes visual owners through real Next Playwright instead of Vitest component rendering', () => {
    const contract = buildSrijikaTestContract([
      {
        fileName: 'src/features/profile/Profile.ui.tsx',
        source:
          'export async function ProfileUI() { return <main data-srijika-owner="Profile">Profile</main>; }',
      },
      {
        fileName: 'src/features/profile/Profile.connector.tsx',
        source:
          "import { ProfileUI } from './Profile.ui'; export function ProfileConnector() { return <ProfileUI />; }",
      },
      {
        fileName: 'src/features/profile/slots/avatar/parts/upload/Upload.ui.tsx',
        source: 'export function UploadUI() { return <button>Upload</button>; }',
      },
      {
        fileName: 'src/features/profile/slots/avatar/parts/upload/Upload.connector.tsx',
        source:
          "import { UploadUI } from './Upload.ui'; export function UploadConnector() { return <UploadUI />; }",
      },
    ]);
    const plan = buildSrijikaNextTestAdapterPlan(contract);

    expect(plan.version).toBe(SRIJIKA_NEXT_TEST_ADAPTER_VERSION);
    expect(plan.framework).toBe('next-app-router');
    expect(plan.files.map(({ relativePath }) => relativePath)).toContain(
      'tests/srijika-next/owners/part--profile--avatar--upload.spec.ts',
    );
    expect(
      plan.files
        .map(({ relativePath }) => relativePath)
        .some((path) => path.includes('.component.')),
    ).toBe(false);
    expect(
      plan.artifacts.find(({ ownerId }) => ownerId === 'feature:profile')?.requirementIds,
    ).toEqual([
      'feature:profile:component',
      'feature:profile:browser',
      'feature:profile:visual',
      'feature:profile:accessibility',
    ]);
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('app/page.tsx'))?.source,
    ).toContain('searchParams: Promise<{ owner?: string }>');
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('next.config.mjs'))?.source,
    ).toContain("path.resolve(directory, '../../..')");
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('playwright.config.ts'))?.source,
    ).toContain('cwd: projectRoot');
    expect(plan.uncoveredRequirementIds).toEqual([]);
    expect(
      plan.files.flatMap((file) => {
        if (!/\.tsx?$/u.test(file.relativePath)) return [];
        return (
          ts.transpileModule(file.source, {
            fileName: file.relativePath,
            reportDiagnostics: true,
            compilerOptions: {
              jsx: ts.JsxEmit.ReactJSX,
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2022,
            },
          }).diagnostics ?? []
        ).filter(({ category }) => category === ts.DiagnosticCategory.Error);
      }),
    ).toEqual([]);
  });

  it('keeps the Next fixture boundary create-only and validates its isolated port', () => {
    const contract = buildSrijikaTestContract([]);
    const plan = buildSrijikaNextTestAdapterPlan(contract, { packageManager: 'npm', port: 4_333 });
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('owner-fixtures.ts')),
    ).toMatchObject({ mode: 'create-only' });
    expect(plan.scripts['test:srijika:next']).toContain('npm run');
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('playwright.config.ts'))?.source,
    ).toContain('?? 4333');
    expect(() => buildSrijikaNextTestAdapterPlan(contract, { port: 70_000 })).toThrow(/65535/);
  });
});
