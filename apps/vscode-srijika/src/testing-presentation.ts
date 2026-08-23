import type {
  CollectSrijikaTestEvidenceResult,
  SynchronizeSrijikaNextTestsResult,
  SynchronizeSrijikaViteTestsResult,
} from '@srijika/developer-engine';

export type SrijikaTestFramework = 'vite' | 'next-app-router';
export type SrijikaTestSyncResult =
  SynchronizeSrijikaViteTestsResult | SynchronizeSrijikaNextTestsResult;

export interface SrijikaTestSyncSummary {
  framework: SrijikaTestFramework;
  owners: number;
  artifacts: number;
  created: number;
  updated: number;
  unchanged: number;
  preserved: number;
  packageScriptsAdded: number;
  packageDependenciesAdded: number;
  commands: readonly string[];
  dependencies: readonly string[];
}

export function summarizeSrijikaTestSync(result: SrijikaTestSyncResult): SrijikaTestSyncSummary {
  const write = result.write;
  return {
    framework: result.adapter.framework,
    owners: result.contract.owners.length,
    artifacts: result.adapter.artifacts.length,
    created: write?.created.length ?? 0,
    updated: write?.updated.length ?? 0,
    unchanged: write?.unchanged.length ?? 0,
    preserved: write?.preserved.length ?? 0,
    packageScriptsAdded: result.packageWrite?.addedScripts.length ?? 0,
    packageDependenciesAdded: result.packageWrite?.addedDevDependencies.length ?? 0,
    commands: Object.entries(result.adapter.scripts).map(
      ([name, command]) => `${name}: ${command}`,
    ),
    dependencies: result.adapter.devDependencies.map(({ name, version }) => `${name}@${version}`),
  };
}

export function formatSrijikaTestEvidence(result: CollectSrijikaTestEvidenceResult): string[] {
  const counts = { passed: 0, failed: 0, uncovered: 0, 'not-run': 0 };
  for (const owner of result.manifest.owners) counts[owner.status] += 1;
  const lines = [
    `Framework: ${result.manifest.framework}`,
    `Overall: ${result.manifest.status}`,
    `Owners: ${result.manifest.owners.length} (passed ${counts.passed}, failed ${counts.failed}, uncovered ${counts.uncovered}, not-run ${counts['not-run']})`,
    `Vitest report: ${result.reportFiles.vitestJson}`,
    `Playwright report: ${result.reportFiles.playwrightJson}`,
    '',
  ];
  for (const owner of result.manifest.owners) {
    lines.push(
      `${owner.status === 'passed' ? '✓' : owner.status === 'failed' ? '✗' : '·'} ${owner.ownerId}: ${owner.status}`,
    );
    for (const requirement of owner.requirements.filter(({ status }) => status !== 'passed')) {
      lines.push(`  - ${requirement.requirementId}: ${requirement.status}`);
    }
    if (owner.repair) {
      lines.push(`  Repair scope: ${owner.repair.allowedSourceFiles.join(', ') || '(none)'}`);
      for (const message of owner.repair.failureMessages) lines.push(`  Failure: ${message}`);
    }
  }
  return lines;
}
