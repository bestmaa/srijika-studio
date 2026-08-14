import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  resolveSrijikaArchitectureConfig,
  resolveSrijikaStructureOwner,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';
import { findSrijikaProjectRoot, inspectSrijikaProject } from '@srijika/developer-engine';
import {
  applySrijikaOwnershipCreationPlan,
  buildSrijikaOwnershipCreationPlan,
  type SrijikaOptionalOwnerCapability,
  type SrijikaOwnershipCreationPlan,
} from '@srijika/project-scaffold';

import {
  assertKnownOptions,
  booleanOption,
  stringOption,
  type ParsedArguments,
} from './arguments.js';

const OPTIONAL_CAPABILITIES = Object.freeze(['hook', 'store', 'logic', 'api', 'types'] as const);

export interface SrijikaAddResult {
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
  kind: string,
): SrijikaStructureCreationAction {
  if (kind === 'feature' || kind === 'slot' || kind === 'part') return kind;
  if (
    !OPTIONAL_CAPABILITIES.includes(kind as SrijikaOptionalOwnerCapability) &&
    kind !== 'connector'
  ) {
    throw new Error(`Unknown add target: ${kind}.`);
  }
  if (owner.level === 'featuresRoot') {
    throw new Error('Only a Feature can be created directly inside src/features.');
  }
  const suffix = `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
  return `${owner.level}${suffix}` as SrijikaStructureCreationAction;
}

export async function addSrijikaStructure(parsed: ParsedArguments): Promise<SrijikaAddResult> {
  assertKnownOptions(parsed, ['project', 'in', 'to', 'dry-run', 'json', ...OPTIONAL_CAPABILITIES]);
  const [kind, name] = parsed.positionals;
  if (!kind)
    throw new Error('Choose what to add: feature, slot, part, hook, store, logic, api, or types.');
  if (parsed.positionals.length > 2)
    throw new Error('The add command accepts only a target and optional owner name.');
  const root = await findSrijikaProjectRoot(stringOption(parsed, 'project') ?? process.cwd());
  const project = await inspectSrijikaProject(root);
  const architecture = resolveSrijikaArchitectureConfig(project.architecture);
  const requestedOwner = stringOption(parsed, 'in') ?? stringOption(parsed, 'to');
  const ownerFolder =
    requestedOwner !== undefined
      ? normalizedOwnerFolder(root, requestedOwner)
      : kind === 'feature'
        ? architecture.featuresRoot
        : normalizedOwnerFolder(root, process.cwd());
  const owner = resolveSrijikaStructureOwner(ownerFolder, project.architecture);
  if (!owner) throw new Error(`${ownerFolder} is not a canonical Feature, Slot, or Part boundary.`);
  const action = actionFor(owner, kind.toLowerCase());
  const composite = action === 'feature' || action === 'slot' || action === 'part';
  if (composite && !name)
    throw new Error(`srijika add ${action} requires a normalized PascalCase name.`);
  if (!composite && name)
    throw new Error(`${kind} is added to the selected owner and does not accept a name.`);
  const existing = await collectSourceFiles(root, architecture.featuresRoot);
  const optionalCapabilities = OPTIONAL_CAPABILITIES.filter((capability) =>
    booleanOption(parsed, capability),
  );
  const plan = buildSrijikaOwnershipCreationPlan({
    owner,
    action,
    ...(name ? { name } : {}),
    ...(composite ? { optionalCapabilities } : {}),
    existingRelativePaths: existing.paths,
    existingSources: existing.sources,
    allowCustomConnectorHookInsertion: true,
  });
  const dryRun = booleanOption(parsed, 'dry-run');
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
