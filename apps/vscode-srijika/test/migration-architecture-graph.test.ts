import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

import type {
  ReactMigrationOwnershipDecision,
  ReactMigrationSession,
  ReactMigrationSliceContextItem,
} from '@srijika/developer-engine';

import {
  buildSrijikaArchitectureGraph,
  buildSrijikaArchitectureOwnerDetail,
} from '../src/migration-architecture-graph';
import { renderSrijikaMigrationArchitectureWebview } from '../src/migration-architecture-webview';

function decision(
  sourcePath: string,
  ownerId: string,
  ownerKind: ReactMigrationOwnershipDecision['ownerKind'],
  ownerName: string,
  ownerPath: string,
  role: ReactMigrationOwnershipDecision['role'],
  dependencies: ReactMigrationOwnershipDecision['dependencies'] = [],
): ReactMigrationOwnershipDecision {
  return {
    sourcePath,
    ownerId,
    ownerKind,
    ownerName,
    ownerPath,
    role,
    canonicalTargetPaths: [`${ownerPath}/${ownerName}.${role}.tsx`],
    rationale: 'Deterministic test owner',
    dependencies,
    graphComponentId: `graph:${ownerId}`,
    routeEntrypoint: false,
    completionObligation: 'native-owner',
    approvedLegacyAdapters: [],
  };
}

function architectureSession(): ReactMigrationSession {
  const homeUi = decision(
    'src/Home.tsx',
    'feature:home',
    'feature',
    'home',
    'src/features/home',
    'ui',
    [
      {
        specifier: './navigation',
        kind: 'source',
        resolvedSourcePath: 'src/Navigation.tsx',
      },
      {
        specifier: '@shared/button',
        kind: 'source',
        resolvedSourcePath: 'src/Button.tsx',
      },
    ],
  );
  const navigation = decision(
    'src/Navigation.tsx',
    'slot:navigation',
    'slot',
    'navigation',
    'src/features/home/slots/navigation',
    'ui',
    [{ specifier: './missing', kind: 'unresolved-source' }],
  );
  const button = decision(
    'src/Button.tsx',
    'shared-ui:button',
    'shared-ui',
    'button',
    'src/shared/ui/button',
    'ui',
  );
  const ownership = [homeUi, navigation, button];
  return {
    version: 2,
    id: 'architecture-session',
    sourceRoot: '/workspace/legacy',
    targetRoot: '/workspace/srijika',
    phase: 'blocked',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    inventory: {
      sourceRoot: '/workspace/legacy',
      packageName: 'legacy-app',
      framework: 'vite',
      language: 'typescript',
      files: ownership.map(({ sourcePath }, index) => ({
        relativePath: sourcePath,
        category: 'component' as const,
        size: 100 + index,
        sha256: `hash-${index}`,
      })),
      environmentKeys: {},
      totalBytes: 303,
      snapshotSha256: 'source-snapshot',
      semanticRoutesPresent: false,
      packageDependencies: [],
      packageDependencyRecords: [],
      packageScripts: {},
      toolchain: { configPaths: [] },
      sourceAliases: {},
      ownership,
    },
    plan: {
      id: 'architecture-plan',
      sourceRoot: '/workspace/legacy',
      targetRoot: '/workspace/srijika',
      sourceSnapshotSha256: 'source-snapshot',
      targetBaselineSha256: 'target-snapshot',
      slices: [
        {
          id: 'home-slice',
          title: 'Home slice',
          sourcePaths: ownership.map(({ sourcePath }) => sourcePath),
          dependencyOwnerIds: ['slot:navigation', 'shared-ui:button'],
          cycleOwnerIds: [],
          requiredStarterCleanup: [],
          acceptance: [],
        },
      ],
      ownership,
      approvedLegacyAdapters: [],
      requiredStarterCleanup: [],
      unsupported: ['src/Navigation.tsx violates a migration capability'],
    },
    mappings: [],
    ignoredSources: [],
    appliedSlices: [],
    reviewedSlices: [],
  };
}

describe('Srijika migration architecture graph', () => {
  it('builds nested owners, source modules, import classifications, and evidence violations', () => {
    const graph = buildSrijikaArchitectureGraph(architectureSession());
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'app', kind: 'app', label: 'legacy-app' }),
        expect.objectContaining({ id: 'group:features', parentId: 'app' }),
        expect.objectContaining({ id: 'feature:home', parentId: 'group:features' }),
        expect.objectContaining({ id: 'slot:navigation', parentId: 'feature:home' }),
        expect.objectContaining({ id: 'shared-ui:button', parentId: 'group:shared' }),
        expect.objectContaining({ id: 'file:src/Home.tsx', parentId: 'feature:home' }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'file:src/Home.tsx',
          target: 'file:src/Navigation.tsx',
          kind: 'cross-owner',
        }),
        expect.objectContaining({
          source: 'file:src/Home.tsx',
          target: 'file:src/Button.tsx',
          kind: 'shared',
        }),
      ]),
    );
    expect(graph.violations.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unresolved source import'),
        expect.stringContaining('violates a migration capability'),
      ]),
    );
    expect(graph.stats).toMatchObject({ owners: 3, files: 3, imports: 2, sharedImports: 1 });
  });

  it('adds exact bounded imports and exports to an owner detail', () => {
    const session = architectureSession();
    const ownership = session.plan.ownership[0]!;
    const item: ReactMigrationSliceContextItem = {
      sourcePath: ownership.sourcePath,
      category: 'component',
      sha256: 'hash-0',
      size: 100,
      imports: ownership.dependencies,
      exports: ['Home', 'HomeProps'],
      ownership,
    };
    const detail = buildSrijikaArchitectureOwnerDetail('feature:home', session, [item], []);
    expect(detail.items[0]).toMatchObject({
      sourcePath: 'src/Home.tsx',
      exports: ['Home', 'HomeProps'],
    });
  });

  it('replaces applied source-plan modules with the exact converted UI/Connector/Hook graph', () => {
    const session = architectureSession();
    session.mappings = [
      {
        sourcePath: 'src/Home.tsx',
        targetPaths: [
          'src/features/home/Home.ui.tsx',
          'src/features/home/Home.connector.tsx',
          'src/features/home/useHome.ts',
        ],
        kind: 'migrated',
        mode: 'native',
        ownerId: 'feature:home',
        role: 'ui',
        rationale: 'Native Home owner mapping',
      },
    ];
    const graph = buildSrijikaArchitectureGraph(session, {
      sessionId: session.id,
      targetSnapshotSha256: 'converted-snapshot',
      wrapperFindings: [],
      unownedTargetPaths: [],
      graphFindings: [],
      modules: [
        {
          relativePath: 'src/features/home/Home.ui.tsx',
          ownerIds: ['feature:home'],
          roles: ['ui'],
          imports: [],
          exports: ['Home'],
        },
        {
          relativePath: 'src/features/home/Home.connector.tsx',
          ownerIds: ['feature:home'],
          roles: ['connector'],
          imports: [
            {
              specifier: './Home.ui',
              kind: 'target',
              resolvedTargetPath: 'src/features/home/Home.ui.tsx',
            },
            {
              specifier: './useHome',
              kind: 'target',
              resolvedTargetPath: 'src/features/home/useHome.ts',
            },
          ],
          exports: ['HomeConnector'],
        },
        {
          relativePath: 'src/features/home/useHome.ts',
          ownerIds: ['feature:home'],
          roles: ['hook'],
          imports: [],
          exports: ['useHome'],
        },
      ],
    });
    expect(graph.nodes).not.toContainEqual(expect.objectContaining({ id: 'file:src/Home.tsx' }));
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'target:src/features/home/Home.connector.tsx',
          role: 'connector',
          stage: 'converted-target',
          exports: ['HomeConnector'],
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'target:src/features/home/Home.connector.tsx',
          target: 'target:src/features/home/useHome.ts',
          kind: 'same-owner',
        }),
      ]),
    );
  });

  it('renders a CSP-safe interactive graph shell and escapes source-controlled labels', () => {
    const session = architectureSession();
    session.inventory.packageName = 'legacy-<unsafe>';
    const html = renderSrijikaMigrationArchitectureWebview({
      nonce: 'graph-nonce',
      graph: buildSrijikaArchitectureGraph(session),
    });
    expect(html).toContain('Migration Architecture Graph');
    expect(html).toContain('Import edges');
    expect(html).toContain('Violations only');
    expect(html).toContain('loadOwnerDetail');
    expect(html).toContain("script-src 'nonce-graph-nonce'");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain('legacy-<unsafe>');
    expect(html).toContain('legacy-\\u003cunsafe>');
    const script = /<script nonce="graph-nonce">([\s\S]+)<\/script>/u.exec(html)?.[1];
    expect(script).toBeTruthy();
    if (!script) throw new Error('Expected rendered graph script');
    expect(() => new Script(script)).not.toThrow();
  });
});
