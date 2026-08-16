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
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';

const OPTIONAL_CAPABILITIES = Object.freeze(['hook', 'store', 'logic', 'api', 'types'] as const);
const MAX_INVENTORY_FILES = 4_096;
const MAX_INVENTORY_ENTRIES = 32_768;
const MAX_INVENTORY_DIRECTORIES = 4_096;
const MAX_INVENTORY_DEPTH = 32;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 24 * 1024 * 1024;
function isMigrationSourceFile(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return (
    /\.(?:[cm]?[jt]s|[jt]sx)$/.test(normalized) && !/\.d\.(?:ts|tsx|mts|cts)$/.test(normalized)
  );
}
export type SrijikaStructureKind =
  | 'feature'
  | 'slot'
  | 'part'
  | 'shared-ui'
  | 'shared-widget'
  | 'shared-capability'
  | 'connector'
  | 'behavior-hook'
  | 'store-slice'
  | SrijikaOptionalOwnerCapability;

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
): Promise<{ paths: string[]; sources: Record<string, string> }> {
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const sources: Record<string, string> = {};
  const files = await fileSystem.walkFiles([''], {
    maximumFiles: MAX_INVENTORY_FILES,
    maximumEntries: MAX_INVENTORY_ENTRIES,
    maximumDirectories: MAX_INVENTORY_DIRECTORIES,
    maximumDepth: MAX_INVENTORY_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: true,
    stopAtNestedProjectRoots: true,
    acceptFile: isMigrationSourceFile,
  });
  let totalSourceBytes = 0;
  for (const file of files) {
    const read = await fileSystem.readText(file.absolutePath, MAX_SOURCE_BYTES);
    totalSourceBytes += read.size;
    if (totalSourceBytes > MAX_SOURCE_TOTAL_BYTES) {
      throw new Error('Ownership inventory exceeds the 24 MiB aggregate source safety limit.');
    }
    sources[file.relativePath] = read.source;
  }
  return { paths: files.map(({ relativePath }) => relativePath), sources };
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
  if (kind === 'shared-ui') return 'sharedUi';
  if (kind === 'shared-widget') return 'sharedWidget';
  if (kind === 'shared-capability') return 'sharedCapability';
  if (owner.level === 'featuresRoot') {
    throw new Error('Only a Feature can be created directly inside the configured Features root.');
  }
  if (owner.level === 'sharedRoot') {
    throw new Error(
      'Choose shared-ui, shared-widget, or shared-capability inside the configured Shared root.',
    );
  }
  if (kind === 'behavior-hook') {
    if (owner.level === 'sharedUi') {
      throw new Error('Shared UI primitives cannot own Hooks. Use a Shared Widget instead.');
    }
    return `${owner.level}BehaviorHook`;
  }
  if (kind === 'store-slice') {
    if (owner.level === 'sharedUi') {
      throw new Error('Shared UI primitives cannot own Stores. Use a Shared Widget instead.');
    }
    return `${owner.level}StoreSlice`;
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
      : request.kind === 'shared-ui' ||
          request.kind === 'shared-widget' ||
          request.kind === 'shared-capability'
        ? architecture.sharedRoot
        : normalizedOwnerFolder(root, process.cwd());
  const owner = resolveSrijikaStructureOwner(ownerFolder, project.architecture);
  if (!owner)
    throw new Error(`${ownerFolder} is not a canonical Feature, Slot, Part, or Shared boundary.`);
  const action = actionFor(owner, request.kind);
  const composite =
    action === 'feature' ||
    action === 'slot' ||
    action === 'part' ||
    action === 'sharedUi' ||
    action === 'sharedWidget' ||
    action === 'sharedCapability';
  const namedCapability = request.kind === 'behavior-hook' || request.kind === 'store-slice';
  if ((composite || namedCapability) && !request.name) {
    throw new Error(`srijika add ${action} requires a normalized PascalCase name.`);
  }
  if (!composite && !namedCapability && request.name) {
    throw new Error(`${request.kind} is added to the selected owner and does not accept a name.`);
  }
  const optionalCapabilities = request.optionalCapabilities ?? [];
  if (optionalCapabilities.some((capability) => !OPTIONAL_CAPABILITIES.includes(capability))) {
    throw new Error('Only hook, store, logic, api, and types are optional owner capabilities.');
  }
  const existing = await collectSourceFiles(root);
  const plan = buildSrijikaOwnershipCreationPlan({
    owner,
    action,
    ...(request.name ? { name: request.name } : {}),
    ...(composite ? { optionalCapabilities } : {}),
    existingRelativePaths: existing.paths,
    existingSources: existing.sources,
    ...(project.aliases ? { aliases: project.aliases } : {}),
    allowCustomConnectorHookInsertion: true,
    architecture,
  });
  const dryRun = request.dryRun ?? false;
  if (!dryRun) {
    await applySrijikaOwnershipCreationPlan(root, plan, {
      expectedUpdateSources: Object.fromEntries(
        [
          ...plan.updates.map((update) => update.relativePath),
          ...(plan.moves ?? []).map((move) => move.fromRelativePath),
        ].flatMap((relativePath) => {
          const source = existing.sources[relativePath];
          return source === undefined ? [] : [[relativePath, source]];
        }),
      ),
    });
  }
  return Object.freeze({ root, plan, dryRun });
}
