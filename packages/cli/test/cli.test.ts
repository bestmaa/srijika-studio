import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSrijikaProjectFileMap, writeSrijikaProject } from '@srijika/project-scaffold';

import { addSrijikaStructure } from '../src/add.js';
import { parseSrijikaArguments } from '../src/arguments.js';
import { resolveSrijikaStudioExecutable } from '../src/studio.js';

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
