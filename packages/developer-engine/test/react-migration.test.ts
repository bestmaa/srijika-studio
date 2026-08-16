import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyReactMigrationSlice,
  buildReactMigrationCliArguments,
  finalizeReactMigration,
  getReactMigrationStatus,
  scanReactMigrationSource,
  startReactMigration,
  verifyReactMigration,
  verifyReactMigrationSlice,
} from '../src/index.js';

const roots: string[] = [];
const sliceEvidence = [
  { name: 'typecheck', status: 'passed' },
  { name: 'build', status: 'passed' },
] as const;

async function reactFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-react-source-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'legacy-widget',
      private: true,
      scripts: { build: 'vite build', test: 'vitest run' },
      dependencies: { react: '^19.0.0', vite: '^8.0.0' },
    }),
  );
  await writeFile(
    join(root, 'src/Widget.jsx'),
    "export function Widget({ label }) { return <button className='widget'>{label}</button>; }\n",
  );
  await writeFile(join(root, 'src/widget.css'), '.widget { color: rebeccapurple; }\n');
  await writeFile(
    join(root, '.env.example'),
    'VITE_API_URL=https://example.invalid\nSECRET_VALUE=\n',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('React migration engine', () => {
  it('scans without exposing environment values and builds one deterministic snapshot', async () => {
    const source = await reactFixture();
    const inventory = await scanReactMigrationSource(source);

    expect(inventory.framework).toBe('vite');
    expect(inventory.files.map((file) => file.relativePath)).toEqual([
      '.env.example',
      'package.json',
      'src/Widget.jsx',
      'src/widget.css',
    ]);
    expect(inventory.environmentKeys['.env.example']).toEqual(['SECRET_VALUE', 'VITE_API_URL']);
    expect(JSON.stringify(inventory)).not.toContain('https://example.invalid');
    expect(inventory.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('migrates a reviewed widget into a new project, preserves source, and finalizes only with evidence', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-widget');
    const sourceBefore = await readFile(join(source, 'src/Widget.jsx'), 'utf8');

    const started = await startReactMigration({ source, target });
    expect(started.phase).toBe('scaffolded');
    await expect(startReactMigration({ source, target })).resolves.toMatchObject({
      id: started.id,
    });

    const targetUi = 'src/shared/ui/migrated-widget/MigratedWidget.ui.tsx';
    const targetTypes = 'src/shared/ui/migrated-widget/migratedWidget.types.ts';
    await applyReactMigrationSlice({
      target,
      slice: {
        id: 'ui',
        title: 'React components and widgets',
        writes: [
          {
            relativePath: targetTypes,
            content:
              'export interface MigratedWidgetUIProps { label: string; className?: string }\n',
          },
          {
            relativePath: targetUi,
            content:
              "import type { MigratedWidgetUIProps } from './migratedWidget.types';\nexport function MigratedWidgetUI(props: MigratedWidgetUIProps) {\n  return <button className={props.className}>{props.label}</button>;\n}\n",
          },
        ],
        mappings: [
          {
            sourcePath: 'src/Widget.jsx',
            targetPaths: [targetUi, targetTypes],
            kind: 'migrated',
          },
        ],
      },
    });
    await expect(verifyReactMigrationSlice(target, 'ui')).rejects.toThrow(
      /requires passed typecheck evidence/u,
    );
    await verifyReactMigrationSlice(target, 'ui', sliceEvidence);
    await applyReactMigrationSlice({
      target,
      slice: {
        id: 'presentation',
        title: 'Styles and static assets',
        writes: [],
        mappings: [{ sourcePath: 'src/widget.css', targetPaths: [targetUi], kind: 'style' }],
      },
    });
    await verifyReactMigrationSlice(target, 'presentation', sliceEvidence);
    await applyReactMigrationSlice({
      target,
      slice: {
        id: 'verification',
        title: 'Tests, configuration, and environment contract',
        writes: [],
        mappings: [],
        ignoredSources: [
          { sourcePath: 'package.json', reason: 'Replaced by the pinned Srijika scaffold.' },
          {
            sourcePath: '.env.example',
            reason: 'Keys were reviewed; values are supplied by deployment.',
          },
        ],
      },
    });
    const sliceVerified = await verifyReactMigrationSlice(target, 'verification', sliceEvidence);
    expect(sliceVerified.appliedSlices.every((slice) => slice.verified)).toBe(true);

    const verified = await verifyReactMigration({
      target,
      commands: [
        { name: 'typecheck', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'test', status: 'passed', details: 'Migration verification suite passed.' },
      ],
    });
    expect(verified.verification?.errors).toContain(
      'Visual parity evidence with at least two reviewed viewport details is required.',
    );
    await expect(
      verifyReactMigration({
        target,
        commands: [
          { name: 'typecheck', status: 'passed' },
          { name: 'typecheck', status: 'passed' },
        ],
      }),
    ).rejects.toThrow(/Duplicate migration verification evidence/u);

    const visuallyVerified = await verifyReactMigration({
      target,
      commands: [
        { name: 'install', status: 'passed' },
        { name: 'typecheck', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'test', status: 'passed', details: 'Migration verification suite passed.' },
        {
          name: 'visual',
          status: 'passed',
          details: 'Reviewed source and target widget captures match on mobile and desktop.',
        },
      ],
    });
    expect(visuallyVerified.verification).toMatchObject({
      passed: true,
      sourceUnchanged: true,
      srijikaDiagnosticsValid: true,
    });
    const commands = visuallyVerified.verification?.commands;
    if (!commands) throw new Error('Expected migration verification command evidence.');
    await expect(finalizeReactMigration({ target, commands })).resolves.toMatchObject({
      phase: 'complete',
    });
    expect(await readFile(join(source, 'src/Widget.jsx'), 'utf8')).toBe(sourceBefore);
    await expect(getReactMigrationStatus(target)).resolves.toMatchObject({ phase: 'complete' });
  });

  it('fails closed when source and target overlap or the source changes', async () => {
    const source = await reactFixture();
    await expect(
      startReactMigration({ source, target: join(source, 'converted') }),
    ).rejects.toThrow(/non-overlapping/);

    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-change-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    await startReactMigration({ source, target });
    await writeFile(
      join(source, 'src/Widget.jsx'),
      'export const Widget = () => <div>changed</div>;\n',
    );
    const verified = await verifyReactMigration({ target });
    expect(verified.phase).toBe('blocked');
    expect(verified.verification?.sourceUnchanged).toBe(false);
  });

  it('rejects unreviewed slices, missing mapped targets, unsafe writes, and nonempty targets', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-adversarial-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    await startReactMigration({ source, target });

    await expect(
      applyReactMigrationSlice({
        target,
        slice: { id: 'surprise', title: 'Unreviewed slice', writes: [], mappings: [] },
      }),
    ).rejects.toThrow(/not present in the reviewed plan/u);
    await expect(
      applyReactMigrationSlice({
        target,
        slice: { id: 'ui', title: 'Changed after review', writes: [], mappings: [] },
      }),
    ).rejects.toThrow(/title must match the reviewed plan/u);
    await expect(
      applyReactMigrationSlice({
        target,
        slice: {
          id: 'ui',
          title: 'React components and widgets',
          writes: [],
          mappings: [
            {
              sourcePath: 'src/Widget.jsx',
              targetPaths: ['src/shared/ui/missing/Missing.ui.tsx'],
              kind: 'migrated',
            },
          ],
        },
      }),
    ).rejects.toThrow(/does not exist and is not written/u);
    await expect(
      applyReactMigrationSlice({
        target,
        slice: {
          id: 'ui',
          title: 'React components and widgets',
          writes: [{ relativePath: '../escape.ts', content: 'export {}\n' }],
          mappings: [],
        },
      }),
    ).rejects.toThrow(/project-relative/u);

    await expect(
      applyReactMigrationSlice({
        target,
        slice: {
          id: 'ui',
          title: 'React components and widgets',
          writes: [
            {
              relativePath: 'src/shared/ui/broken/Broken.ui.tsx',
              content:
                'export interface BrokenUIProps { label: string }\nexport function BrokenUI({ label }: BrokenUIProps) { return <div>{label}</div>; }\n',
            },
          ],
          mappings: [],
        },
      }),
    ).rejects.toThrow(/zero Srijika diagnostics/u);
    await expect(
      readFile(join(target, 'src/shared/ui/broken/Broken.ui.tsx'), 'utf8'),
    ).rejects.toThrow();

    const outside = await mkdtemp(join(tmpdir(), 'srijika-react-symlink-outside-'));
    roots.push(outside);
    await mkdir(join(target, 'src/shared/ui'), { recursive: true });
    await symlink(outside, join(target, 'src/shared/ui/linked'), 'dir');
    await expect(
      applyReactMigrationSlice({
        target,
        slice: {
          id: 'ui',
          title: 'React components and widgets',
          writes: [
            {
              relativePath: 'src/shared/ui/linked/Leaked.ui.tsx',
              content: 'export function LeakedUI() { return <div />; }\n',
            },
          ],
          mappings: [],
        },
      }),
    ).rejects.toThrow(/symbolic link/u);

    await rm(join(target, 'src/shared/ui/linked'));
    await rm(join(target, '.srijika'), { recursive: true, force: true });
    await writeFile(join(target, 'unexpected.txt'), 'not an empty generated starter\n');
    await expect(startReactMigration({ source, target })).rejects.toThrow(
      /not an empty generated starter/u,
    );
  });

  it('requires route parity evidence when the source has route files', async () => {
    const source = await reactFixture();
    await writeFile(
      join(source, 'src/semantic-navigation.jsx'),
      'export function CurrentRoute() { return <p>{window.location.pathname}</p>; }\n',
    );
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-route-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    expect(started.inventory.semanticRoutesPresent).toBe(true);
    const verified = await verifyReactMigration({
      target,
      commands: [
        { name: 'typecheck', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'test', status: 'passed' },
        { name: 'visual', status: 'passed' },
      ],
    });
    expect(verified.verification?.errors).toContain(
      'Route parity evidence with reviewed details is required.',
    );
  });

  it('exports one exact CLI argument contract for editor adapters', () => {
    expect(
      buildReactMigrationCliArguments({
        operation: 'start',
        source: '/projects/legacy',
        target: '/projects/converted',
      }),
    ).toEqual([
      'migrate',
      'react',
      '--source',
      '/projects/legacy',
      '--target',
      '/projects/converted',
      '--json',
    ]);
  });
});
