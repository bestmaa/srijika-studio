import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applySrijikaTestPackagePlan, buildSrijikaViteTestAdapterPlan } from '../src';
import { buildSrijikaTestContract } from '@srijika/architecture-rules';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function plan() {
  return buildSrijikaViteTestAdapterPlan(buildSrijikaTestContract([]));
}

describe('safe owner-test package synchronization', () => {
  it('adds missing scripts and dependencies without replacing authored values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-test-package-'));
    roots.push(root);
    await writeFile(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'app',
          scripts: { 'test:srijika': 'authored-command' },
          devDependencies: { vitest: '^4.0.0' },
        },
        null,
        2,
      )}\n`,
    );

    const result = await applySrijikaTestPackagePlan(root, plan());
    const written = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(result).toMatchObject({
      updated: true,
      preservedScripts: ['test:srijika'],
      preservedDevDependencies: ['vitest'],
      addedDevDependencies: ['@axe-core/playwright', '@playwright/test'],
    });
    expect(written.scripts['test:srijika']).toBe('authored-command');
    expect(written.scripts['test:srijika:browser']).toContain('playwright test');
    expect(written.devDependencies['vitest']).toBe('^4.0.0');

    const second = await applySrijikaTestPackagePlan(root, plan());
    expect(second.updated).toBe(false);
  });

  it('refuses a package.json symbolic link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-test-package-'));
    const outside = await mkdtemp(join(tmpdir(), 'srijika-test-package-outside-'));
    roots.push(root, outside);
    await writeFile(join(outside, 'package.json'), '{"name":"outside"}\n');
    await symlink(join(outside, 'package.json'), join(root, 'package.json'));
    await expect(applySrijikaTestPackagePlan(root, plan())).rejects.toThrow(/symbolic link/);
    await expect(readFile(join(outside, 'package.json'), 'utf8')).resolves.toContain('outside');
  });
});
