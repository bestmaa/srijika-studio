import type { SrijikaTestContract } from '@srijika/architecture-rules';

import type { SrijikaNextTestAdapterPlan } from './next-testing.js';
import type { SrijikaViteTestAdapterPlan } from './testing.js';

export const SRIJIKA_TEST_EVIDENCE_VERSION = 'srijika-test-evidence-v1' as const;

export type SrijikaEvidenceStatus = 'passed' | 'failed' | 'uncovered' | 'not-run';

export interface SrijikaRequirementEvidence {
  requirementId: string;
  status: SrijikaEvidenceStatus;
  artifact?: string;
  messages: readonly string[];
}

export interface SrijikaOwnerRepairScope {
  allowedSourceFiles: readonly string[];
  failingArtifacts: readonly string[];
  failureMessages: readonly string[];
  rerunScripts: Readonly<Record<string, string>>;
}

export interface SrijikaOwnerTestEvidence {
  ownerId: string;
  status: SrijikaEvidenceStatus;
  requirements: readonly SrijikaRequirementEvidence[];
  repair?: SrijikaOwnerRepairScope;
}

export interface SrijikaTestEvidenceManifest {
  version: typeof SRIJIKA_TEST_EVIDENCE_VERSION;
  contractVersion: SrijikaTestContract['version'];
  adapterVersion: string;
  framework: 'vite' | 'next-app-router';
  status: SrijikaEvidenceStatus;
  owners: readonly SrijikaOwnerTestEvidence[];
}

export interface BuildSrijikaTestEvidenceOptions {
  vitest?: unknown;
  playwright?: unknown;
  architecturePassed?: boolean;
  typecheckPassed?: boolean;
}

interface ReportFileResult {
  status: 'passed' | 'failed' | 'not-run';
  messages: string[];
}

function normalized(value: string): string {
  return value.replaceAll('\\', '/');
}

function reportResults(report: unknown): Map<string, ReportFileResult> {
  const results = new Map<string, ReportFileResult>();
  const visit = (value: unknown, inheritedFile?: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inheritedFile);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const file =
      typeof record['file'] === 'string'
        ? normalized(record['file'])
        : typeof record['name'] === 'string' &&
            /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(record['name'])
          ? normalized(record['name'])
          : inheritedFile;
    const status = typeof record['status'] === 'string' ? record['status'] : undefined;
    if (
      file &&
      status &&
      ['failed', 'interrupted', 'passed', 'pending', 'skipped', 'timedOut', 'todo'].includes(status)
    ) {
      const current = results.get(file) ?? { status: 'not-run', messages: [] };
      if (status === 'failed' || status === 'interrupted' || status === 'timedOut') {
        current.status = 'failed';
      } else if (status === 'passed' && current.status !== 'failed') {
        current.status = 'passed';
      }
      const message =
        typeof record['message'] === 'string'
          ? record['message']
          : typeof record['failureMessage'] === 'string'
            ? record['failureMessage']
            : undefined;
      if (message) current.messages.push(message.slice(0, 4_096));
      results.set(file, current);
    }
    for (const child of Object.values(record)) visit(child, file);
  };
  visit(report);
  return results;
}

function resultForArtifact(
  artifact: string,
  results: ReadonlyMap<string, ReportFileResult>,
): ReportFileResult {
  const normalizedArtifact = normalized(artifact);
  const artifactBaseName = normalizedArtifact.split('/').at(-1)!;
  const matches = [...results.entries()].filter(([file]) => {
    const normalizedFile = normalized(file);
    return (
      normalizedFile.endsWith(normalizedArtifact) ||
      normalizedFile === artifactBaseName ||
      normalizedFile.endsWith(`/${artifactBaseName}`)
    );
  });
  if (matches.length === 0) return { status: 'not-run', messages: [] };
  return {
    status: matches.some(([, result]) => result.status === 'failed')
      ? 'failed'
      : matches.some(([, result]) => result.status === 'passed')
        ? 'passed'
        : 'not-run',
    messages: [...new Set(matches.flatMap(([, result]) => result.messages))],
  };
}

function aggregateStatus(statuses: readonly SrijikaEvidenceStatus[]): SrijikaEvidenceStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('uncovered')) return 'uncovered';
  if (statuses.includes('not-run')) return 'not-run';
  return 'passed';
}

export function buildSrijikaTestEvidenceManifest(
  contract: SrijikaTestContract,
  adapter: SrijikaViteTestAdapterPlan | SrijikaNextTestAdapterPlan,
  options: BuildSrijikaTestEvidenceOptions = {},
): SrijikaTestEvidenceManifest {
  const vitest = reportResults(options.vitest);
  const playwright = reportResults(options.playwright);
  const uncovered = new Set(adapter.uncoveredRequirementIds);
  const artifactResults = new Map(
    adapter.artifacts.map((artifact) => [
      artifact.relativePath,
      resultForArtifact(
        artifact.relativePath,
        artifact.relativePath.endsWith('.spec.ts') ? playwright : vitest,
      ),
    ]),
  );
  const owners = contract.owners.map((owner): SrijikaOwnerTestEvidence => {
    const requirements = owner.requirements.map((requirement): SrijikaRequirementEvidence => {
      if (uncovered.has(requirement.id)) {
        return { requirementId: requirement.id, status: 'uncovered', messages: [] };
      }
      if (requirement.layer === 'architecture' || requirement.layer === 'typecheck') {
        const passed =
          requirement.layer === 'architecture'
            ? options.architecturePassed
            : options.typecheckPassed;
        return {
          requirementId: requirement.id,
          status: passed === undefined ? 'not-run' : passed ? 'passed' : 'failed',
          messages: passed === false ? [`${requirement.layer} gate failed.`] : [],
        };
      }
      const artifact = adapter.artifacts.find(
        (candidate) =>
          candidate.ownerId === owner.id && candidate.requirementIds.includes(requirement.id),
      );
      if (!artifact) {
        return { requirementId: requirement.id, status: 'not-run', messages: [] };
      }
      const result = artifactResults.get(artifact.relativePath)!;
      return {
        requirementId: requirement.id,
        status: result.status,
        artifact: artifact.relativePath,
        messages: result.messages,
      };
    });
    const status = aggregateStatus(requirements.map((requirement) => requirement.status));
    const failing = requirements.filter(
      ({ status: requirementStatus }) => requirementStatus === 'failed',
    );
    return {
      ownerId: owner.id,
      status,
      requirements,
      ...(failing.length === 0
        ? {}
        : {
            repair: {
              allowedSourceFiles: owner.files.map(({ fileName }) => fileName).sort(),
              failingArtifacts: [
                ...new Set(failing.flatMap(({ artifact }) => (artifact ? [artifact] : []))),
              ].sort(),
              failureMessages: [...new Set(failing.flatMap(({ messages }) => messages))],
              rerunScripts: adapter.scripts,
            },
          }),
    };
  });
  return {
    version: SRIJIKA_TEST_EVIDENCE_VERSION,
    contractVersion: contract.version,
    adapterVersion: adapter.version,
    framework: adapter.framework,
    status: aggregateStatus(owners.map(({ status }) => status)),
    owners,
  };
}
