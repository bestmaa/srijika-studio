import type {
  SrijikaArchitectureCapability,
  SrijikaTestContract,
  SrijikaTestOwner,
} from '@srijika/architecture-rules';

import type {
  SrijikaGeneratedTestArtifact,
  SrijikaGeneratedTestFile,
  SrijikaTestEvidenceFiles,
  SrijikaTestPackageRequirement,
} from './testing.js';
import { SRIJIKA_GENERATED_TEST_HEADER } from './testing.js';

export const SRIJIKA_NEXT_TEST_ADAPTER_VERSION = 'srijika-next-tests-v1' as const;

export interface SrijikaNextTestAdapterPlan {
  version: typeof SRIJIKA_NEXT_TEST_ADAPTER_VERSION;
  framework: 'next-app-router';
  contractVersion: SrijikaTestContract['version'];
  files: readonly SrijikaGeneratedTestFile[];
  artifacts: readonly SrijikaGeneratedTestArtifact[];
  uncoveredRequirementIds: readonly string[];
  scripts: Readonly<Record<string, string>>;
  devDependencies: readonly SrijikaTestPackageRequirement[];
  evidence: SrijikaTestEvidenceFiles;
}

export interface BuildSrijikaNextTestAdapterOptions {
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  port?: number;
}

function ownerSlug(ownerId: string): string {
  return ownerId
    .replace(/[:/]+/gu, '--')
    .replace(/[^A-Za-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
}

function stripSourceExtension(value: string): string {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/iu, '');
}

function relativeModuleSpecifier(fromFile: string, toFile: string): string {
  const from = fromFile.replaceAll('\\', '/').split('/');
  const to = stripSourceExtension(toFile.replaceAll('\\', '/')).split('/');
  from.pop();
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const joined = [
    ...Array.from({ length: from.length - shared }, () => '..'),
    ...to.slice(shared),
  ].join('/');
  return joined.startsWith('.') ? joined : `./${joined}`;
}

function visualEntry(owner: SrijikaTestOwner) {
  return (
    owner.files.find(({ role }) => role === 'connector') ??
    owner.files.find(({ role }) => role === 'ui')
  );
}

function visualSymbol(owner: SrijikaTestOwner): string {
  return `${owner.name}${owner.capabilities.includes('connector') ? 'Connector' : 'UI'}`;
}

function nextHarnessPage(owners: readonly SrijikaTestOwner[]): string {
  const imports = owners
    .map((owner, index) => {
      const entry = visualEntry(owner)!;
      return `import { ${visualSymbol(owner)} as Owner${index} } from '${relativeModuleSpecifier('tests/srijika-next/harness/app/page.tsx', entry.fileName)}';`;
    })
    .join('\n');
  const entries = owners
    .map(
      (owner, index) => `  '${owner.id}': Owner${index} as ComponentType<Record<string, unknown>>,`,
    )
    .join('\n');
  return `${SRIJIKA_GENERATED_TEST_HEADER}
import type { ComponentType } from 'react';

${imports}
import { ownerFixtures } from '../../owner-fixtures';

const owners: Readonly<Record<string, ComponentType<Record<string, unknown>>>> = {
${entries}
};

export const dynamic = 'force-dynamic';

export default async function SrijikaOwnerHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const ownerId = (await searchParams).owner ?? '';
  const Owner = owners[ownerId];
  if (!Owner) return <main data-srijika-test-owner={ownerId}>Unknown Srijika owner</main>;
  return (
    <main data-srijika-test-owner={ownerId}>
      <Owner {...(ownerFixtures[ownerId] ?? {})} />
    </main>
  );
}
`;
}

function browserTest(owner: SrijikaTestOwner, slug: string): string {
  return `${SRIJIKA_GENERATED_TEST_HEADER}
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ownerUrl = '/?owner=${encodeURIComponent(owner.id)}';
async function openOwner(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(ownerUrl);
  const boundary = page.locator('[data-srijika-test-owner="${owner.id}"]').first();
  await expect(boundary).toBeVisible();
  expect(errors).toEqual([]);
  return boundary;
}

test.describe('${owner.id} in the real Next App Router', () => {
  test('renders its Server/Client Component boundary', async ({ page }) => { await openOwner(page); });
  test('@visual keeps its fixed-viewport boundary stable', async ({ page }) => {
    await expect(await openOwner(page)).toHaveScreenshot('${slug}.png');
  });
  test('@a11y has no automatically detectable WCAG A/AA violations', async ({ page }) => {
    await openOwner(page);
    const result = await new AxeBuilder({ page })
      .include('[data-srijika-test-owner="${owner.id}"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  });
});
`;
}

function runtimeTest(
  owner: SrijikaTestOwner,
  runtimeFiles: readonly { fileName: string; role: SrijikaArchitectureCapability }[],
  relativePath: string,
): string {
  const imports = runtimeFiles
    .map(
      (file, index) =>
        `import * as runtime${index} from '${relativeModuleSpecifier(relativePath, file.fileName)}';`,
    )
    .join('\n');
  const assertions = runtimeFiles
    .map(
      (file, index) =>
        `    expect(Object.keys(runtime${index}).length, '${file.role}:${file.fileName}').toBeGreaterThan(0);`,
    )
    .join('\n');
  return `${SRIJIKA_GENERATED_TEST_HEADER}
import { describe, expect, it } from 'vitest';
${imports}
describe('${owner.id}', () => {
  it('loads every framework-neutral runtime module', () => {
${assertions}
  });
});
`;
}

export function buildSrijikaNextTestAdapterPlan(
  contract: SrijikaTestContract,
  options: BuildSrijikaNextTestAdapterOptions = {},
): SrijikaNextTestAdapterPlan {
  const packageManager = options.packageManager ?? 'pnpm';
  const port = options.port ?? 4175;
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('The Srijika Next test port must be an integer from 1024 through 65535.');
  }
  const visualOwners = contract.owners.filter((owner) => owner.capabilities.includes('ui'));
  const files: SrijikaGeneratedTestFile[] = [
    {
      relativePath: 'tests/srijika-next/contract.generated.json',
      source: `${JSON.stringify(contract, null, 2)}\n`,
      mode: 'generated',
    },
    {
      relativePath: 'tests/srijika-next/owner-fixtures.ts',
      source:
        'export const ownerFixtures: Readonly<Record<string, Record<string, unknown>>> = {};\n',
      mode: 'create-only',
    },
    {
      relativePath: 'tests/srijika-next/harness/app/layout.tsx',
      source: `${SRIJIKA_GENERATED_TEST_HEADER}\nimport type { ReactNode } from 'react';\nexport default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n`,
      mode: 'generated',
    },
    {
      relativePath: 'tests/srijika-next/harness/app/page.tsx',
      source: nextHarnessPage(visualOwners),
      mode: 'generated',
    },
    {
      relativePath: 'tests/srijika-next/harness/next.config.mjs',
      source: `${SRIJIKA_GENERATED_TEST_HEADER}\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst directory = path.dirname(fileURLToPath(import.meta.url));\nexport default { turbopack: { root: path.resolve(directory, '../../..') } };\n`,
      mode: 'generated',
    },
    {
      relativePath: 'tests/srijika-next/vitest.config.ts',
      source: `${SRIJIKA_GENERATED_TEST_HEADER}\nimport { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { environment: 'node', include: ['tests/srijika-next/owners/*.unit.test.ts'], reporters: ['default', 'json'], outputFile: { json: 'test-results/srijika-next/vitest.json' } } });\n`,
      mode: 'generated',
    },
    {
      relativePath: 'tests/srijika-next/playwright.config.ts',
      source: `${SRIJIKA_GENERATED_TEST_HEADER}\nimport { defineConfig, devices } from '@playwright/test';\nconst port = Number(process.env['SRIJIKA_NEXT_TEST_PORT'] ?? ${port});\nconst projectRoot = process.cwd();\nexport default defineConfig({ testDir: './owners', testMatch: '**/*.spec.ts', outputDir: '../../test-results/srijika-next/browser-artifacts', reporter: [['list'], ['json', { outputFile: '../../test-results/srijika-next/playwright.json' }]], fullyParallel: true, use: { baseURL: \`http://127.0.0.1:\${port}\`, trace: 'retain-on-failure', screenshot: 'only-on-failure' }, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }], webServer: { cwd: projectRoot, command: '${packageManager} exec next dev tests/srijika-next/harness --hostname 127.0.0.1 --port ' + port, url: \`http://127.0.0.1:\${port}\`, reuseExistingServer: !process.env['CI'], timeout: 120_000 } });\n`,
      mode: 'generated',
    },
  ];
  const artifacts: SrijikaGeneratedTestArtifact[] = [];
  for (const owner of contract.owners) {
    const slug = ownerSlug(owner.id);
    if (owner.capabilities.includes('ui')) {
      const path = `tests/srijika-next/owners/${slug}.spec.ts`;
      files.push({ relativePath: path, source: browserTest(owner, slug), mode: 'generated' });
      artifacts.push({
        ownerId: owner.id,
        relativePath: path,
        requirementIds: owner.requirements
          .filter(
            ({ layer }) =>
              layer === 'component' ||
              layer === 'browser' ||
              layer === 'visual' ||
              layer === 'accessibility',
          )
          .map(({ id }) => id),
      });
    }
    const runtimeFiles = owner.files.flatMap((file) =>
      file.role === 'store' || file.role === 'logic' || file.role === 'api'
        ? [{ fileName: file.fileName, role: file.role }]
        : [],
    );
    if (runtimeFiles.length > 0) {
      const path = `tests/srijika-next/owners/${slug}.unit.test.ts`;
      files.push({
        relativePath: path,
        source: runtimeTest(owner, runtimeFiles, path),
        mode: 'generated',
      });
      artifacts.push({
        ownerId: owner.id,
        relativePath: path,
        requirementIds: owner.requirements
          .filter(({ layer }) => layer === 'unit')
          .map(({ id }) => id),
      });
    }
  }
  const covered = new Set([
    ...contract.owners.flatMap((owner) =>
      owner.requirements
        .filter(({ layer }) => layer === 'architecture' || layer === 'typecheck')
        .map(({ id }) => id),
    ),
    ...artifacts.flatMap(({ requirementIds }) => requirementIds),
  ]);
  return {
    version: SRIJIKA_NEXT_TEST_ADAPTER_VERSION,
    framework: 'next-app-router',
    contractVersion: contract.version,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    artifacts: artifacts.sort(
      (left, right) =>
        left.ownerId.localeCompare(right.ownerId) ||
        left.relativePath.localeCompare(right.relativePath),
    ),
    uncoveredRequirementIds: contract.owners
      .flatMap((owner) => owner.requirements.map(({ id }) => id))
      .filter((id) => !covered.has(id))
      .sort(),
    scripts: {
      'test:srijika:next': `${packageManager} run test:srijika:next:unit && ${packageManager} run test:srijika:next:browser`,
      'test:srijika:next:unit': 'vitest run --config tests/srijika-next/vitest.config.ts',
      'test:srijika:next:browser':
        'playwright test --config tests/srijika-next/playwright.config.ts',
    },
    devDependencies: [
      { name: '@axe-core/playwright', version: '4.12.1', reason: 'Owner WCAG evidence.' },
      { name: '@playwright/test', version: '1.62.1', reason: 'Real App Router evidence.' },
      { name: 'vitest', version: '4.1.10', reason: 'Framework-neutral runtime unit tests.' },
    ],
    evidence: {
      vitestJson: 'test-results/srijika-next/vitest.json',
      playwrightJson: 'test-results/srijika-next/playwright.json',
    },
  };
}
