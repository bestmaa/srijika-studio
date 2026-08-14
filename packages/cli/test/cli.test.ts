import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSrijikaProjectFileMap, writeSrijikaProject } from '@srijika/project-scaffold';

import { addSrijikaStructure } from '../src/add.js';
import { parseSrijikaArguments } from '../src/arguments.js';
import { runSrijikaCli } from '../src/cli.js';
import { findSrijikaStudioExecutable, resolveSrijikaStudioExecutable } from '../src/studio.js';
import { resolveVSCodeLaunch } from '../src/vscode.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'srijika-cli-'));
  roots.push(parent);
  const root = join(parent, 'app');
  await writeSrijikaProject(root, { projectName: 'cli-test', displayName: 'CLI Test' });
  return root;
}

describe('argument parsing', () => {
  it('parses positional targets, valued options, and capability flags', () => {
    const parsed = parseSrijikaArguments([
      'slot',
      'Summary',
      '--in',
      'src/features/home',
      '--hook',
      '--logic',
    ]);

    expect(parsed.positionals).toEqual(['slot', 'Summary']);
    expect(parsed.options.get('in')).toBe('src/features/home');
    expect(parsed.options.get('hook')).toBe(true);
    expect(parsed.options.get('logic')).toBe(true);
  });
});

describe('Desktop handoff', () => {
  it('honors the explicit installed Studio path without guessing platform locations', async () => {
    await expect(
      resolveSrijikaStudioExecutable({ SRIJIKA_STUDIO_PATH: '/opt/srijika/srijika-studio' }),
    ).resolves.toBe('/opt/srijika/srijika-studio');
  });

  it('treats missing optional Studio as unavailable instead of failing setup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'srijika-no-studio-'));
    roots.push(home);
    await expect(
      findSrijikaStudioExecutable({ HOME: home, PATH: '' }, 'linux'),
    ).resolves.toBeNull();
  });
});

describe('VS Code handoff', () => {
  it('uses the adjacent Windows GUI from WSL with the exact remote authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-vscode-'));
    roots.push(root);
    const bin = join(root, 'Microsoft VS Code', 'bin');
    await mkdir(bin, { recursive: true });
    const gui = join(root, 'Microsoft VS Code', 'Code.exe');
    await writeFile(gui, 'test');

    await expect(
      resolveVSCodeLaunch({ PATH: bin, WSL_DISTRO_NAME: 'Ubuntu' }, 'linux'),
    ).resolves.toEqual({
      executable: gui,
      prefixArguments: ['--remote', 'wsl+Ubuntu'],
    });
  });
});

describe('create command', () => {
  it('creates a complete CLI-first project without requiring VS Code or Studio', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-create-'));
    roots.push(parent);
    const root = join(parent, 'portable-app');
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(
        runSrijikaCli(['create', root, '--no-install', '--no-open', '--json']),
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n')) as { statuses: Record<string, string> };
    expect(payload.statuses).toMatchObject({
      dependencies: 'skipped',
      vscode: 'skipped',
      studio: 'skipped',
    });
    await expect(readFile(join(root, 'srijika.config.json'), 'utf8')).resolves.toContain(
      'feature-slot-part-v1',
    );
    await expect(readFile(join(root, '.vscode/extensions.json'), 'utf8')).resolves.toContain(
      'srijika.srijika-language-support',
    );
    await expect(readFile(join(root, '.vscode/tasks.json'), 'utf8')).resolves.toContain(
      'Srijika: Run App',
    );
  });
});

describe('add command', () => {
  it('creates a strict Slot batch through the shared planner and writer', async () => {
    const root = await project();
    const parsed = parseSrijikaArguments([
      'slot',
      'Summary',
      '--project',
      root,
      '--in',
      'src/features/home',
      '--hook',
      '--logic',
    ]);

    const result = await addSrijikaStructure(parsed);

    expect(result.plan.files.map((file) => file.relativePath)).toEqual([
      'src/features/home/slots/summary/Summary.ui.tsx',
      'src/features/home/slots/summary/summary.logic.ts',
      'src/features/home/slots/summary/useSummary.ts',
      'src/features/home/slots/summary/Summary.connector.tsx',
    ]);
    await expect(
      readFile(join(root, 'src/features/home/slots/summary/Summary.connector.tsx'), 'utf8'),
    ).resolves.toContain("import { useSummary } from './useSummary';");
  });

  it('supports a no-write dry run and rejects noncanonical folders', async () => {
    const root = await project();
    const parsed = parseSrijikaArguments([
      'slot',
      'Audit',
      '--project',
      root,
      '--in',
      'src/features/home',
      '--dry-run',
    ]);

    const result = await addSrijikaStructure(parsed);
    expect(result.dryRun).toBe(true);
    await expect(access(join(root, 'src/features/home/slots/audit'))).rejects.toThrow();

    await expect(
      addSrijikaStructure(
        parseSrijikaArguments(['slot', 'Wrong', '--project', root, '--in', 'src/components']),
      ),
    ).rejects.toThrow(/canonical/);
  });

  it('keeps generated starter metadata available to the standalone CLI bundle', () => {
    const files = createSrijikaProjectFileMap();
    expect(files['srijika.toolchain.json']).toContain('react-web-v1');
  });
});
