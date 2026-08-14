import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSrijikaStructureOwner } from '@srijika/architecture-rules';

import {
  applySrijikaOwnershipCreationPlan,
  buildSrijikaOwnershipCreationPlan,
} from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-owner-writer-'));
  roots.push(root);
  return root;
}

describe('applySrijikaOwnershipCreationPlan', () => {
  it('creates a complete owner batch without overwriting any target', async () => {
    const root = await temporaryRoot();
    const owner = resolveSrijikaStructureOwner('src/features');
    if (!owner) throw new Error('Expected the Features root.');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'logic', 'types'],
    });

    const result = await applySrijikaOwnershipCreationPlan(root, plan);

    expect(result.created).toHaveLength(5);
    await expect(
      readFile(join(root, 'src/features/dashboard/Dashboard.connector.tsx'), 'utf8'),
    ).resolves.toContain("import { useDashboard } from './useDashboard';");
    await expect(applySrijikaOwnershipCreationPlan(root, plan)).rejects.toThrow(/already exists/);
  });

  it('rejects a stale planned update before replacing custom source', async () => {
    const root = await temporaryRoot();
    const relativePath = 'src/features/home/Home.connector.tsx';
    const absolutePath = join(root, relativePath);
    await mkdir(join(root, 'src/features/home'), { recursive: true });
    await writeFile(absolutePath, 'newer user source', { encoding: 'utf8', flag: 'wx' });
    const plan = {
      ownerName: 'Home',
      ownerFolder: 'src/features/home',
      files: [],
      updates: [{ relativePath, source: 'planned source' }],
    } as const;

    await expect(
      applySrijikaOwnershipCreationPlan(root, plan, {
        expectedUpdateSources: { [relativePath]: 'older source' },
      }),
    ).rejects.toThrow(/changed after planning/);
  });
});
