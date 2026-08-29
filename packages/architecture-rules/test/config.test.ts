import { describe, expect, it } from 'vitest';

import {
  parseSrijikaProjectArchitectureConfig,
  parseSrijikaProjectConfig,
  parseSrijikaTypeScriptPathAliases,
  resolveSrijikaArchitectureConfig,
} from '../src';

describe('Srijika architecture config safety', () => {
  it('requires the complete TSX-first project contract and configured UI entry suffix', () => {
    expect(
      parseSrijikaProjectConfig(
        JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' }),
      ),
    ).toMatchObject({
      sourceOfTruth: 'tsx',
      entry: 'src/features/home/Home.ui.tsx',
      architecture: { uiSuffix: '.ui.tsx' },
    });
    expect(() =>
      parseSrijikaProjectConfig(JSON.stringify({ entry: 'src/features/home/Home.ui.tsx' })),
    ).toThrow(/sourceOfTruth/);
    expect(() =>
      parseSrijikaProjectConfig(JSON.stringify({ sourceOfTruth: 'tsx', entry: '../Home.ui.tsx' })),
    ).toThrow(/entry/);
    expect(() =>
      parseSrijikaProjectConfig(JSON.stringify({ sourceOfTruth: 'tsx', entry: 'C:Home.ui.tsx' })),
    ).toThrow(/entry/);
    expect(() =>
      parseSrijikaProjectConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture: { profile: 'feature-slot-part-v1', uiSuffix: '.view.tsx' },
        }),
      ),
    ).toThrow(/\.view\.tsx/);
  });

  it('resolves a bounded versioned brownfield ownership contract', () => {
    expect(
      parseSrijikaProjectConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/auth/Auth.ui.tsx',
          adoption: {
            ownership: {
              version: 1,
              profile: 'brownfield-ownership-v1',
              managedRoots: ['src/features'],
              include: ['src/features'],
              exclude: [
                { path: 'src/features/catalog/server', category: 'server' },
                { path: 'src/features/catalog/tests', category: 'test' },
              ],
              adoptedOwners: ['src/features/auth'],
              directories: {
                ui: ['presentation'],
                connectors: ['connectors'],
                hooks: ['hooks'],
              },
            },
          },
        }),
      ).adoption,
    ).toEqual({
      version: 1,
      profile: 'brownfield-ownership-v1',
      managedRoots: ['src/features'],
      include: ['src/features'],
      exclude: [
        { path: 'src/features/catalog/server', category: 'server' },
        { path: 'src/features/catalog/tests', category: 'test' },
      ],
      adoptedOwners: ['src/features/auth'],
      directories: {
        ui: ['presentation'],
        connectors: ['connectors'],
        hooks: ['hooks'],
      },
    });
  });

  it('rejects traversal, unknown profiles, and exclusions that overlap adopted owners', () => {
    const source = (ownership: Record<string, unknown>) =>
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/auth/Auth.ui.tsx',
        adoption: { ownership },
      });
    const base = {
      version: 1,
      profile: 'brownfield-ownership-v1',
      managedRoots: ['src/features'],
      include: ['src/features'],
      adoptedOwners: ['src/features/auth'],
    };
    expect(() => parseSrijikaProjectConfig(source({ ...base, profile: 'brownfield-v2' }))).toThrow(
      /brownfield-ownership-v1/,
    );
    expect(() => parseSrijikaProjectConfig(source({ ...base, include: ['../outside'] }))).toThrow(
      /project-relative|traversal/,
    );
    expect(() =>
      parseSrijikaProjectConfig(
        source({
          ...base,
          exclude: [{ path: 'src/features/auth/server', category: 'server' }],
        }),
      ),
    ).toThrow(/cannot exclude files inside an adopted owner/);
    expect(() =>
      parseSrijikaProjectConfig(
        source({
          ...base,
          adoptedOwners: ['src/features/outside'],
          include: ['src/features/auth'],
        }),
      ),
    ).toThrow(/adoption\.ownership\.include/);
    expect(() => parseSrijikaProjectConfig(source({ ...base, mode: 'loose' }))).toThrow(
      /mode is not supported/,
    );
    expect(() =>
      parseSrijikaProjectConfig(source({ ...base, managedRoots: ['src', 'src/features'] })),
    ).toThrow(/managedRoots must not overlap/);
    expect(() =>
      parseSrijikaProjectConfig(
        source({
          ...base,
          exclude: [
            { path: 'src/features/catalog', category: 'domain' },
            { path: 'src/features/catalog/server', category: 'server' },
          ],
        }),
      ),
    ).toThrow(/exclude paths must not overlap/);
  });

  it('parses deterministic JSONC TypeScript path aliases inside the project', () => {
    expect(
      parseSrijikaTypeScriptPathAliases(`{
        // project aliases
        "compilerOptions": {
          "paths": { "@app/*": ["src/*"], "#home": ["src/features/home/index.ts"] }
        }
      }`),
    ).toEqual({ '@app/': 'src', '#home': 'src/features/home/index.ts' });
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ compilerOptions: { paths: { '@escape/*': ['../outside/*'] } } }),
      ),
    ).toThrow(/outside the project|traverse/);
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({
          compilerOptions: { baseUrl: 'C:project', paths: { '@app/*': ['src/*'] } },
        }),
      ),
    ).toThrow(/inside the project/);
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ compilerOptions: { paths: { '@drive/*': ['D:src/*'] } } }),
      ),
    ).toThrow(/inside the project/);
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ compilerOptions: { paths: { '@feature*': ['src/features/*'] } } }),
      ),
    ).toThrow(/slash-delimited/);
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ compilerOptions: { paths: { '@feature/': ['src/features/index.ts'] } } }),
      ),
    ).toThrow(/slash-delimited/);
    expect(
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
        }),
      ),
    ).toEqual({ '@app/': 'src' });
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: {} }),
      ),
    ).toThrow(/extends is not supported/);
    expect(
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({
          references: [],
          compilerOptions: { paths: { '#home': ['src/home.ts'] } },
        }),
      ),
    ).toEqual({ '#home': 'src/home.ts' });
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ references: [{ path: './packages/runtime' }], compilerOptions: {} }),
      ),
    ).toThrow(/project references are not supported/);
    expect(() =>
      parseSrijikaTypeScriptPathAliases(
        JSON.stringify({ references: { path: './packages/runtime' }, compilerOptions: {} }),
      ),
    ).toThrow(/references must be an array/);
  });

  it('keeps direct programmatic defaults while project JSON requires an explicit profile', () => {
    expect(resolveSrijikaArchitectureConfig({})).toMatchObject({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'src/features',
      sharedRoot: 'src/shared',
    });
    expect(parseSrijikaProjectArchitectureConfig(JSON.stringify({ sourceOfTruth: 'tsx' }))).toBe(
      undefined,
    );
    expect(() =>
      parseSrijikaProjectArchitectureConfig(
        JSON.stringify({ architecture: { featuresRoot: 'app/features' } }),
      ),
    ).toThrow(/architecture\.profile is required.*feature-slot-part-v1/);
    expect(() =>
      parseSrijikaProjectArchitectureConfig(
        JSON.stringify({ architecture: { profile: 'feature-slot-part-v2' } }),
      ),
    ).toThrow(/Unsupported Srijika architecture profile.*feature-slot-part-v1/);
  });

  it('parses an exact-profile project block with bounded custom roots', () => {
    expect(
      parseSrijikaProjectArchitectureConfig(
        JSON.stringify({
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: 'application/domain/features',
            sharedRoot: 'application/domain/shared',
          },
        }),
      ),
    ).toMatchObject({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'application/domain/features',
      sharedRoot: 'application/domain/shared',
    });
  });

  it('accepts bounded custom roots and single-segment owner directories', () => {
    expect(
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        featuresRoot: 'app/modules',
        sharedRoot: 'app/common',
        slotsDirectory: 'regions',
        partsDirectory: 'pieces',
      }),
    ).toMatchObject({
      featuresRoot: 'app/modules',
      sharedRoot: 'app/common',
      slotsDirectory: 'regions',
      partsDirectory: 'pieces',
    });
  });

  it.each([
    '../outside',
    './src/features',
    '/src/features',
    'src/features/',
    'src//features',
    'src\\features',
    'C:/features',
    'a/b/c/d/e/f/g/h/i/j/k',
  ])('rejects unsafe or over-deep roots: %s', (featuresRoot) => {
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        featuresRoot,
      }),
    ).toThrow(/featuresRoot/);
  });

  it.each([
    ['src', 'src/shared'],
    ['src/features', 'src/features'],
    ['src/Owners', 'src/owners'],
    ['app/modules/private', 'app/modules'],
  ])('rejects overlapping ownership roots: %s and %s', (featuresRoot, sharedRoot) => {
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        featuresRoot,
        sharedRoot,
      }),
    ).toThrow(/non-overlapping/);
  });

  it('rejects nested directory names that could escape an owner', () => {
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        slotsDirectory: '../slots',
      }),
    ).toThrow(/slotsDirectory/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        hooksDirectory: 'runtime/hooks',
      }),
    ).toThrow(/hooksDirectory/);
  });

  it('accepts safe custom suffixes and rejects path-like or colliding suffixes', () => {
    expect(
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        uiSuffix: '.view.tsx',
        connectorSuffix: '.gateway.tsx',
        storeSuffix: '.state.ts',
        logicSuffix: '.rules.ts',
        apiSuffix: '.transport.ts',
        typesSuffix: '.contract.ts',
      }),
    ).toMatchObject({
      uiSuffix: '.view.tsx',
      connectorSuffix: '.gateway.tsx',
      storeSuffix: '.state.ts',
      logicSuffix: '.rules.ts',
      apiSuffix: '.transport.ts',
      typesSuffix: '.contract.ts',
    });
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        uiSuffix: '../escape.tsx',
      }),
    ).toThrow(/uiSuffix/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        uiSuffix: '.ui.ts',
      }),
    ).toThrow(/uiSuffix/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        logicSuffix: '.runtime.ts',
        apiSuffix: '.runtime.ts',
      }),
    ).toThrow(/distinct/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        uiSuffix: '.view.tsx',
        connectorSuffix: '.connector.view.tsx',
      }),
    ).toThrow(/overlap by suffix/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        storeSuffix: '.state.ts',
        logicSuffix: '.cache.state.ts',
      }),
    ).toThrow(/overlap by suffix/);
  });

  it('rejects colliding directory names', () => {
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        hooksDirectory: 'runtime',
        storesDirectory: 'runtime',
      }),
    ).toThrow(/distinct/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        slotsDirectory: 'slots',
        partsDirectory: 'Slots',
      }),
    ).toThrow(/distinct/);
    expect(() =>
      resolveSrijikaArchitectureConfig({
        profile: 'feature-slot-part-v1',
        uiSuffix: '.View.tsx',
        connectorSuffix: '.view.tsx',
      }),
    ).toThrow(/distinct/);
  });
});
