import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSrijikaArchitectureConfig } from '@srijika/architecture-rules';

import {
  discoverSafeSrijikaMigrationSources,
  discoverSafeSrijikaSources,
  openSafeSrijikaWorkspace,
} from '../src/safe-workspace-files';

const temporaryRoots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-vscode-safe-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'src/features/home'), { recursive: true });
  await mkdir(join(root, 'src/shared'), { recursive: true });
  await writeFile(
    join(root, 'srijika.config.json'),
    JSON.stringify({ architecture: { profile: 'feature-slot-part-v1' } }),
  );
  await writeFile(
    join(root, 'src/features/home/Home.ui.tsx'),
    'export function HomeUI() { return null; }\n',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('VS Code safe workspace discovery', () => {
  it('reads a valid config and discovers canonical source', async () => {
    const root = await workspace();
    const fileSystem = await openSafeSrijikaWorkspace(root);
    const config = await fileSystem.readText('srijika.config.json', 64 * 1024);
    const files = await discoverSafeSrijikaSources(
      fileSystem,
      resolveSrijikaArchitectureConfig(
        (JSON.parse(config.source) as { architecture: { profile: 'feature-slot-part-v1' } })
          .architecture,
      ),
    );

    expect(files.map(({ relativePath }) => relativePath)).toEqual([
      'src/features/home/Home.ui.tsx',
    ]);
  });

  it('discovers cross-root migration consumers without widening architecture validation', async () => {
    const root = await workspace();
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(
      join(root, 'src/app/home-runtime.ts'),
      "import { useHome } from '../features/home/useHome';\nvoid useHome;\n",
    );
    const ignoredDependencyTree = await mkdtemp(join(tmpdir(), 'srijika-vscode-dependencies-'));
    temporaryRoots.push(ignoredDependencyTree);
    await writeFile(join(ignoredDependencyTree, 'outside.ts'), 'export const outside = true;\n');
    await symlink(ignoredDependencyTree, join(root, 'node_modules'), 'dir');
    const fileSystem = await openSafeSrijikaWorkspace(root);

    const architectureFiles = await discoverSafeSrijikaSources(
      fileSystem,
      resolveSrijikaArchitectureConfig(),
    );
    const migrationFiles = await discoverSafeSrijikaMigrationSources(fileSystem);

    expect(architectureFiles.map(({ relativePath }) => relativePath)).toEqual([
      'src/features/home/Home.ui.tsx',
    ]);
    expect(migrationFiles.map(({ relativePath }) => relativePath)).toEqual([
      'src/app/home-runtime.ts',
      'src/features/home/Home.ui.tsx',
    ]);
  });

  it('still rejects non-ignored project symlinks during migration discovery', async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), 'srijika-vscode-migration-outside-'));
    temporaryRoots.push(outside);
    await writeFile(join(outside, 'outside.ts'), 'export const outside = true;\n');
    await symlink(outside, join(root, 'vendor'), 'dir');
    const fileSystem = await openSafeSrijikaWorkspace(root);

    await expect(discoverSafeSrijikaMigrationSources(fileSystem)).rejects.toThrow(/symbolic link/);
  });

  it('stops full-project migration discovery at an independently configured nested project', async () => {
    const root = await workspace();
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(join(root, 'src/app/runtime.ts'), 'export const runtime = true;\n');
    const nested = join(root, 'examples/nested');
    await mkdir(join(nested, 'src'), { recursive: true });
    await writeFile(
      join(nested, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/Nested.ui.tsx' }),
    );
    await writeFile(join(nested, 'src/consumer.ts'), "import '../../src/app/runtime';\n");
    const fileSystem = await openSafeSrijikaWorkspace(root);

    const migrationFiles = await discoverSafeSrijikaMigrationSources(fileSystem);

    expect(migrationFiles.map(({ relativePath }) => relativePath)).toContain('src/app/runtime.ts');
    expect(
      migrationFiles.some(({ relativePath }) => relativePath.startsWith('examples/nested/')),
    ).toBe(false);
  });

  it('rejects a symlinked config before VS Code reads it', async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), 'srijika-vscode-config-outside-'));
    temporaryRoots.push(outside);
    await rename(join(root, 'srijika.config.json'), join(outside, 'srijika.config.json'));
    await symlink(join(outside, 'srijika.config.json'), join(root, 'srijika.config.json'), 'file');

    const fileSystem = await openSafeSrijikaWorkspace(root);
    await expect(fileSystem.readText('srijika.config.json', 64 * 1024)).rejects.toThrow(
      /symbolic link/,
    );
  });

  it.each(['root', 'ancestor', 'file'] as const)(
    'rejects a symlinked ownership %s before VS Code source discovery',
    async (scenario) => {
      const root = await workspace();
      const outside = await mkdtemp(join(tmpdir(), 'srijika-vscode-source-outside-'));
      temporaryRoots.push(outside);
      await writeFile(join(outside, 'Secret.ui.tsx'), 'export const secret = "outside";\n');
      if (scenario === 'root') {
        await rm(join(root, 'src/features'), { recursive: true });
        await symlink(outside, join(root, 'src/features'), 'dir');
      } else if (scenario === 'ancestor') {
        await symlink(outside, join(root, 'src/features/home/slots'), 'dir');
      } else {
        await rm(join(root, 'src/features/home/Home.ui.tsx'));
        await symlink(
          join(outside, 'Secret.ui.tsx'),
          join(root, 'src/features/home/Home.ui.tsx'),
          'file',
        );
      }
      const fileSystem = await openSafeSrijikaWorkspace(root);

      await expect(
        discoverSafeSrijikaSources(fileSystem, resolveSrijikaArchitectureConfig()),
      ).rejects.toThrow(/symbolic link/);
    },
  );

  it('rejects source trees deeper than the extension discovery bound', async () => {
    const root = await workspace();
    const segments = Array.from({ length: 33 }, (_, index) => `d${index}`);
    await mkdir(join(root, 'src/features', ...segments), { recursive: true });
    const fileSystem = await openSafeSrijikaWorkspace(root);

    await expect(
      discoverSafeSrijikaSources(fileSystem, resolveSrijikaArchitectureConfig()),
    ).rejects.toThrow(/depth safety limit/);
  });
});
