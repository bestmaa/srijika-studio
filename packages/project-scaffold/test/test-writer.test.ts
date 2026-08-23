import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSrijikaTestContract } from '@srijika/architecture-rules';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applySrijikaNextAppRouterPlan,
  applySrijikaNextTestAdapterPlan,
  applySrijikaViteTestAdapterPlan,
  buildSrijikaNextAppRouterPlan,
  buildSrijikaNextTestAdapterPlan,
  buildSrijikaViteTestAdapterPlan,
} from '../src';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

function adapterPlan() {
  return buildSrijikaViteTestAdapterPlan(
    buildSrijikaTestContract([
      {
        fileName: 'src/features/home/Home.ui.tsx',
        source: 'export function HomeUI() { return <main data-srijika-owner="Home" />; }',
      },
      {
        fileName: 'src/features/home/Home.connector.tsx',
        source:
          "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }",
      },
    ]),
  );
}

describe('safe Srijika Vite test adapter writes', () => {
  it('creates generated files and preserves the user-owned fixture boundary on resync', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-test-writer-'));
    temporaryRoots.push(root);
    const plan = adapterPlan();

    const first = await applySrijikaViteTestAdapterPlan(root, plan);
    expect(first.created).toHaveLength(plan.files.length);
    const fixturePath = join(root, 'tests/srijika/owner-fixtures.ts');
    await writeFile(fixturePath, 'export const ownerFixtures = { custom: true };\n', 'utf8');

    const second = await applySrijikaViteTestAdapterPlan(root, plan);
    expect(second.preserved).toEqual(['tests/srijika/owner-fixtures.ts']);
    expect(await readFile(fixturePath, 'utf8')).toContain('custom: true');
  });

  it('updates recognized generated output and refuses an authored collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-test-writer-'));
    temporaryRoots.push(root);
    const plan = adapterPlan();
    await applySrijikaViteTestAdapterPlan(root, plan);

    const generatedPath = join(root, 'tests/srijika/harness/main.tsx');
    const generated = await readFile(generatedPath, 'utf8');
    await writeFile(generatedPath, `${generated}\n// old generated revision\n`, 'utf8');
    const updated = await applySrijikaViteTestAdapterPlan(root, plan);
    expect(updated.updated).toEqual(['tests/srijika/harness/main.tsx']);

    await writeFile(generatedPath, 'export const authored = true;\n', 'utf8');
    await expect(applySrijikaViteTestAdapterPlan(root, plan)).rejects.toThrow(/will not overwrite/);
  });

  it('rejects relative project roots', async () => {
    await expect(applySrijikaViteTestAdapterPlan('.', adapterPlan())).rejects.toThrow(
      /explicit absolute path/,
    );
  });
});

describe('safe Srijika Next.js test adapter writes', () => {
  it('creates its isolated harness and preserves its user-owned fixtures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-next-test-writer-'));
    temporaryRoots.push(root);
    const plan = buildSrijikaNextTestAdapterPlan(
      buildSrijikaTestContract([
        {
          fileName: 'src/features/home/Home.ui.tsx',
          source: 'export async function HomeUI() { return <main>Home</main>; }',
        },
      ]),
    );

    const first = await applySrijikaNextTestAdapterPlan(root, plan);
    expect(first.created).toContain('tests/srijika-next/harness/app/page.tsx');
    const fixturePath = join(root, 'tests/srijika-next/owner-fixtures.ts');
    await writeFile(fixturePath, 'export const ownerFixtures = { next: true };\n', 'utf8');

    const second = await applySrijikaNextTestAdapterPlan(root, plan);
    expect(second.preserved).toEqual(['tests/srijika-next/owner-fixtures.ts']);
    expect(await readFile(fixturePath, 'utf8')).toContain('next: true');
  });
});

describe('safe Srijika Next App Router writes', () => {
  it('preserves an authored layout, updates generated routes, and rejects invalid boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-next-route-writer-'));
    temporaryRoots.push(root);
    const sources = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return <main>Home</main>; }',
      'src/features/home/Home.connector.tsx':
        "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }",
    };
    const contract = buildSrijikaTestContract(
      Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
    );
    const plan = buildSrijikaNextAppRouterPlan(contract, {
      routes: [{ pathname: '/', ownerId: 'feature:home' }],
      sources,
    });
    await applySrijikaNextAppRouterPlan(root, plan);
    const layout = join(root, 'src/app/layout.tsx');
    await writeFile(layout, 'export default function AuthoredLayout() { return null; }\n', 'utf8');
    const page = join(root, 'src/app/page.tsx');
    await writeFile(page, `${await readFile(page, 'utf8')}\n// old generated revision\n`, 'utf8');
    const synchronized = await applySrijikaNextAppRouterPlan(root, plan);
    expect(synchronized.preserved).toEqual(['src/app/layout.tsx']);
    expect(synchronized.updated).toEqual(['src/app/page.tsx']);

    const invalid = buildSrijikaNextAppRouterPlan(contract, {
      routes: [{ pathname: '/', ownerId: 'feature:home' }],
      sources: {
        ...sources,
        'src/features/home/Home.connector.tsx':
          "import { useState } from 'react'; export function HomeConnector() { useState(0); return null; }",
      },
    });
    await expect(applySrijikaNextAppRouterPlan(root, invalid)).rejects.toThrow(/diagnostics/);
  });
});
