import {
  scaffoldSrijikaStructure,
  type ScaffoldSrijikaStructureResult,
  type SrijikaStructureKind,
} from '@srijika/developer-engine';
import type { SrijikaOptionalOwnerCapability } from '@srijika/project-scaffold';

import {
  assertKnownOptions,
  booleanOption,
  stringOption,
  type ParsedArguments,
} from './arguments.js';

const OPTIONAL_CAPABILITIES = Object.freeze(['hook', 'store', 'logic', 'api', 'types'] as const);
const STRUCTURE_KINDS = Object.freeze([
  'feature',
  'slot',
  'part',
  'shared-ui',
  'shared-widget',
  'shared-capability',
  'connector',
  'behavior-hook',
  'store-slice',
  ...OPTIONAL_CAPABILITIES,
] as const);

export type SrijikaAddResult = ScaffoldSrijikaStructureResult;

export async function addSrijikaStructure(parsed: ParsedArguments): Promise<SrijikaAddResult> {
  assertKnownOptions(parsed, ['project', 'in', 'to', 'dry-run', 'json', ...OPTIONAL_CAPABILITIES]);
  const [rawKind, name] = parsed.positionals;
  if (!rawKind) {
    throw new Error(
      'Choose what to add: feature, slot, part, shared-ui, shared-widget, shared-capability, hook, behavior-hook, store, store-slice, logic, api, or types.',
    );
  }
  if (parsed.positionals.length > 2) {
    throw new Error('The add command accepts only a target and optional owner name.');
  }
  const kind = rawKind.toLowerCase();
  if (!STRUCTURE_KINDS.includes(kind as SrijikaStructureKind)) {
    throw new Error(`Unknown add target: ${rawKind}.`);
  }
  const optionalCapabilities = OPTIONAL_CAPABILITIES.filter((capability) =>
    booleanOption(parsed, capability),
  ) as readonly SrijikaOptionalOwnerCapability[];
  const ownerFolder = stringOption(parsed, 'in') ?? stringOption(parsed, 'to');
  return scaffoldSrijikaStructure({
    project: stringOption(parsed, 'project') ?? process.cwd(),
    kind: kind as SrijikaStructureKind,
    ...(name ? { name } : {}),
    ...(ownerFolder ? { ownerFolder } : {}),
    optionalCapabilities,
    dryRun: booleanOption(parsed, 'dry-run'),
  });
}
