import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  resolveSrijikaArchitectureConfig,
  resolveSrijikaStructureOwner,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';
import {
  applySrijikaOwnershipCreationPlan,
  buildSrijikaOwnershipCreationPlan,
  type SrijikaOptionalOwnerCapability,
  type SrijikaOwnershipCreationPlan,
} from '@srijika/project-scaffold';

import { findSrijikaProjectRoot, inspectSrijikaProject } from './project.js';

const OPTIONAL_CAPABILITIES = Object.freeze(['hook', 'store', 'logic', 'api', 'types'] as const);
export type SrijikaStructureKind =
  'feature' | 'slot' | 'part' | 'connector' | SrijikaOptionalOwnerCapability;

export interface ScaffoldSrijikaStructureRequest {
  project?: string;
  kind: SrijikaStructureKind;
  name?: string;
  ownerFolder?: string;
  optionalCapabilities?: readonly SrijikaOptionalOwnerCapability[];
  dryRun?: boolean;
}

export interface ScaffoldSrijikaStructureResult {
  root: string;
  plan: SrijikaOwnershipCreationPlan;
  dryRun: boolean;
}

async function collectSourceFiles(
  root: string,
  relativeFolder: string,
): Promise<{ paths: string[]; sources: Record<string, string> }> {
  const paths: string[] = [];
  const sources: Record<string, string> = {};
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = resolve(root, ...relativeDirectory.split('/'));
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const child = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) {
        paths.push(child);
        if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name))
          sources[child] = await readFile(resolve(root, ...child.split('/')), 'utf8');
      }
    }
  };
  await visit(relativeFolder);
  return { paths, sources };
}

function normalizedOwnerFolder(root: string, value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const fromRoot = relative(root, absolute).replaceAll('\\', '/');
  if (!fromRoot || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    throw new Error('The selected owner must remain inside the Srijika project.');
  }
  return fromRoot;
}

function actionFor(
  owner: SrijikaStructureOwnerContext,
  kind: SrijikaStructureKind,
): SrijikaStructureCreationAction {
  if (kind === 'feature' || kind === 'slot' || kind === 'part') return kind;
  if (owner.level === 'featuresRoot') {
    throw new Error('Only a Feature can be created directly inside src/features.');
  }
  const suffix = `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
  return `${owner.level}${suffix}` as SrijikaStructureCreationAction;
}

export async function scaffoldSrijikaStructure(
  request: ScaffoldSrijikaStructureRequest,
): Promise<ScaffoldSrijikaStructureResult> {
  const root = await findSrijikaProjectRoot(request.project ?? process.cwd());
  const project = await inspectSrijikaProject(root);
  const architecture = resolveSrijikaArchitectureConfig(project.architecture);
  const ownerFolder = request.ownerFolder
    ? normalizedOwnerFolder(root, request.ownerFolder)
    : request.kind === 'feature'
      ? architecture.featuresRoot
      : normalizedOwnerFolder(root, process.cwd());
  const owner = resolveSrijikaStructureOwner(ownerFolder, project.architecture);
  if (!owner) throw new Error(`${ownerFolder} is not a canonical Feature, Slot, or Part boundary.`);
  const action = actionFor(owner, request.kind);
  const composite = action === 'feature' || action === 'slot' || action === 'part';
  if (composite && !request.name) {
    throw new Error(`srijika add ${action} requires a normalized PascalCase name.`);
  }
  if (!composite && request.name) {
    throw new Error(`${request.kind} is added to the selected owner and does not accept a name.`);
  }
  const optionalCapabilities = request.optionalCapabilities ?? [];
  if (optionalCapabilities.some((capability) => !OPTIONAL_CAPABILITIES.includes(capability))) {
    throw new Error('Only hook, store, logic, api, and types are optional owner capabilities.');
  }
  const existing = await collectSourceFiles(root, architecture.featuresRoot);
  const plan = buildSrijikaOwnershipCreationPlan({
    owner,
    action,
    ...(request.name ? { name: request.name } : {}),
    ...(composite ? { optionalCapabilities } : {}),
    existingRelativePaths: existing.paths,
    existingSources: existing.sources,
    allowCustomConnectorHookInsertion: true,
  });
  const dryRun = request.dryRun ?? false;
  if (!dryRun) {
    await applySrijikaOwnershipCreationPlan(root, plan, {
      expectedUpdateSources: Object.fromEntries(
        plan.updates.flatMap((update) => {
          const source = existing.sources[update.relativePath];
          return source === undefined ? [] : [[update.relativePath, source]];
        }),
      ),
    });
  }
  return Object.freeze({ root, plan, dryRun });
}
