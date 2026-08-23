import { describe, expect, it } from 'vitest';

import type { ReactMigrationSession } from '@srijika/developer-engine';

import { renderSrijikaMigrationDashboard } from '../src/migration-dashboard';

function migrationSession(): ReactMigrationSession {
  return {
    version: 2,
    id: 'migration-session',
    sourceRoot: '/workspace/legacy',
    targetRoot: '/workspace/new-srijika',
    phase: 'migrating',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    inventory: {
      sourceRoot: '/workspace/legacy',
      packageName: 'legacy',
      framework: 'vite',
      language: 'typescript',
      files: [
        {
          relativePath: 'src/Home.tsx',
          category: 'component',
          size: 100,
          sha256: 'source-hash',
        },
      ],
      environmentKeys: {},
      totalBytes: 100,
      snapshotSha256: 'snapshot-hash',
      semanticRoutesPresent: false,
      packageDependencies: [],
      packageDependencyRecords: [],
      packageScripts: {},
      toolchain: { configPaths: [] },
      sourceAliases: {},
      ownership: [],
    },
    plan: {
      id: 'plan-id',
      sourceRoot: '/workspace/legacy',
      targetRoot: '/workspace/new-srijika',
      sourceSnapshotSha256: 'snapshot-hash',
      targetBaselineSha256: 'target-hash',
      slices: [
        {
          id: 'feature-home',
          title: 'Home feature',
          sourcePaths: ['src/Home.tsx'],
          dependencyOwnerIds: [],
          cycleOwnerIds: [],
          requiredStarterCleanup: [],
          acceptance: ['Native owner'],
        },
      ],
      ownership: [
        {
          sourcePath: 'src/Home.tsx',
          ownerId: 'feature:home',
          ownerKind: 'feature',
          ownerName: 'Home <safe>',
          ownerPath: 'src/features/home',
          role: 'ui',
          canonicalTargetPaths: ['src/features/home/Home.ui.tsx'],
          rationale: 'UI owner',
          dependencies: [],
          graphComponentId: 'graph-home',
          routeEntrypoint: false,
          completionObligation: 'native-owner',
          approvedLegacyAdapters: [],
        },
      ],
      approvedLegacyAdapters: [],
      requiredStarterCleanup: [],
      unsupported: [],
    },
    mappings: [],
    ignoredSources: [],
    appliedSlices: [],
    reviewedSlices: [],
  };
}

describe('Srijika VS Code migration dashboard', () => {
  it('renders folder selection, guarded target modes, architecture, slices, and connectors', () => {
    const html = renderSrijikaMigrationDashboard({
      nonce: 'migration-nonce',
      source: '/workspace/legacy',
      target: '/workspace/new-srijika',
      targetMode: 'new',
      currentWorkspace: '/workspace/current',
      busy: false,
      session: migrationSession(),
      connectors: {
        codex: { detected: true, label: 'openai.chatgpt is installed.' },
        mcp: {
          configured: true,
          label: 'Srijika MCP configured.',
          paths: ['.vscode/mcp.json', '.mcp.json'],
        },
      },
    });

    expect(html).toContain('React → Srijika Migration');
    expect(html).toContain('New target folder · Recommended');
    expect(html).toContain('Current workspace target');
    expect(html).toContain('Start / Resume Migration');
    expect(html).toContain('Full session JSON');
    expect(html).toContain('Open Architecture Graph');
    expect(html).toContain('Planned architecture');
    expect(html).toContain('Home &lt;safe&gt;');
    expect(html).toContain('feature-home');
    expect(html).toContain('Codex for VS Code');
    expect(html).toContain('.vscode/mcp.json');
    expect(html).toContain("script-src 'nonce-migration-nonce'");
    expect(html).not.toContain("'unsafe-inline'");
  });

  it('keeps start disabled until both roots are selected', () => {
    const html = renderSrijikaMigrationDashboard({
      nonce: 'empty-nonce',
      source: '',
      target: '',
      targetMode: 'new',
      busy: false,
      connectors: {
        codex: { detected: false, label: 'Not detected.' },
        mcp: { configured: false, label: 'Not configured.', paths: [] },
      },
    });
    expect(html).toContain('id="start" class="primary" disabled');
    expect(html).toContain('source is never modified');
    expect(html).toContain('authenticated live connection is confirmed by the MCP client');
  });
});
