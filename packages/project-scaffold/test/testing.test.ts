import { buildSrijikaTestContract } from '@srijika/architecture-rules';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildSrijikaViteTestAdapterPlan, SRIJIKA_VITE_TEST_ADAPTER_VERSION } from '../src';

describe('Srijika Vite test adapter generation', () => {
  it('generates owner-scoped Vitest and Playwright artifacts for Features and Parts', () => {
    const contract = buildSrijikaTestContract([
      {
        fileName: 'src/features/home/Home.ui.tsx',
        source: 'export function HomeUI() { return <main data-srijika-owner="Home" />; }',
      },
      {
        fileName: 'src/features/home/Home.connector.tsx',
        source:
          "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }",
      },
      {
        fileName: 'src/features/home/home.logic.ts',
        source: 'export const homeLogic = { ready: true };',
      },
      {
        fileName: 'src/features/home/slots/search/Search.ui.tsx',
        source: 'export function SearchUI() { return <section data-srijika-owner="Search" />; }',
      },
      {
        fileName: 'src/features/home/slots/search/Search.connector.tsx',
        source:
          "import { SearchUI } from './Search.ui'; export function SearchConnector() { return <SearchUI />; }",
      },
      {
        fileName: 'src/features/home/slots/search/parts/result-row/ResultRow.ui.tsx',
        source:
          'export function ResultRowUI() { return <article data-srijika-owner="ResultRow" />; }',
      },
      {
        fileName: 'src/features/home/slots/search/parts/result-row/ResultRow.connector.tsx',
        source:
          "import { ResultRowUI } from './ResultRow.ui'; export function ResultRowConnector() { return <ResultRowUI />; }",
      },
      {
        fileName: 'src/shared/capabilities/auth/useAuth.ts',
        source: 'export function useAuth() { return {}; }',
      },
      {
        fileName: 'src/shared/capabilities/auth/auth.api.ts',
        source: 'export const authApi = { load: async () => true };',
      },
    ]);

    const plan = buildSrijikaViteTestAdapterPlan(contract);
    expect(plan.version).toBe(SRIJIKA_VITE_TEST_ADAPTER_VERSION);
    expect(plan.framework).toBe('vite');
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'tests/srijika/contract.generated.json',
      'tests/srijika/harness/index.html',
      'tests/srijika/harness/main.tsx',
      'tests/srijika/owner-fixtures.ts',
      'tests/srijika/owners/feature--home.component.test.tsx',
      'tests/srijika/owners/feature--home.spec.ts',
      'tests/srijika/owners/feature--home.unit.test.ts',
      'tests/srijika/owners/part--home--search--result-row.component.test.tsx',
      'tests/srijika/owners/part--home--search--result-row.spec.ts',
      'tests/srijika/owners/shared-capability--auth.unit.test.ts',
      'tests/srijika/owners/slot--home--search.component.test.tsx',
      'tests/srijika/owners/slot--home--search.spec.ts',
      'tests/srijika/playwright.config.ts',
      'tests/srijika/vitest.config.ts',
    ]);
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('result-row.spec.ts'))?.source,
    ).toContain("test('@visual keeps its fixed-viewport owner boundary stable'");
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('result-row.spec.ts'))?.source,
    ).toContain("test('@a11y has no automatically detectable WCAG A/AA violations'");
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('main.tsx'))?.source,
    ).toContain("'part:home/search/result-row': Owner");
    expect(plan.artifacts.find(({ ownerId }) => ownerId.startsWith('part:'))).toMatchObject({
      ownerId: 'part:home/search/result-row',
      requirementIds: ['part:home/search/result-row:component'],
    });
    expect(plan.uncoveredRequirementIds).toEqual(['shared-capability:auth:component']);
    expect(plan.scripts['test:srijika']).toContain('test:srijika:browser');
    expect(plan.devDependencies.map(({ name }) => name)).toEqual([
      '@axe-core/playwright',
      '@playwright/test',
      'vitest',
    ]);
    expect(
      plan.files.flatMap((file) => {
        if (!/\.tsx?$/u.test(file.relativePath)) return [];
        const transpiled = ts.transpileModule(file.source, {
          fileName: file.relativePath,
          reportDiagnostics: true,
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        });
        return (transpiled.diagnostics ?? []).filter(
          ({ category }) => category === ts.DiagnosticCategory.Error,
        );
      }),
    ).toEqual([]);
    expect(() => {
      JSON.parse(
        plan.files.find(({ relativePath }) => relativePath.endsWith('.generated.json'))?.source ??
          '',
      ) as unknown;
    }).not.toThrow();
  });

  it('keeps fixtures create-only and validates the isolated Vite server port', () => {
    const contract = buildSrijikaTestContract([]);
    const plan = buildSrijikaViteTestAdapterPlan(contract, {
      packageManager: 'npm',
      port: 4_321,
    });
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('owner-fixtures.ts')),
    ).toMatchObject({ mode: 'create-only' });
    expect(plan.scripts['test:srijika']).toBe(
      'npm run test:srijika:component && npm run test:srijika:browser',
    );
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('playwright.config.ts'))?.source,
    ).toContain('?? 4321');
    expect(() => buildSrijikaViteTestAdapterPlan(contract, { port: 80 })).toThrow(/1024/);
  });
});
