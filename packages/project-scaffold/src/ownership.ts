import {
  canonicalSrijikaOwnerName,
  srijikaFolderName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_NAME_PATTERN,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';

export type SrijikaOptionalOwnerCapability = 'hook' | 'store' | 'logic' | 'api' | 'types';
export type SrijikaOwnerFileRole = 'ui' | 'connector' | SrijikaOptionalOwnerCapability;

export interface SrijikaOwnershipCreationInput {
  owner: SrijikaStructureOwnerContext;
  action: SrijikaStructureCreationAction;
  name?: string;
  optionalCapabilities?: readonly SrijikaOptionalOwnerCapability[];
  existingRelativePaths?: readonly string[];
  existingSources?: Readonly<Record<string, string>>;
  allowCustomConnectorHookInsertion?: boolean;
}

export interface SrijikaOwnershipCapabilityBatchInput {
  owner: Exclude<SrijikaStructureOwnerContext, { level: 'featuresRoot' }>;
  actions: readonly SrijikaStructureCreationAction[];
  existingRelativePaths: readonly string[];
  existingSources: Readonly<Record<string, string>>;
}

export interface SrijikaOwnershipCreationFile {
  relativePath: string;
  source: string;
}

export interface SrijikaOwnershipCreationPlan {
  ownerName: string;
  ownerFolder: string;
  files: readonly SrijikaOwnershipCreationFile[];
  updates: readonly SrijikaOwnershipCreationFile[];
}

export interface SrijikaOwnershipFileStatus {
  role: SrijikaOwnerFileRole;
  action?: SrijikaStructureCreationAction;
  relativePath: string;
  exists: boolean;
  required: boolean;
}

export function availableSrijikaOwnershipCreationActions(
  owner: SrijikaStructureOwnerContext,
  existingRelativePaths: readonly string[],
  existingSources: Readonly<Record<string, string>> = {},
): readonly SrijikaStructureCreationAction[] {
  void existingSources;
  const existing = new Set(
    existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLowerCase()),
  );
  return srijikaStructureCreationActionsForOwner(owner).filter((action) => {
    if (action === 'feature' || action === 'slot' || action === 'part') return true;
    if (owner.level === 'featuresRoot') return false;
    const role = ACTION_ROLE[action];
    if (!role) return false;
    const target = targetForOwner(owner);
    const roleExists = (candidate: FileRole): boolean =>
      existing.has(filePathFor(target, candidate).toLowerCase());
    if (roleExists(role)) return false;
    if (!roleExists('ui')) return false;
    return role === 'connector' || roleExists('connector');
  });
}

type OwnerLevel = 'feature' | 'slot' | 'part';
type FileRole = SrijikaOwnerFileRole;

interface TargetOwner {
  level: OwnerLevel;
  name: string;
  folder: string;
}

function targetForOwner(
  owner: Exclude<SrijikaStructureOwnerContext, { level: 'featuresRoot' }>,
): TargetOwner {
  return {
    level: owner.level,
    name:
      owner.level === 'feature'
        ? owner.featureName
        : owner.level === 'slot'
          ? owner.slotName
          : owner.partName,
    folder: owner.folder,
  };
}

const ACTION_ROLE: Partial<Record<SrijikaStructureCreationAction, FileRole>> = {
  featureConnector: 'connector',
  featureHook: 'hook',
  featureStore: 'store',
  featureLogic: 'logic',
  featureApi: 'api',
  featureTypes: 'types',
  slotConnector: 'connector',
  slotHook: 'hook',
  slotStore: 'store',
  slotLogic: 'logic',
  slotApi: 'api',
  slotTypes: 'types',
  partConnector: 'connector',
  partHook: 'hook',
  partStore: 'store',
  partLogic: 'logic',
  partApi: 'api',
  partTypes: 'types',
};

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLocaleLowerCase('en-US')}${value.slice(1)}`;
}

function fileNameFor(ownerName: string, role: FileRole): string {
  switch (role) {
    case 'ui':
      return `${ownerName}.ui.tsx`;
    case 'connector':
      return `${ownerName}.connector.tsx`;
    case 'hook':
      return `use${ownerName}.ts`;
    case 'store':
    case 'logic':
    case 'api':
    case 'types':
      return `${lowerFirst(ownerName)}.${role}.ts`;
  }
}

function filePathFor(owner: TargetOwner, role: FileRole): string {
  return `${owner.folder}/${fileNameFor(owner.name, role)}`;
}

function targetForAction(
  owner: SrijikaStructureOwnerContext,
  action: SrijikaStructureCreationAction,
  rawName: string | undefined,
): TargetOwner {
  if (action === 'feature' || action === 'slot' || action === 'part') {
    const name = rawName?.trim() ?? '';
    if (!SRIJIKA_OWNER_NAME_PATTERN.test(name) || canonicalSrijikaOwnerName(name) !== name) {
      throw new Error('Use normalized PascalCase for the owner name, for example Dashboard.');
    }
    if (action === 'feature' && owner.level === 'featuresRoot') {
      return { level: 'feature', name, folder: `${owner.folder}/${srijikaFolderName(name)}` };
    }
    if (action === 'slot' && owner.level === 'feature') {
      return { level: 'slot', name, folder: `${owner.folder}/slots/${srijikaFolderName(name)}` };
    }
    if (action === 'part' && owner.level === 'slot') {
      return { level: 'part', name, folder: `${owner.folder}/parts/${srijikaFolderName(name)}` };
    }
    throw new Error(`${action} cannot be created inside ${owner.level}.`);
  }

  if (owner.level === 'featuresRoot') {
    throw new Error(`Only a Feature can be created inside ${owner.folder}.`);
  }
  return targetForOwner(owner);
}

export function srijikaOwnershipFileStatuses(
  owner: Exclude<SrijikaStructureOwnerContext, { level: 'featuresRoot' }>,
  existingRelativePaths: readonly string[],
): readonly SrijikaOwnershipFileStatus[] {
  const target = targetForOwner(owner);
  const existing = new Set(
    existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLowerCase()),
  );
  const status = (
    role: FileRole,
    action?: SrijikaStructureCreationAction,
  ): SrijikaOwnershipFileStatus => {
    const relativePath = filePathFor(target, role);
    return {
      role,
      ...(action ? { action } : {}),
      relativePath,
      exists: existing.has(relativePath.toLowerCase()),
      required: role === 'ui' || role === 'connector',
    };
  };
  const actions = srijikaStructureCreationActionsForOwner(owner).filter(
    (action) => action !== 'slot' && action !== 'part',
  );
  return [
    status('ui'),
    ...actions.flatMap((action) => {
      const role = ACTION_ROLE[action];
      return role ? [status(role, action)] : [];
    }),
  ];
}

function importPath(ownerName: string, role: FileRole): string {
  return `./${fileNameFor(ownerName, role).replace(/\.(?:ts|tsx)$/, '')}`;
}

function highestJunior(roles: ReadonlySet<FileRole>, from: FileRole): FileRole | null {
  const order: readonly FileRole[] = ['connector', 'hook', 'store', 'logic', 'api'];
  const index = order.indexOf(from);
  return order.slice(index + 1).find((role) => roles.has(role)) ?? null;
}

function sourceFor(owner: TargetOwner, role: FileRole, roles: ReadonlySet<FileRole>): string {
  const lowerName = lowerFirst(owner.name);
  const junior = highestJunior(roles, role);
  if (role === 'ui') {
    return `export interface ${owner.name}UIProps {\n  className?: string;\n}\n\nexport function ${owner.name}UI({ className }: ${owner.name}UIProps) {\n  return (\n    <section className={className} data-srijika-owner="${owner.name}">\n      <h2>${owner.name}</h2>\n    </section>\n  );\n}\n`;
  }
  if (role === 'types') {
    return `export interface ${owner.name}Result {\n  ok: boolean;\n}\n`;
  }
  if (role === 'api') {
    const typeImport = roles.has('types')
      ? `import type { ${owner.name}Result } from '${importPath(owner.name, 'types')}';\n\n`
      : '';
    const resultType = roles.has('types') ? owner.name + 'Result' : '{ ok: boolean }';
    return `${typeImport}export const ${lowerName}Api = {\n  async load(): Promise<${resultType}> {\n    throw new Error('Connect ${owner.name} API transport.');\n  },\n};\n`;
  }
  if (role === 'logic') {
    const juniorImport =
      junior === 'api'
        ? `import { ${lowerName}Api } from '${importPath(owner.name, 'api')}';\n\n`
        : '';
    const load = junior === 'api' ? `() => ${lowerName}Api.load()` : `async () => ({ ok: true })`;
    return `${juniorImport}export const ${lowerName}Logic = {\n  load: ${load},\n};\n`;
  }
  if (role === 'store') {
    const targetRole = junior === 'logic' ? 'logic' : junior === 'api' ? 'api' : null;
    const symbol = targetRole ? `${lowerName}${targetRole === 'logic' ? 'Logic' : 'Api'}` : null;
    const juniorImport =
      targetRole && symbol
        ? `import { ${symbol} } from '${importPath(owner.name, targetRole)}';\n`
        : '';
    const load = symbol
      ? `await ${symbol}.load();`
      : `// Add an owner action when state needs one.`;
    return `import { create } from 'zustand';\n${juniorImport}\ninterface ${owner.name}State {\n  ready: boolean;\n  load: () => Promise<void>;\n}\n\nexport const use${owner.name}Store = create<${owner.name}State>((set) => ({\n  ready: false,\n  load: async () => {\n    ${load}\n    set({ ready: true });\n  },\n}));\n`;
  }
  if (role === 'hook') {
    const targetRole =
      junior === 'store' ? 'store' : junior === 'logic' ? 'logic' : junior === 'api' ? 'api' : null;
    if (targetRole === 'store') {
      return `import { use${owner.name}Store } from '${importPath(owner.name, 'store')}';\n\nexport function use${owner.name}() {\n  return use${owner.name}Store();\n}\n`;
    }
    if (targetRole) {
      const symbol = `${lowerName}${targetRole === 'logic' ? 'Logic' : 'Api'}`;
      return `import { ${symbol} } from '${importPath(owner.name, targetRole)}';\n\nexport function use${owner.name}() {\n  return { load: ${symbol}.load };\n}\n`;
    }
    return `export function use${owner.name}() {\n  return {};\n}\n`;
  }

  const uiImport = `import { ${owner.name}UI } from '${importPath(owner.name, 'ui')}';\n`;
  if (junior === 'hook') {
    return `${uiImport}import { use${owner.name} } from '${importPath(owner.name, 'hook')}';\n\nexport function ${owner.name}Connector() {\n  const model = use${owner.name}();\n  void model;\n  return <${owner.name}UI />;\n}\n`;
  }
  if (junior === 'store') {
    return `${uiImport}import { use${owner.name}Store } from '${importPath(owner.name, 'store')}';\n\nexport function ${owner.name}Connector() {\n  const model = use${owner.name}Store();\n  void model;\n  return <${owner.name}UI />;\n}\n`;
  }
  if (junior === 'logic' || junior === 'api') {
    const symbol = `${lowerName}${junior === 'logic' ? 'Logic' : 'Api'}`;
    return `${uiImport}import { ${symbol} } from '${importPath(owner.name, junior)}';\n\nexport function ${owner.name}Connector() {\n  void ${symbol};\n  return <${owner.name}UI />;\n}\n`;
  }
  return `${uiImport}\nexport function ${owner.name}Connector() {\n  return <${owner.name}UI />;\n}\n`;
}

function safelyInsertHookIntoCustomConnector(
  owner: TargetOwner,
  currentSource: string,
): string | null {
  const hookSymbol = `use${owner.name}`;
  const importSource = importPath(owner.name, 'hook');
  const modelName = `srijika${owner.name}Model`;
  if (currentSource.includes(modelName)) return null;

  let updated = currentSource;
  const hookImportPattern = new RegExp(`from\\s+['"]${importSource.replaceAll('.', '\\.')}['"]`);
  if (!hookImportPattern.test(updated)) {
    const importLine = `import { ${hookSymbol} } from '${importSource}';\n`;
    const directive = updated.match(/^(?:'use client'|"use client");\s*\n/);
    const insertionOffset = directive?.[0].length ?? 0;
    updated = `${updated.slice(0, insertionOffset)}${importLine}${updated.slice(insertionOffset)}`;
  }

  const connectorPattern = new RegExp(
    `(export\\s+function\\s+${owner.name}Connector\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\s*\\{)`,
  );
  if (!connectorPattern.test(updated)) return null;
  return updated.replace(
    connectorPattern,
    `$1\n  const ${modelName} = ${hookSymbol}();\n  void ${modelName};`,
  );
}

export function buildSrijikaOwnershipCreationPlan(
  input: SrijikaOwnershipCreationInput,
): SrijikaOwnershipCreationPlan {
  const allowed = srijikaStructureCreationActionsForOwner(input.owner);
  if (!allowed.includes(input.action)) {
    throw new Error(`${input.action} is not allowed inside ${input.owner.folder}.`);
  }

  const target = targetForAction(input.owner, input.action, input.name);
  const existing = new Set(
    (input.existingRelativePaths ?? []).map((path) => path.replaceAll('\\', '/').toLowerCase()),
  );
  const existingSources = new Map(
    Object.entries(input.existingSources ?? {}).map(([path, source]) => [
      path.replaceAll('\\', '/').toLowerCase(),
      source.replaceAll('\r\n', '\n'),
    ]),
  );
  const composite =
    input.action === 'feature' || input.action === 'slot' || input.action === 'part';
  const plannedRoles = new Set<FileRole>();
  if (composite) {
    plannedRoles.add('ui');
    plannedRoles.add('connector');
    for (const role of input.optionalCapabilities ?? []) plannedRoles.add(role);
  } else {
    const role = ACTION_ROLE[input.action];
    if (!role) throw new Error(`Unsupported creation action: ${input.action}`);
    plannedRoles.add(role);
  }

  const roleExists = (role: FileRole): boolean =>
    existing.has(filePathFor(target, role).toLowerCase());
  if (!composite) {
    if (!roleExists('ui')) {
      throw new Error(`Required ${filePathFor(target, 'ui')} is missing. Create the owner first.`);
    }
    if (!plannedRoles.has('connector') && !roleExists('connector')) {
      throw new Error(
        `Required ${filePathFor(target, 'connector')} is missing. Add the Connector before optional capabilities.`,
      );
    }
  }

  const availableRoles = new Set<FileRole>(plannedRoles);
  for (const role of ['ui', 'connector', 'hook', 'store', 'logic', 'api', 'types'] as const) {
    if (roleExists(role)) availableRoles.add(role);
  }

  const orderedRoles = (
    ['ui', 'types', 'api', 'logic', 'store', 'hook', 'connector'] as const
  ).filter((role) => plannedRoles.has(role));
  const duplicate = orderedRoles
    .map((role) => filePathFor(target, role))
    .find((path) => existing.has(path.toLowerCase()));
  if (duplicate) throw new Error(`${duplicate} already exists.`);

  const updates: SrijikaOwnershipCreationFile[] = [];
  if (!composite) {
    const newRole = ACTION_ROLE[input.action];
    const runtimeOrder: readonly FileRole[] = ['connector', 'hook', 'store', 'logic', 'api'];
    let seniorRole: FileRole | undefined;
    if (newRole === 'types') {
      if (roleExists('api')) seniorRole = 'api';
    } else if (newRole) {
      const newRoleIndex = runtimeOrder.indexOf(newRole);
      if (newRoleIndex > 0) {
        seniorRole = [...runtimeOrder.slice(0, newRoleIndex)]
          .reverse()
          .find((role) => roleExists(role));
      }
    }

    if (seniorRole) {
      const previousRoles = new Set(availableRoles);
      if (newRole) previousRoles.delete(newRole);
      const previousCanonicalSource = sourceFor(target, seniorRole, previousRoles).replaceAll(
        '\r\n',
        '\n',
      );
      const nextCanonicalSource = sourceFor(target, seniorRole, availableRoles);
      if (previousCanonicalSource !== nextCanonicalSource) {
        const seniorPath = filePathFor(target, seniorRole);
        const currentSource = existingSources.get(seniorPath.toLowerCase());
        if (currentSource === undefined) {
          throw new Error(
            `Read ${seniorPath} before adding this capability so Srijika can preserve the strict runtime chain.`,
          );
        }
        if (currentSource !== previousCanonicalSource && currentSource !== nextCanonicalSource) {
          const customConnectorUpdate =
            input.allowCustomConnectorHookInsertion &&
            seniorRole === 'connector' &&
            newRole === 'hook'
              ? safelyInsertHookIntoCustomConnector(target, currentSource)
              : null;
          if (customConnectorUpdate) {
            updates.push({ relativePath: seniorPath, source: customConnectorUpdate });
            return {
              ownerName: target.name,
              ownerFolder: target.folder,
              files: orderedRoles.map((role) => ({
                relativePath: filePathFor(target, role),
                source: sourceFor(target, role, availableRoles),
              })),
              updates,
            };
          }
          throw new Error(
            `${seniorPath} contains custom code. Srijika could not safely insert the new boundary; connect it in one reviewed edit.`,
          );
        }
        if (currentSource !== nextCanonicalSource) {
          updates.push({ relativePath: seniorPath, source: nextCanonicalSource });
        }
      }
    }
  }

  return {
    ownerName: target.name,
    ownerFolder: target.folder,
    files: orderedRoles.map((role) => ({
      relativePath: filePathFor(target, role),
      source: sourceFor(target, role, availableRoles),
    })),
    updates,
  };
}

export function buildSrijikaOwnershipCapabilityBatchPlan(
  input: SrijikaOwnershipCapabilityBatchInput,
): SrijikaOwnershipCreationPlan {
  const actionOrder: readonly FileRole[] = ['connector', 'hook', 'store', 'logic', 'api', 'types'];
  const allowed = new Set(srijikaStructureCreationActionsForOwner(input.owner));
  const actions = [...new Set(input.actions)].sort((left, right) => {
    const leftRole = ACTION_ROLE[left];
    const rightRole = ACTION_ROLE[right];
    return actionOrder.indexOf(leftRole ?? 'ui') - actionOrder.indexOf(rightRole ?? 'ui');
  });
  if (actions.length === 0) throw new Error('Select at least one missing owner file to create.');
  for (const action of actions) {
    if (!allowed.has(action) || !ACTION_ROLE[action]) {
      throw new Error(`${action} is not an owner-file action for ${input.owner.folder}.`);
    }
  }

  const paths = [...input.existingRelativePaths];
  const sources: Record<string, string> = { ...input.existingSources };
  const created = new Map<string, SrijikaOwnershipCreationFile>();
  const updates = new Map<string, SrijikaOwnershipCreationFile>();

  for (const action of actions) {
    const step = buildSrijikaOwnershipCreationPlan({
      owner: input.owner,
      action,
      existingRelativePaths: paths,
      existingSources: sources,
      allowCustomConnectorHookInsertion: true,
    });
    for (const file of step.files) {
      const key = file.relativePath.toLowerCase();
      paths.push(file.relativePath);
      sources[file.relativePath] = file.source;
      created.set(key, file);
    }
    for (const update of step.updates) {
      const key = update.relativePath.toLowerCase();
      sources[update.relativePath] = update.source;
      const createdFile = created.get(key);
      if (createdFile) {
        created.set(key, { ...createdFile, source: update.source });
      } else {
        updates.set(key, update);
      }
    }
  }

  const target = targetForOwner(input.owner);
  return {
    ownerName: target.name,
    ownerFolder: target.folder,
    files: [...created.values()],
    updates: [...updates.values()],
  };
}
