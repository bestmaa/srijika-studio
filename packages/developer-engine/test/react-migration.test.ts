import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyReactMigrationSlice,
  attestReactMigrationParity,
  buildReactMigrationCliArguments,
  captureReactMigrationBrowserParity,
  discardReactMigrationSliceReview,
  finalizeReactMigration,
  getReactMigrationStatus,
  inspectReactMigrationArchitecture,
  planReactMigration,
  scanReactMigrationSource,
  reviewReactMigrationOwnership,
  reviewReactMigrationSlice,
  runReactMigrationVerificationGates,
  startReactMigration,
  synchronizeReactMigrationValidator,
  verifyReactMigration,
  verifyReactMigrationSlice,
  type ReactMigrationCommandStatus,
  type ReactMigrationSession,
  type ReactMigrationSlice,
} from '../src/index.js';

const roots: string[] = [];
const installedTargets = new Set<string>();
const execFileAsync = promisify(execFile);
const fileHash = (source: Buffer | string): string =>
  createHash('sha256').update(source).digest('hex');
async function evidence(
  target: string,
  commands: readonly Omit<ReactMigrationCommandStatus, 'receipt'>[],
): Promise<ReactMigrationCommandStatus[]> {
  if (!installedTargets.has(target)) {
    try {
      await execFileAsync('pnpm', ['install', '--offline', '--ignore-scripts'], { cwd: target });
    } catch (error) {
      const localPnpm = process.env['HOME']
        ? join(process.env['HOME'], '.local', 'bin', 'pnpm')
        : undefined;
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || !localPnpm) {
        throw error;
      }
      await execFileAsync(localPnpm, ['install', '--offline', '--ignore-scripts'], { cwd: target });
    }
    installedTargets.add(target);
  }
  const packagePath = join(target, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
  await mkdir(join(target, '.srijika/migrations/react/evidence'), { recursive: true });
  await writeFile(
    join(target, '.srijika/migrations/react/evidence/migration.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict'; import { existsSync } from 'node:fs'; test('native widget exists', () => assert.equal(existsSync('src/features/widget/Widget.ui.tsx'), true));\n",
  );
  packageJson['scripts'] = {
    ...(packageJson['scripts'] as Record<string, string>),
    test: 'node --test .srijika/migrations/react/evidence/migration.test.mjs',
  };
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const requestedGateNames = commands
    .map((command) => command.name)
    .filter(
      (name): name is 'typecheck' | 'build' | 'test' =>
        name === 'typecheck' || name === 'build' || name === 'test',
    );
  const gates = await runReactMigrationVerificationGates({
    target,
    names: requestedGateNames.length > 0 ? [...new Set(requestedGateNames)] : ['typecheck'],
  });
  const session = await getReactMigrationStatus(target);
  const results: ReactMigrationCommandStatus[] = [];
  for (const command of commands) {
    if (command.name === 'routes' || command.name === 'visual') {
      const applicable = session.plan.ownership.filter((decision) => {
        const category = session.inventory.files.find(
          (file) => file.relativePath === decision.sourcePath,
        )?.category;
        return command.name === 'routes'
          ? decision.routeEntrypoint
          : category !== undefined && ['entry', 'component', 'style', 'asset'].includes(category);
      });
      const pairs = applicable.map((decision) => {
        const mapping = session.mappings.find(
          (candidate) =>
            candidate.mode === 'native' && candidate.sourcePath === decision.sourcePath,
        );
        if (!mapping?.targetPaths[0])
          throw new Error(`Missing native parity mapping for ${decision.sourcePath}.`);
        return [decision.sourcePath, mapping.targetPaths[0]] as const;
      });
      const evidenceDirectory = join(target, '.srijika/migrations/react/evidence');
      await mkdir(join(evidenceDirectory, 'source'), { recursive: true });
      await mkdir(join(evidenceDirectory, 'target'), { recursive: true });
      const extension = command.name === 'visual' ? 'png' : 'json';
      const coveredSourcePaths = pairs.map(([sourcePath]) => sourcePath).sort();
      const captureCases: Array<{ sourcePath: string; viewport?: string }> = [];
      for (const sourcePath of coveredSourcePaths) {
        if (command.name === 'visual') {
          captureCases.push(
            { sourcePath, viewport: 'desktop' },
            { sourcePath, viewport: 'mobile' },
          );
        } else {
          captureCases.push({ sourcePath });
        }
      }
      const evidencePairs = await Promise.all(
        captureCases.map(async ({ sourcePath, viewport }, index) => {
          const bindingToken = `${fileHash(sourcePath).slice(0, 12)}${viewport ? `-${viewport}` : ''}`;
          const sourceArtifact = `.srijika/migrations/react/evidence/source/${command.name}-${bindingToken}-${index}.${extension}`;
          const targetArtifact = `.srijika/migrations/react/evidence/target/${command.name}-${bindingToken}-${index}.${extension}`;
          const content =
            command.name === 'visual'
              ? Buffer.from(
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                  'base64',
                )
              : Buffer.from(`${JSON.stringify({ sourcePath, result: 'equal', viewport })}\n`);
          await writeFile(join(target, sourceArtifact), content);
          await writeFile(join(target, targetArtifact), content);
          return [sourceArtifact, targetArtifact] as const;
        }),
      );
      results.push(
        await attestReactMigrationParity({
          target,
          name: command.name,
          coveredSourcePaths,
          sourceArtifacts: evidencePairs.map(([sourceArtifact]) => sourceArtifact),
          targetArtifacts: evidencePairs.map(([, targetArtifact]) => targetArtifact),
          details: command.details ?? `${command.name} reviewed parity`,
          ...(command.name === 'visual' ? { viewports: ['mobile', 'desktop'] } : {}),
        }),
      );
    } else {
      const gate = gates.find((candidate) => candidate.name === command.name);
      if (!gate) throw new Error(`Missing executed ${command.name} gate.`);
      results.push(gate);
    }
  }
  return results;
}

async function sliceEvidence(target: string): Promise<ReactMigrationCommandStatus[]> {
  return evidence(target, [
    { name: 'typecheck', status: 'passed' },
    { name: 'build', status: 'passed' },
  ]);
}

function plannedSlice(session: ReactMigrationSession, sourcePath: string) {
  const slice = session.plan.slices.find((candidate) => candidate.sourcePaths.includes(sourcePath));
  if (!slice) throw new Error(`Missing planned slice for ${sourcePath}`);
  return slice;
}

function nativeMapping(
  session: ReactMigrationSession,
  sourcePath: string,
  targetPaths: readonly string[],
  kind: 'migrated' | 'asset' | 'style' = 'migrated',
) {
  const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath);
  if (!owner) throw new Error(`Missing owner for ${sourcePath}`);
  return {
    sourcePath,
    targetPaths,
    kind,
    mode: 'native' as const,
    ownerId: owner.ownerId,
    role: owner.role,
    rationale: `Native conversion into reviewed ${owner.ownerId}.`,
  };
}

async function reviewAndApply(target: string, slice: ReactMigrationSlice) {
  const review = await reviewReactMigrationSlice({ target, slice });
  return applyReactMigrationSlice({ target, reviewToken: review.token });
}

async function reactFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-react-source-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'public'), { recursive: true });
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
  await writeFile(join(root, 'public/runtime-data.json'), '{"floor":1}\n');
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
  it('inspects exact converted-target imports, exports, roles, and graph findings read-only', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-architecture-target-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });

    const inspection = await inspectReactMigrationArchitecture(target);
    expect(inspection.sessionId).toBe(started.id);
    expect(inspection.targetSnapshotSha256).toBeTruthy();
    const connector = inspection.modules.find(({ relativePath }) =>
      relativePath.endsWith('Home.connector.tsx'),
    );
    expect(connector?.roles).toContain('connector');
    expect(
      connector?.imports.some(
        (item) =>
          item.kind === 'target' && item.resolvedTargetPath?.endsWith('Home.ui.tsx') === true,
      ),
    ).toBe(true);
    expect(connector?.exports).toContain('HomeConnector');
    expect((await getReactMigrationStatus(target)).id).toBe(started.id);
  });

  it('scans without exposing environment values and builds one deterministic snapshot', async () => {
    const source = await reactFixture();
    await writeFile(
      join(source, 'src/Widget.jsx'),
      "const { VITE_REGION } = import.meta.env; export function Widget() { return <p>{import.meta.env.VITE_API_URL}{process.env['PUBLIC_LABEL']}{VITE_REGION}</p>; }\n",
    );
    const inventory = await scanReactMigrationSource(source);

    expect(inventory.framework).toBe('vite');
    expect(inventory.files.map((file) => file.relativePath)).toEqual([
      '.env.example',
      'package.json',
      'public/runtime-data.json',
      'src/Widget.jsx',
      'src/widget.css',
    ]);
    expect(
      inventory.files.find((file) => file.relativePath === 'public/runtime-data.json'),
    ).toMatchObject({
      category: 'asset',
    });
    expect(inventory.environmentKeys['.env.example']).toEqual(['SECRET_VALUE', 'VITE_API_URL']);
    expect(inventory.environmentKeys['src/Widget.jsx']).toEqual([
      'PUBLIC_LABEL',
      'VITE_API_URL',
      'VITE_REGION',
    ]);
    expect(JSON.stringify(inventory)).not.toContain('https://example.invalid');
    expect(inventory.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(inventory.ownership).toHaveLength(inventory.files.length);
  });

  it('inventories unknown files, resolves bounded source aliases, and records deterministic owners', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/modules/dashbord'), { recursive: true });
    await writeFile(
      join(source, 'tsconfig.app.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@modules/*': ['src/modules/*/module'] } },
      }),
    );
    await writeFile(
      join(source, 'src/modules/dashbord/module.ts'),
      'export const dashboardValue = 1;\n',
    );
    await writeFile(
      join(source, 'src/modules/dashbord/Dashboard.tsx'),
      "import { dashboardValue } from '@modules/dashbord'; export const Dashboard = () => <p>{dashboardValue}</p>;\n",
    );
    await writeFile(join(source, 'schema.custom'), 'opaque-but-inventoried\n');
    await writeFile(
      join(source, 'src/unresolved.ts'),
      "import { absent } from './absent'; export const unresolved = absent;\n",
    );

    const first = await scanReactMigrationSource(source);
    const second = await scanReactMigrationSource(source);
    expect(first.snapshotSha256).toBe(second.snapshotSha256);
    expect(first.files.find((file) => file.relativePath === 'schema.custom')?.category).toBe(
      'unsupported',
    );
    const dashboard = first.ownership.find(
      (owner) => owner.sourcePath === 'src/modules/dashbord/Dashboard.tsx',
    );
    expect(dashboard).toMatchObject({ ownerKind: 'feature', ownerName: 'dashboard' });
    expect(dashboard?.dependencies).toContainEqual(
      expect.objectContaining({
        specifier: '@modules/dashbord',
        kind: 'source',
        resolvedSourcePath: 'src/modules/dashbord/module.ts',
      }),
    );
    const plan = planReactMigration(first, '/tmp/native');
    expect(plan.unsupported.join(' ')).toMatch(/schema\.custom|Unresolved local dependency/u);
  });

  it('keeps executable project scripts as native project obligations at their command paths', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'scripts'), { recursive: true });
    await writeFile(join(source, 'scripts/refresh-session.mjs'), 'console.log("refresh");\n');

    const inventory = await scanReactMigrationSource(source);
    const script = inventory.files.find(
      (file) => file.relativePath === 'scripts/refresh-session.mjs',
    );
    const owner = inventory.ownership.find(
      (decision) => decision.sourcePath === 'scripts/refresh-session.mjs',
    );

    expect(script?.category).toBe('script');
    expect(owner).toMatchObject({
      ownerKind: 'project',
      role: 'configuration',
      completionObligation: 'native-owner',
      canonicalTargetPaths: ['scripts/refresh-session.mjs'],
    });
  });

  it('materializes only exact reviewed source package scripts for native executable mappings', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'scripts/refresh-session.mjs'),
      'console.log("legacy refresh");\n',
    );
    const packagePath = join(source, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
    packageJson['scripts'] = {
      ...(packageJson['scripts'] as Record<string, string>),
      'auth:refresh': 'node scripts/refresh-session.mjs',
    };
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-script-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-script');
    const session = await startReactMigration({ source, target });
    const sourcePath = 'scripts/refresh-session.mjs';
    const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath)!;
    const planned = session.plan.slices.find((slice) => slice.sourcePaths.includes(sourcePath))!;
    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [
          {
            relativePath: owner.canonicalTargetPaths[0]!,
            content: 'console.info("native refresh");\n',
          },
        ],
        sourcePackageScripts: [
          { name: 'auth:refresh', command: 'node scripts/refresh-session.mjs' },
        ],
        mappings: [nativeMapping(session, sourcePath, owner.canonicalTargetPaths)],
      },
    });
    await applyReactMigrationSlice({ target, reviewToken: review.token });
    const targetPackage = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(targetPackage.scripts['auth:refresh']).toBe('node scripts/refresh-session.mjs');
    expect(await readFile(join(target, owner.canonicalTargetPaths[0]!), 'utf8')).toContain(
      'native refresh',
    );
  });

  it('engine-copies a reviewed content-addressed source artifact without exposing bytes to the review', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-asset-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-asset');
    const session = await startReactMigration({ source, target });
    const sourcePath = 'public/runtime-data.json';
    const sourceFile = session.inventory.files.find((file) => file.relativePath === sourcePath)!;
    const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath)!;
    const planned = session.plan.slices.find((slice) => slice.sourcePaths.includes(sourcePath))!;
    expect(planned.sourcePaths).toEqual([sourcePath]);
    const targetPath = owner.canonicalTargetPaths[0]!;
    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [],
        sourceArtifactCopies: [
          { sourcePath, relativePath: targetPath, expectedSourceSha256: sourceFile.sha256 },
        ],
        mappings: [
          {
            sourcePath,
            targetPaths: [targetPath],
            kind: 'asset',
            mode: 'native',
            ownerId: owner.ownerId,
            role: owner.role,
            rationale: 'Engine copies the exact content-addressed source runtime data asset.',
          },
        ],
      },
    });
    await applyReactMigrationSlice({ target, reviewToken: review.token });
    expect(await readFile(join(target, targetPath), 'utf8')).toBe(
      await readFile(join(source, sourcePath), 'utf8'),
    );
  });

  it('engine-copies a reviewed stylesheet without exposing its source bytes to the review', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/shared'), { recursive: true });
    await writeFile(join(source, 'src/shared/tailwind.css'), '@layer components {}\n');
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-style-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-style');
    const session = await startReactMigration({ source, target });
    const sourcePath = 'src/shared/tailwind.css';
    const sourceFile = session.inventory.files.find((file) => file.relativePath === sourcePath)!;
    const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath)!;
    const planned = session.plan.slices.find((slice) => slice.sourcePaths.includes(sourcePath))!;
    const targetPath = owner.canonicalTargetPaths[0]!;

    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [],
        sourceArtifactCopies: [
          { sourcePath, relativePath: targetPath, expectedSourceSha256: sourceFile.sha256 },
        ],
        mappings: [nativeMapping(session, sourcePath, [targetPath], 'style')],
      },
    });
    await applyReactMigrationSlice({ target, reviewToken: review.token });
    expect(await readFile(join(target, targetPath), 'utf8')).toBe(
      await readFile(join(source, sourcePath), 'utf8'),
    );
  });

  it('engine-copies reviewed non-runtime configuration without exposing its source bytes', async () => {
    const source = await reactFixture();
    await writeFile(join(source, '.env.example'), 'VITE_PUBLIC_API_URL=https://example.test\n');
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-config-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-config');
    const session = await startReactMigration({ source, target });
    const sourcePath = '.env.example';
    const sourceFile = session.inventory.files.find((file) => file.relativePath === sourcePath)!;
    const planned = plannedSlice(session, sourcePath);
    const targetPath = sourcePath;

    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [],
        sourceArtifactCopies: [
          { sourcePath, relativePath: targetPath, expectedSourceSha256: sourceFile.sha256 },
        ],
        mappings: [nativeMapping(session, sourcePath, [targetPath])],
      },
    });
    await applyReactMigrationSlice({ target, reviewToken: review.token });
    expect(await readFile(join(target, targetPath), 'utf8')).toBe(
      'VITE_PUBLIC_API_URL=https://example.test\n',
    );
  });

  it('adds an exact source-declared safe registry dependency through a reviewed native slice', async () => {
    const source = await reactFixture();
    const sourcePackagePath = join(source, 'package.json');
    const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    sourcePackage.dependencies['fabric'] = '^6.7.0';
    await writeFile(sourcePackagePath, `${JSON.stringify(sourcePackage, null, 2)}\n`);
    await writeFile(
      join(source, 'src/FabricClient.ts'),
      "import { Canvas } from 'fabric'; export const sourceCanvas = Canvas;\n",
    );

    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-package-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-package');
    const session = await startReactMigration({ source, target });
    const sourcePath = 'src/FabricClient.ts';
    const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath)!;
    const planned = plannedSlice(session, sourcePath);
    expect(planned.sourcePaths).toContain(sourcePath);
    const targetPackageBefore = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
    };

    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [
          {
            relativePath: owner.canonicalTargetPaths[0]!,
            content: "export const nativeCanvas = 'fabric-ready';\n",
          },
        ],
        sourcePackageDependencies: [{ name: 'fabric', version: '^6.7.0', scope: 'dependency' }],
        mappings: [nativeMapping(session, sourcePath, owner.canonicalTargetPaths)],
      },
    });

    const reviewedPayload = JSON.parse(
      await readFile(join(target, review.payloadPath), 'utf8'),
    ) as ReactMigrationSlice;
    expect(reviewedPayload.sourcePackageDependencies).toEqual([
      { name: 'fabric', version: '^6.7.0', scope: 'dependency' },
    ]);
    const reviewedPackageWrite = reviewedPayload.writes.find(
      (write) => write.relativePath === 'package.json',
    );
    expect(reviewedPackageWrite?.relativePath).toBe('package.json');
    expect(reviewedPackageWrite?.expectedSha256).toMatch(/^[a-f0-9]{64}$/u);

    await applyReactMigrationSlice({ target, reviewToken: review.token });
    const targetPackageAfter = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as unknown as {
      dependencies?: Record<string, string>;
    };
    expect(targetPackageAfter.dependencies?.['fabric']).toBe('^6.7.0');
    expect(targetPackageAfter.dependencies).toMatchObject(targetPackageBefore.dependencies ?? {});
  }, 120_000);

  it('rolls back package.json and lockfiles when a reviewed dependency slice fails its gates', async () => {
    const source = await reactFixture();
    const sourcePackagePath = join(source, 'package.json');
    const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    sourcePackage.dependencies['fabric'] = '^6.7.0';
    await writeFile(sourcePackagePath, `${JSON.stringify(sourcePackage, null, 2)}\n`);
    await writeFile(
      join(source, 'src/FabricClient.ts'),
      "import { Canvas } from 'fabric'; export const sourceCanvas = Canvas;\n",
    );
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-package-rollback-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-package-rollback');
    const session = await startReactMigration({ source, target });
    const sourcePath = 'src/FabricClient.ts';
    const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath)!;
    const planned = plannedSlice(session, sourcePath);
    const packageBefore = await readFile(join(target, 'package.json'), 'utf8');
    const lockBefore = await readFile(join(target, 'pnpm-lock.yaml'), 'utf8');
    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [
          {
            relativePath: owner.canonicalTargetPaths[0]!,
            content: 'export const nativeCanvas: = ;\n',
          },
        ],
        sourcePackageDependencies: [{ name: 'fabric', version: '^6.7.0', scope: 'dependency' }],
        mappings: [nativeMapping(session, sourcePath, owner.canonicalTargetPaths)],
      },
    });

    await expect(applyReactMigrationSlice({ target, reviewToken: review.token })).rejects.toThrow(
      /fails its declared typecheck gate/u,
    );
    expect(await readFile(join(target, 'package.json'), 'utf8')).toBe(packageBefore);
    expect(await readFile(join(target, 'pnpm-lock.yaml'), 'utf8')).toBe(lockBefore);
  }, 120_000);

  it('rejects arbitrary, unsafe, wrapper, mismatched, or unused package dependency operations', async () => {
    const source = await reactFixture();
    const sourcePackagePath = join(source, 'package.json');
    const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    sourcePackage.dependencies['fabric'] = '^6.7.0';
    sourcePackage.dependencies['zustand'] = '^5.0.0';
    sourcePackage.dependencies['unused-safe'] = '^1.0.0';
    sourcePackage.dependencies['unsafe-local'] = 'file:../unsafe-local';
    await writeFile(sourcePackagePath, `${JSON.stringify(sourcePackage, null, 2)}\n`);
    await writeFile(
      join(source, 'src/FabricClient.ts'),
      "import { Canvas } from 'fabric'; export const sourceCanvas = Canvas;\n",
    );
    await writeFile(
      join(source, 'src/ZustandClient.ts'),
      "import { create } from 'zustand'; export const sourceStore = create;\n",
    );
    await writeFile(
      join(source, 'src/UnsafeClient.ts'),
      "import unsafeLocal from 'unsafe-local'; export default unsafeLocal;\n",
    );
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-package-reject-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-package-reject');
    const session = await startReactMigration({ source, target });
    const fabricPlan = plannedSlice(session, 'src/FabricClient.ts');
    const fabricOwner = session.plan.ownership.find(
      (candidate) => candidate.sourcePath === 'src/FabricClient.ts',
    )!;
    const baseSlice = (dependency: { name: string; version: string; scope: 'dependency' }) => ({
      id: fabricPlan.id,
      title: fabricPlan.title,
      writes: [
        {
          relativePath: fabricOwner.canonicalTargetPaths[0]!,
          content: "export const nativeCanvas = 'fabric-ready';\n",
        },
      ],
      sourcePackageDependencies: [dependency],
      mappings: [nativeMapping(session, 'src/FabricClient.ts', fabricOwner.canonicalTargetPaths)],
    });

    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          ...baseSlice({ name: 'fabric', version: '^6.7.0', scope: 'dependency' }),
          writes: [{ relativePath: 'package.json', content: '{}\n' }],
        },
      }),
    ).rejects.toThrow(/may not author package\.json directly/u);
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: baseSlice({ name: 'fabric', version: '^9.0.0', scope: 'dependency' }),
      }),
    ).rejects.toThrow(/not an exact source inventory package dependency/u);
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          ...baseSlice({ name: 'fabric', version: '^6.7.0', scope: 'dependency' }),
          sourcePackageDependencies: [
            { name: 'fabric', version: '^6.7.0', scope: 'devDependency' },
          ],
        },
      }),
    ).rejects.toThrow(/not an exact source inventory package dependency/u);
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: baseSlice({ name: 'unused-safe', version: '^1.0.0', scope: 'dependency' }),
      }),
    ).rejects.toThrow(/not imported by a source module/u);
    const zustandPlan = plannedSlice(session, 'src/ZustandClient.ts');
    const zustandOwner = session.plan.ownership.find(
      (candidate) => candidate.sourcePath === 'src/ZustandClient.ts',
    )!;
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: zustandPlan.id,
          title: zustandPlan.title,
          writes: [
            {
              relativePath: zustandOwner.canonicalTargetPaths[0]!,
              content: "export const nativeStore = 'native';\n",
            },
          ],
          sourcePackageDependencies: [{ name: 'zustand', version: '^5.0.0', scope: 'dependency' }],
          mappings: [
            nativeMapping(session, 'src/ZustandClient.ts', zustandOwner.canonicalTargetPaths),
          ],
        },
      }),
    ).rejects.toThrow(/legacy compatibility\/adapter package/u);
    const unsafePlan = plannedSlice(session, 'src/UnsafeClient.ts');
    const unsafeOwner = session.plan.ownership.find(
      (candidate) => candidate.sourcePath === 'src/UnsafeClient.ts',
    )!;
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: unsafePlan.id,
          title: unsafePlan.title,
          writes: [
            {
              relativePath: unsafeOwner.canonicalTargetPaths[0]!,
              content: "export const nativeUnsafe = 'native';\n",
            },
          ],
          sourcePackageDependencies: [
            { name: 'unsafe-local', version: 'file:../unsafe-local', scope: 'dependency' },
          ],
          mappings: [
            nativeMapping(session, 'src/UnsafeClient.ts', unsafeOwner.canonicalTargetPaths),
          ],
        },
      }),
    ).rejects.toThrow(/unsafe local or non-registry source dependency/u);
  });

  it('can discard a staged review before replanning or correcting a native slice', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-discard-review-parent-'));
    roots.push(parent);
    const target = join(parent, 'discard-review');
    const session = await startReactMigration({ source, target });
    const sourcePath = 'public/runtime-data.json';
    const sourceFile = session.inventory.files.find((file) => file.relativePath === sourcePath)!;
    const owner = session.plan.ownership.find((candidate) => candidate.sourcePath === sourcePath)!;
    const planned = plannedSlice(session, sourcePath);
    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: planned.id,
        title: planned.title,
        writes: [],
        sourceArtifactCopies: [
          {
            sourcePath,
            relativePath: owner.canonicalTargetPaths[0]!,
            expectedSourceSha256: sourceFile.sha256,
          },
        ],
        mappings: [nativeMapping(session, sourcePath, owner.canonicalTargetPaths, 'asset')],
      },
    });

    const discarded = await discardReactMigrationSliceReview({ target, reviewToken: review.token });

    expect(discarded.reviewedSlices).toEqual([]);
    await expect(applyReactMigrationSlice({ target, reviewToken: review.token })).rejects.toThrow(
      /does not belong/u,
    );
  });

  it('safely refreshes a recognizable generated validator before replanning', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-validator-parent-'));
    roots.push(parent);
    const target = join(parent, 'validator-sync');
    const session = await startReactMigration({ source, target });
    const validatorPath = join(target, 'scripts/srijika-validate.mjs');
    await writeFile(
      validatorPath,
      '#!/usr/bin/env node\nconst validate = () => {};\n// Srijika architecture check passed\n',
    );

    const refreshed = await synchronizeReactMigrationValidator({ target });

    expect(refreshed.id).toBe(session.id);
    expect(await readFile(validatorPath, 'utf8')).toContain(
      'Types-only capabilities expose no runtime behavior',
    );
  });

  it('plans a concrete canonical path for a shared stylesheet', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/shared'), { recursive: true });
    await writeFile(join(source, 'src/shared/tailwind.css'), '@layer components {}\n');

    const inventory = await scanReactMigrationSource(source);
    const stylesheet = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/shared/tailwind.css',
    );

    expect(stylesheet).toMatchObject({
      ownerKind: 'shared-capability',
      role: 'style',
      canonicalTargetPaths: ['src/shared/capabilities/tailwind/tailwind.css'],
    });
  });

  it('treats TypeScript declaration-only files as non-runtime evidence', async () => {
    const source = await reactFixture();
    await writeFile(join(source, 'devtools.d.ts'), 'export {};\n');

    const inventory = await scanReactMigrationSource(source);
    const declaration = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'devtools.d.ts',
    );

    expect(declaration?.completionObligation).toBe('excluded-nonruntime');
  });

  it('plans an independently used top-level debugger store as a headless Shared capability', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'devtools/debugger'), { recursive: true });
    await writeFile(
      join(source, 'devtools/debugger/bus.ts'),
      "const key = '__DEBUG_BUS__'; export const bus = () => globalThis[key as keyof typeof globalThis];\n",
    );
    await writeFile(
      join(source, 'devtools/debugger/overlay.ts'),
      "import { bus } from './bus'; export const overlay = bus;\n",
    );
    await writeFile(
      join(source, 'devtools/debugger/patch.ts'),
      "import { bus } from './bus'; export const patch = bus;\n",
    );

    const inventory = await scanReactMigrationSource(source);
    const bus = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'devtools/debugger/bus.ts',
    );

    expect(bus).toMatchObject({
      ownerKind: 'shared-capability',
      ownerPath: 'src/shared/capabilities/bus',
      role: 'store',
      canonicalTargetPaths: ['src/shared/capabilities/bus/bus.store.ts'],
    });
  });

  it('classifies a null-rendering effect component as a native Shared Hook', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/plugins/tour'), { recursive: true });
    await writeFile(
      join(source, 'src/plugins/tour/TourAutoStart.tsx'),
      "import { useEffect } from 'react';\nexport function TourAutoStart(): null { useEffect(() => {}, []); return null; }\n",
    );

    const inventory = await scanReactMigrationSource(source);
    const autoStart = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/plugins/tour/TourAutoStart.tsx',
    );

    expect(autoStart).toMatchObject({
      ownerKind: 'shared-capability',
      ownerPath: 'src/shared/capabilities/tour-auto-start',
      role: 'hook',
      canonicalTargetPaths: ['src/shared/capabilities/tour-auto-start/useTourAutoStart.ts'],
    });
  });

  it('keeps a primary Feature UI with its Types and extracts colliding headless peers', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/plugins/tour'), { recursive: true });
    await writeFile(
      join(source, 'src/plugins/tour/tourTypes.ts'),
      'export type TourId = string;\n',
    );
    await writeFile(
      join(source, 'src/plugins/tour/TourAutoStart.tsx'),
      "import type { TourId } from './tourTypes'; export function TourAutoStart(): JSX.Element { const id: TourId = 'start'; return <p>{id}</p>; }\n",
    );
    await writeFile(
      join(source, 'src/plugins/tour/TourOverlay.tsx'),
      'export function TourOverlay(): JSX.Element { return <aside>Overlay</aside>; }\n',
    );
    await writeFile(
      join(source, 'src/plugins/tour/TourContext.ts'),
      'export const tourState = new Map();\n',
    );
    await mkdir(join(source, 'src/plugins/tour/store'), { recursive: true });
    await writeFile(
      join(source, 'src/plugins/tour/store/tourState.ts'),
      'export const tourState = new Map();\n',
    );

    const inventory = await scanReactMigrationSource(source);
    const primaryUi = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/plugins/tour/TourAutoStart.tsx',
    );
    const types = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/plugins/tour/tourTypes.ts',
    );
    const store = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/plugins/tour/TourContext.ts',
    );
    const plan = planReactMigration(inventory, join(tmpdir(), 'srijika-react-tour-plan'));
    const featureSlice = plan.slices.find((slice) =>
      slice.sourcePaths.includes('src/plugins/tour/TourAutoStart.tsx'),
    );

    expect(primaryUi).toMatchObject({
      ownerKind: 'feature',
      ownerPath: 'src/features/tour',
      canonicalTargetPaths: [
        'src/features/tour/Tour.ui.tsx',
        'src/features/tour/Tour.connector.tsx',
      ],
    });
    expect(types).toMatchObject({ ownerKind: 'feature', ownerPath: 'src/features/tour' });
    expect(store).toMatchObject({
      ownerKind: 'shared-capability',
      ownerPath: 'src/shared/capabilities/tour-context',
    });
    expect(featureSlice?.sourcePaths).toContain('src/plugins/tour/tourTypes.ts');
  });

  it('keeps a legacy module facade feature-local even when multiple features import it', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/modules/auth'), { recursive: true });
    await mkdir(join(source, 'src/modules/first'), { recursive: true });
    await mkdir(join(source, 'src/modules/second'), { recursive: true });
    await writeFile(join(source, 'src/modules/auth/module.ts'), 'export const authModule = {};\n');
    await writeFile(
      join(source, 'src/modules/first/First.tsx'),
      "import { authModule } from '../auth/module'; export function First() { return <p>{String(authModule)}</p>; }\n",
    );
    await writeFile(
      join(source, 'src/modules/second/Second.tsx'),
      "import { authModule } from '../auth/module'; export function Second() { return <p>{String(authModule)}</p>; }\n",
    );

    const inventory = await scanReactMigrationSource(source);
    const facade = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/modules/auth/module.ts',
    );

    expect(facade).toMatchObject({
      ownerKind: 'feature',
      ownerPath: 'src/features/auth',
    });
  });

  it('expands legacy import facades into their real owner prerequisites', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/modules/provider'), { recursive: true });
    await mkdir(join(source, 'src/modules/consumer'), { recursive: true });
    await writeFile(
      join(source, 'src/modules/provider/module.ts'),
      'export const provider = { label: "native prerequisite" };\n',
    );
    await writeFile(
      join(source, 'src/modules/consumer/imports.ts'),
      "export { provider } from '../provider/module';\n",
    );
    await writeFile(
      join(source, 'src/modules/consumer/Consumer.tsx'),
      "import { provider } from './imports'; export function Consumer() { return <p>{provider.label}</p>; }\n",
    );

    const inventory = await scanReactMigrationSource(source);
    const plan = planReactMigration(inventory, join(tmpdir(), 'srijika-react-facade-plan'));
    const consumerSlice = plan.slices.find((slice) =>
      slice.sourcePaths.includes('src/modules/consumer/Consumer.tsx'),
    );

    expect(consumerSlice?.dependencyOwnerIds).toContain('feature:src/features/provider');
    expect(consumerSlice?.dependencyOwnerIds).not.toContain(
      'shared-capability:src/shared/capabilities/imports',
    );
  });

  it('plans a calculated cross-owner component as a Shared Widget with a Connector', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/modules/charts'), { recursive: true });
    await mkdir(join(source, 'src/modules/first'), { recursive: true });
    await mkdir(join(source, 'src/modules/second'), { recursive: true });
    await writeFile(
      join(source, 'src/modules/charts/HeadingChart.tsx'),
      'export function HeadingChart(props: { values: number[] }) { const max = Math.max(1, ...props.values); return <output>{max}</output>; }\n',
    );
    await writeFile(
      join(source, 'src/modules/first/First.tsx'),
      "import { HeadingChart } from '../charts/HeadingChart'; export function First() { return <HeadingChart values={[1]} />; }\n",
    );
    await writeFile(
      join(source, 'src/modules/second/Second.tsx'),
      "import { HeadingChart } from '../charts/HeadingChart'; export function Second() { return <HeadingChart values={[2]} />; }\n",
    );

    const inventory = await scanReactMigrationSource(source);
    const chart = inventory.ownership.find(
      (candidate) => candidate.sourcePath === 'src/modules/charts/HeadingChart.tsx',
    );

    expect(chart).toMatchObject({
      ownerKind: 'shared-widget',
      ownerPath: 'src/shared/widgets/charts',
      canonicalTargetPaths: [
        'src/shared/widgets/charts/Charts.ui.tsx',
        'src/shared/widgets/charts/Charts.connector.tsx',
      ],
    });
  });

  it('does not batch independent shared owners into a false atomic cycle', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/shared'), { recursive: true });
    await writeFile(join(source, 'src/shared/alpha.ts'), 'export const alpha = 1;\n');
    await writeFile(join(source, 'src/shared/beta.ts'), 'export const beta = 2;\n');

    const inventory = await scanReactMigrationSource(source);
    const plan = planReactMigration(inventory, join(tmpdir(), 'srijika-react-plan'));
    const alphaSlice = plan.slices.find((slice) =>
      slice.sourcePaths.includes('src/shared/alpha.ts'),
    );
    const betaSlice = plan.slices.find((slice) => slice.sourcePaths.includes('src/shared/beta.ts'));

    expect(alphaSlice?.sourcePaths).toEqual(['src/shared/alpha.ts']);
    expect(betaSlice?.sourcePaths).toEqual(['src/shared/beta.ts']);
    expect(alphaSlice?.cycleOwnerIds).toEqual([]);
    expect(betaSlice?.cycleOwnerIds).toEqual([]);
  });

  it('batches a Feature with its structural Slot so the reviewed target is valid', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/modules/home/components'), { recursive: true });
    await mkdir(join(source, 'src/modules/home/controllers'), { recursive: true });
    await writeFile(
      join(source, 'src/modules/home/Home.tsx'),
      'export function Home() { return <main>Home</main>; }\n',
    );
    await writeFile(
      join(source, 'src/modules/home/components/Header.tsx'),
      'export function Header() { return <header>Header</header>; }\n',
    );
    await writeFile(
      join(source, 'src/modules/home/controllers/home.controller.ts'),
      'export const homeController = { load: () => true };\n',
    );
    await writeFile(
      join(source, 'src/modules/home/home.logic.ts'),
      'export const homeLogic = true;\n',
    );

    const inventory = await scanReactMigrationSource(source);
    const plan = planReactMigration(inventory, join(tmpdir(), 'srijika-react-structural-plan'));
    const homeSlice = plan.slices.find((candidate) =>
      candidate.sourcePaths.includes('src/modules/home/Home.tsx'),
    );

    expect(homeSlice?.sourcePaths).toContain('src/modules/home/components/Header.tsx');
    expect(
      inventory.ownership.find(
        (candidate) => candidate.sourcePath === 'src/modules/home/controllers/home.controller.ts',
      ),
    ).toMatchObject({
      ownerKind: 'feature',
      ownerPath: 'src/features/home',
      role: 'logic',
    });
    expect(homeSlice?.cycleOwnerIds.length).toBeGreaterThan(1);
  });

  it('migrates a reviewed widget into a new project, preserves source, and finalizes only with evidence', async () => {
    const source = await reactFixture();
    await writeFile(
      join(source, 'index.html'),
      `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="description" content="A code-first React experience created with Srijika Studio." /><meta name="theme-color" content="#070b17" /><title>converted-widget</title></head><body><div id="root"><button style="position:fixed;inset:0;border:0;margin:0;background:white;color:black;font:16px sans-serif">Migrated</button></div><script type="module">/* parity fixture runtime */</script></body></html>\n`,
    );
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-target-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted-widget');
    const sourceBefore = await readFile(join(source, 'src/Widget.jsx'), 'utf8');

    const started = await startReactMigration({ source, target });
    expect(started.phase).toBe('scaffolded');
    await expect(startReactMigration({ source, target })).resolves.toMatchObject({
      id: started.id,
    });

    const targetUi = 'src/features/widget/Widget.ui.tsx';
    const targetTypes = 'src/features/widget/widget.types.ts';
    const targetConnector = 'src/features/widget/Widget.connector.tsx';
    const targetStyle = 'src/features/widget/widget.css';
    const starterHomePaths = [
      'src/features/home/Home.connector.tsx',
      'src/features/home/Home.ui.tsx',
      'src/features/home/home.store.ts',
      'src/features/home/useHome.ts',
      'src/features/home/slots/navigation/Navigation.connector.tsx',
      'src/features/home/slots/navigation/Navigation.ui.tsx',
    ];
    const appPath = join(target, 'src/App.tsx');
    const appBefore = await readFile(appPath);
    const configPath = join(target, 'srijika.config.json');
    const configBefore = await readFile(configPath);
    const config = JSON.parse(configBefore.toString('utf8')) as Record<string, unknown>;
    config['entry'] = targetUi;
    const uiPlan = plannedSlice(started, 'src/Widget.jsx');
    await reviewAndApply(target, {
      id: uiPlan.id,
      title: uiPlan.title,
      writes: [
        {
          relativePath: targetTypes,
          content: 'export interface WidgetUIProps { label: string; className?: string }\n',
        },
        {
          relativePath: targetUi,
          content:
            "import type { WidgetUIProps } from './widget.types';\nexport function WidgetUI(props: WidgetUIProps) {\n  return <button className={props.className} style={{ position: 'fixed', inset: 0, border: 0, margin: 0, background: 'white', color: 'black', font: '16px sans-serif' }}>{props.label}</button>;\n}\n",
        },
        {
          relativePath: targetConnector,
          content:
            'import { WidgetUI } from \'./Widget.ui\';\nexport function WidgetConnector() { return <WidgetUI label="Migrated" />; }\n',
        },
        { relativePath: targetStyle, content: '.widget { color: rebeccapurple; }\n' },
        {
          relativePath: 'src/App.tsx',
          expectedSha256: fileHash(appBefore),
          content:
            "import { WidgetConnector } from './features/widget/Widget.connector';\nexport function App() { return <WidgetConnector />; }\n",
        },
        {
          relativePath: 'srijika.config.json',
          expectedSha256: fileHash(configBefore),
          content: `${JSON.stringify(config, null, 2)}\n`,
        },
      ],
      deletes: await Promise.all(
        starterHomePaths.map(async (relativePath) => ({
          relativePath,
          expectedSha256: fileHash(await readFile(join(target, relativePath))),
        })),
      ),
      mappings: [
        nativeMapping(started, 'src/Widget.jsx', [targetUi, targetTypes, targetConnector]),
        nativeMapping(started, 'src/widget.css', [targetStyle], 'style'),
      ],
    });
    await expect(verifyReactMigrationSlice(target, uiPlan.id)).rejects.toThrow(
      /requires passed typecheck evidence/u,
    );
    await verifyReactMigrationSlice(target, uiPlan.id, await sliceEvidence(target));
    const projectPlan = plannedSlice(started, 'public/runtime-data.json');
    await reviewAndApply(target, {
      id: projectPlan.id,
      title: projectPlan.title,
      writes: [{ relativePath: 'public/runtime-data.json', content: '{"floor":1}\n' }],
      mappings: [
        nativeMapping(started, 'public/runtime-data.json', ['public/runtime-data.json'], 'asset'),
      ],
    });
    const nonRuntimeReviews = [
      {
        sourcePath: 'package.json',
        reason: 'Replaced by the pinned Srijika scaffold.',
        writes: [],
      },
      {
        sourcePath: 'index.html',
        reason: 'Replaced by the pinned Srijika app shell.',
        writes: [],
      },
      {
        sourcePath: '.env.example',
        reason: 'Keys were reviewed; values are supplied by deployment.',
        writes: [
          {
            relativePath: '.env.example',
            content: 'SECRET_VALUE=\nVITE_API_URL=\nVITE_PUBLIC_TOKEN=\n',
          },
        ],
      },
    ] as const;
    for (const review of nonRuntimeReviews) {
      const metadataPlan = plannedSlice(started, review.sourcePath);
      await reviewAndApply(target, {
        id: metadataPlan.id,
        title: metadataPlan.title,
        writes: review.writes,
        mappings: [],
        ignoredSources: [{ sourcePath: review.sourcePath, reason: review.reason }],
      });
      await verifyReactMigrationSlice(target, metadataPlan.id, await sliceEvidence(target));
    }
    await verifyReactMigrationSlice(target, projectPlan.id, await sliceEvidence(target));
    expect(
      (await getReactMigrationStatus(target)).appliedSlices.every((slice) => slice.verified),
    ).toBe(true);

    const verified = await verifyReactMigration({
      target,
      commands: await evidence(target, [
        { name: 'typecheck', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'test', status: 'passed', details: 'Migration verification suite passed.' },
      ]),
    });
    expect(verified.verification?.errors).toContain(
      'Visual parity evidence with at least two reviewed viewport details is required.',
    );
    await expect(
      verifyReactMigration({
        target,
        commands: await evidence(target, [
          { name: 'typecheck', status: 'passed' },
          { name: 'typecheck', status: 'passed' },
        ]),
      }),
    ).rejects.toThrow(/Duplicate migration verification evidence/u);

    const callerAttested = await verifyReactMigration({
      target,
      commands: await evidence(target, [
        { name: 'typecheck', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'test', status: 'passed', details: 'Migration verification suite passed.' },
        {
          name: 'visual',
          status: 'passed',
          details: 'Reviewed source and target widget captures match on mobile and desktop.',
        },
      ]),
    });
    expect(callerAttested.verification?.errors).toContain(
      'Visual parity evidence with at least two reviewed viewport details is required.',
    );
    await captureReactMigrationBrowserParity({ target, includeInstall: true });
    const browserVerified = await verifyReactMigration({
      target,
      commands: await evidence(target, [
        { name: 'typecheck', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'test', status: 'passed', details: 'Migration verification suite passed.' },
      ]),
    });
    expect(
      browserVerified.verification,
      JSON.stringify(browserVerified.verification?.errors),
    ).toMatchObject({
      passed: true,
      sourceUnchanged: true,
      srijikaDiagnosticsValid: true,
    });
    const commands = browserVerified.verification?.commands;
    if (!commands) throw new Error('Expected migration verification command evidence.');
    await expect(finalizeReactMigration({ target, commands })).resolves.toMatchObject({
      phase: 'complete',
    });
    expect(await readFile(join(source, 'src/Widget.jsx'), 'utf8')).toBe(sourceBefore);
    await expect(getReactMigrationStatus(target)).resolves.toMatchObject({ phase: 'complete' });
  }, 240_000);

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

  it('rejects superficial and zero-test verification scripts', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-zero-test-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    await startReactMigration({ source, target });
    const packagePath = join(target, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    packageJson.scripts['test'] = 'node --test';
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const [zeroTestGate] = await runReactMigrationVerificationGates({
      target,
      names: ['test'],
    });
    expect(zeroTestGate).toMatchObject({ name: 'test', status: 'failed' });
    expect(zeroTestGate?.details).toMatch(/no passing test/u);
    packageJson.scripts['test'] = 'node -e "process.exit(0)"';
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const [noOpGate] = await runReactMigrationVerificationGates({
      target,
      names: ['test'],
    });
    expect(noOpGate).toMatchObject({ name: 'test', status: 'failed' });
    expect(noOpGate?.details).toMatch(/noncanonical|no-op/u);
  });

  it('rejects unreviewed slices, missing mapped targets, unsafe writes, and nonempty targets', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-adversarial-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    const uiPlan = plannedSlice(started, 'src/Widget.jsx');
    const widgetOwner = started.plan.ownership.find(
      (decision) => decision.sourcePath === 'src/Widget.jsx',
    )!;
    await expect(
      reviewReactMigrationOwnership({
        target,
        expectedPlanId: started.plan.id,
        expectedSourceSnapshotSha256: started.inventory.snapshotSha256,
        expectedTargetSnapshotSha256: started.plan.targetBaselineSha256,
        overrides: [
          {
            sourcePath: 'src/Widget.jsx',
            ownerKind: 'project',
            ownerName: 'project',
            ownerPath: '.',
            role: 'test',
            rationale: 'Attempt to relabel runtime UI as project test evidence.',
          },
        ],
      }),
    ).rejects.toThrow(/cannot change semantic role|runtime ownership boundary/u);
    await expect(
      reviewReactMigrationOwnership({
        target,
        expectedPlanId: started.plan.id,
        expectedSourceSnapshotSha256: started.inventory.snapshotSha256,
        expectedTargetSnapshotSha256: started.plan.targetBaselineSha256,
        overrides: [
          {
            sourcePath: 'src/Widget.jsx',
            ownerKind: 'shared-ui',
            ownerName: 'widget',
            ownerPath: 'src/shared/ui/widget',
            role: widgetOwner.role,
            rationale: 'Attempt to promote runtime UI without multi-feature consumer proof.',
          },
        ],
      }),
    ).rejects.toThrow(/engine-proven multi-feature consumers/u);

    await expect(
      reviewReactMigrationSlice({
        target,
        slice: { id: 'surprise', title: 'Unreviewed slice', writes: [], mappings: [] },
      }),
    ).rejects.toThrow(/not present in the reviewed plan/u);
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: { id: uiPlan.id, title: 'Changed after review', writes: [], mappings: [] },
      }),
    ).rejects.toThrow(/title must match the reviewed plan/u);
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: uiPlan.id,
          title: uiPlan.title,
          writes: [],
          mappings: [
            nativeMapping(await getReactMigrationStatus(target), 'src/Widget.jsx', [
              'src/features/widget/Missing.ui.tsx',
            ]),
          ],
        },
      }),
    ).rejects.toThrow(/does not exist and is not written/u);
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: uiPlan.id,
          title: uiPlan.title,
          writes: [{ relativePath: '../escape.ts', content: 'export {}\n' }],
          mappings: [],
        },
      }),
    ).rejects.toThrow(/project-relative/u);

    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: uiPlan.id,
          title: uiPlan.title,
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
    ).rejects.toThrow(/account for every planned source/u);
    await expect(
      readFile(join(target, 'src/shared/ui/broken/Broken.ui.tsx'), 'utf8'),
    ).rejects.toThrow();

    const outside = await mkdtemp(join(tmpdir(), 'srijika-react-symlink-outside-'));
    roots.push(outside);
    await mkdir(join(target, 'src/shared/ui'), { recursive: true });
    await symlink(outside, join(target, 'src/shared/ui/linked'), 'dir');
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: uiPlan.id,
          title: uiPlan.title,
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

  it('rejects zero-write compatibility bookkeeping against a preexisting starter target', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-tracked-mapping-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    const targetUi = 'src/features/home/Home.ui.tsx';
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: plannedSlice(started, 'src/Widget.jsx').id,
          title: plannedSlice(started, 'src/Widget.jsx').title,
          writes: [],
          mappings: [
            {
              ...nativeMapping(started, 'src/Widget.jsx', [targetUi]),
              kind: 'compatibility',
              mode: 'compatibility',
              legacyAdapter: 'zustand',
            },
          ],
        },
      }),
    ).rejects.toThrow(/legacy-adapter approval|Zero-write|planning-only/u);
  });

  it('binds reviewed payloads to the target snapshot and rejects runtime ignores', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-review-token-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    const uiPlan = plannedSlice(started, 'src/Widget.jsx');
    await expect(
      reviewReactMigrationSlice({
        target,
        slice: {
          id: uiPlan.id,
          title: uiPlan.title,
          writes: [],
          mappings: [],
          ignoredSources: [{ sourcePath: 'src/Widget.jsx', reason: 'Skip runtime widget.' }],
        },
      }),
    ).rejects.toThrow(/runtime-bearing/u);

    const targetLogic = 'src/features/widget/Widget.ui.tsx';
    const targetConnector = 'src/features/widget/Widget.connector.tsx';
    const targetStyle = 'src/features/widget/widget.css';
    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: uiPlan.id,
        title: uiPlan.title,
        writes: [
          {
            relativePath: targetLogic,
            content: 'export function WidgetUI() { return <p>native</p>; }\n',
          },
          {
            relativePath: targetConnector,
            content:
              "import { WidgetUI } from './Widget.ui'; export function WidgetConnector() { return <WidgetUI />; }\n",
          },
          { relativePath: targetStyle, content: '.widget { color: rebeccapurple; }\n' },
        ],
        mappings: [
          nativeMapping(started, 'src/Widget.jsx', [targetLogic, targetConnector]),
          nativeMapping(started, 'src/widget.css', [targetStyle], 'style'),
        ],
        deletes: uiPlan.requiredStarterCleanup,
      },
    });
    await writeFile(join(target, 'README.md'), '# changed after review\n');
    await expect(applyReactMigrationSlice({ target, reviewToken: review.token })).rejects.toThrow(
      /target changed after/u,
    );
  });

  it('rolls back reviewed writes when the staged slice fails architecture validation', async () => {
    const source = await reactFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-staged-architecture-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    const uiPlan = plannedSlice(started, 'src/Widget.jsx');
    const targetUi = 'src/features/widget/Widget.ui.tsx';
    const targetConnector = 'src/features/widget/Widget.connector.tsx';
    const targetStyle = 'src/features/widget/widget.css';
    const review = await reviewReactMigrationSlice({
      target,
      slice: {
        id: uiPlan.id,
        title: uiPlan.title,
        writes: [
          {
            relativePath: targetUi,
            content: 'export function WidgetUI() { return <p>native</p>; }\n',
          },
          {
            relativePath: targetConnector,
            content:
              "import { missing } from './Widget.api'; import { WidgetUI } from './Widget.ui'; export function WidgetConnector() { void missing; return <WidgetUI />; }\n",
          },
          { relativePath: targetStyle, content: '.widget { color: rebeccapurple; }\n' },
        ],
        mappings: [
          nativeMapping(started, 'src/Widget.jsx', [targetUi, targetConnector]),
          nativeMapping(started, 'src/widget.css', [targetStyle], 'style'),
        ],
        deletes: uiPlan.requiredStarterCleanup,
      },
    });
    await expect(applyReactMigrationSlice({ target, reviewToken: review.token })).rejects.toThrow(
      /architecture errors/u,
    );
    await expect(readFile(join(target, targetUi), 'utf8')).rejects.toThrow();
    await expect(readFile(join(target, targetConnector), 'utf8')).rejects.toThrow();
    const status = await getReactMigrationStatus(target);
    expect(status.appliedSlices.some((slice) => slice.id === uiPlan.id)).toBe(false);
  });

  it('plans browser-persisted shared preferences as a Store instead of pure Logic', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src', 'shared'), { recursive: true });
    await writeFile(
      join(source, 'src', 'shared', 'floatingUiPrefs.ts'),
      "export const loadPref = () => window.localStorage.getItem('pref'); export const notify = () => window.dispatchEvent(new CustomEvent('pref'));\n",
    );
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-preference-role-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    const preference = started.plan.ownership.find(
      (decision) => decision.sourcePath === 'src/shared/floatingUiPrefs.ts',
    );
    expect(preference).toMatchObject({
      role: 'store',
      canonicalTargetPaths: ['src/shared/capabilities/floating-ui-prefs/floatingUiPrefs.store.ts'],
    });
  });

  it('plans a browser-persisted service as a Store instead of an API', async () => {
    const source = await reactFixture();
    await mkdir(join(source, 'src/modules/preferences/services'), { recursive: true });
    await writeFile(
      join(source, 'src/modules/preferences/services/lastPreference.service.ts'),
      "export const load = () => window.localStorage.getItem('preference');\n",
    );

    const inventory = await scanReactMigrationSource(source);
    const preference = inventory.ownership.find(
      (candidate) =>
        candidate.sourcePath === 'src/modules/preferences/services/lastPreference.service.ts',
    );

    expect(preference).toMatchObject({
      role: 'store',
      canonicalTargetPaths: [
        'src/shared/capabilities/last-preference-service/lastPreferenceService.store.ts',
      ],
    });
  });

  it('keeps approved compatibility adapters as planning hints and rejects applying them', async () => {
    const source = await reactFixture();
    const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    packageJson.dependencies['zustand'] = '^5.0.0';
    await writeFile(join(source, 'package.json'), JSON.stringify(packageJson));
    await writeFile(
      join(source, 'src/Widget.jsx'),
      "import { create } from 'zustand'; const useWidget = create(() => ({ ready: true })); export function Widget() { return <p>{String(useWidget.getState().ready)}</p>; }\n",
    );
    const parent = await mkdtemp(join(tmpdir(), 'srijika-react-compat-parent-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const started = await startReactMigration({ source, target });
    const plan = plannedSlice(started, 'src/Widget.jsx');
    const owner = started.plan.ownership.find(
      (candidate) => candidate.sourcePath === 'src/Widget.jsx',
    )!;
    const ui = 'src/features/widget/Widget.ui.tsx';
    const connector = 'src/features/widget/Widget.connector.tsx';
    await expect(
      reviewAndApply(target, {
        id: plan.id,
        title: plan.title,
        writes: [
          { relativePath: ui, content: 'export function WidgetUI() { return <p>ready</p>; }\n' },
          {
            relativePath: connector,
            content:
              "import { WidgetUI } from './Widget.ui'; export function WidgetConnector() { return <WidgetUI />; }\n",
          },
        ],
        mappings: [
          {
            sourcePath: 'src/Widget.jsx',
            targetPaths: [ui, connector],
            kind: 'compatibility',
            mode: 'compatibility',
            ownerId: owner.ownerId,
            role: owner.role,
            rationale: 'Reviewed bounded Zustand bridge pending native Store conversion.',
            legacyAdapter: 'zustand',
          },
        ],
      }),
    ).rejects.toThrow(/planning-only/u);
  });

  it('requires route parity evidence when the source has route files', async () => {
    const source = await reactFixture();
    await writeFile(
      join(source, 'src/semantic-navigation.jsx'),
      "export const routes = [{ path: '/', element: <p>home</p> }];\n",
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
