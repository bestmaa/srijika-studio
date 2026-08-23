import type {
  ReactMigrationArchitectureInspection,
  ReactMigrationModuleDependency,
  ReactMigrationOwnerKind,
  ReactMigrationOwnerRole,
  ReactMigrationOwnershipDecision,
  ReactMigrationSession,
  ReactMigrationSliceContextItem,
} from '@srijika/developer-engine';

export type SrijikaArchitectureGraphNodeKind = 'app' | 'group' | 'owner' | 'file';
export type SrijikaArchitectureGraphEdgeKind =
  'hierarchy' | 'same-owner' | 'shared' | 'cross-owner';

export interface SrijikaArchitectureGraphNode {
  id: string;
  kind: SrijikaArchitectureGraphNodeKind;
  label: string;
  subtitle: string;
  parentId?: string;
  ownerId?: string;
  ownerKind?: ReactMigrationOwnerKind;
  role?: string;
  sourcePath?: string;
  targetPath?: string;
  stage?: 'planned-source' | 'converted-target';
  targetPaths: readonly string[];
  imports: readonly SrijikaArchitectureGraphImport[];
  exports: readonly string[];
  violationIds: readonly string[];
}

export interface SrijikaArchitectureGraphImport {
  specifier: string;
  kind: 'source' | 'target' | 'package' | 'unresolved';
  resolvedPath?: string;
  packageName?: string;
}

export interface SrijikaArchitectureGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: SrijikaArchitectureGraphEdgeKind;
  label: string;
}

export interface SrijikaArchitectureGraphViolation {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  nodeIds: readonly string[];
}

export interface SrijikaArchitectureGraphModel {
  sessionId: string;
  phase: string;
  sourceRoot: string;
  targetRoot: string;
  nodes: readonly SrijikaArchitectureGraphNode[];
  edges: readonly SrijikaArchitectureGraphEdge[];
  violations: readonly SrijikaArchitectureGraphViolation[];
  stats: {
    owners: number;
    files: number;
    imports: number;
    crossOwnerImports: number;
    sharedImports: number;
    violations: number;
  };
}

export interface SrijikaArchitectureOwnerDetail {
  ownerId: string;
  items: readonly {
    sourcePath: string;
    category: string;
    role: ReactMigrationOwnerRole;
    targetPaths: readonly string[];
    imports: readonly SrijikaArchitectureGraphImport[];
    exports: readonly string[];
  }[];
  errors: readonly string[];
}

const fileNodeId = (sourcePath: string): string => `file:${sourcePath}`;
const targetNodeId = (targetPath: string): string => `target:${targetPath}`;

function sourceImports(
  dependencies: readonly ReactMigrationModuleDependency[],
): readonly SrijikaArchitectureGraphImport[] {
  return dependencies.map((dependency) => ({
    specifier: dependency.specifier,
    kind:
      dependency.kind === 'unresolved-source'
        ? 'unresolved'
        : dependency.kind === 'source'
          ? 'source'
          : 'package',
    ...(dependency.resolvedSourcePath === undefined
      ? {}
      : { resolvedPath: dependency.resolvedSourcePath }),
    ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
  }));
}

function parentOwnerId(
  ownerKind: ReactMigrationOwnerKind,
  ownerPath: string,
  ownerIdByPath: ReadonlyMap<string, string>,
): string {
  if (ownerKind === 'feature') return 'group:features';
  if (ownerKind === 'slot') {
    return ownerIdByPath.get(ownerPath.split('/slots/')[0] ?? '') ?? 'group:features';
  }
  if (ownerKind === 'part') {
    return ownerIdByPath.get(ownerPath.split('/parts/')[0] ?? '') ?? 'group:features';
  }
  if (ownerKind.startsWith('shared-')) return 'group:shared';
  if (ownerKind === 'project') return 'group:project';
  return 'app';
}

function dependencyKind(
  sourceOwnerId: string,
  targetOwnerId: string,
  targetOwnerKind: ReactMigrationOwnerKind,
): Exclude<SrijikaArchitectureGraphEdgeKind, 'hierarchy'> {
  if (sourceOwnerId === targetOwnerId) return 'same-owner';
  if (targetOwnerKind.startsWith('shared-')) return 'shared';
  return 'cross-owner';
}

export function buildSrijikaArchitectureGraph(
  session: ReactMigrationSession,
  targetInspection?: ReactMigrationArchitectureInspection,
): SrijikaArchitectureGraphModel {
  const nodes: SrijikaArchitectureGraphNode[] = [
    {
      id: 'app',
      kind: 'app',
      label: session.inventory.packageName || 'Application',
      subtitle: `${session.inventory.framework} · ${session.inventory.language}`,
      targetPaths: [],
      imports: [],
      exports: [],
      violationIds: [],
    },
  ];
  const edges: SrijikaArchitectureGraphEdge[] = [];
  const violations: SrijikaArchitectureGraphViolation[] = [];
  const violationIdsByNode = new Map<string, string[]>();
  const decisionsByOwner = new Map<
    string,
    {
      ownerKind: ReactMigrationOwnerKind;
      ownerName: string;
      ownerPath: string;
      decisions: ReactMigrationOwnershipDecision[];
    }
  >();
  for (const decision of session.plan.ownership) {
    const current = decisionsByOwner.get(decision.ownerId) ?? {
      ownerKind: decision.ownerKind,
      ownerName: decision.ownerName,
      ownerPath: decision.ownerPath,
      decisions: [],
    };
    current.decisions.push(decision);
    decisionsByOwner.set(decision.ownerId, current);
  }
  const hasFeature = [...decisionsByOwner.values()].some(({ ownerKind }) =>
    ['feature', 'slot', 'part'].includes(ownerKind),
  );
  const hasShared = [...decisionsByOwner.values()].some(({ ownerKind }) =>
    ownerKind.startsWith('shared-'),
  );
  const hasProject = [...decisionsByOwner.values()].some(
    ({ ownerKind }) => ownerKind === 'project',
  );
  for (const [id, label] of [
    ...(hasFeature ? ([['group:features', 'Features']] as const) : []),
    ...(hasShared ? ([['group:shared', 'Shared']] as const) : []),
    ...(hasProject ? ([['group:project', 'Project']] as const) : []),
  ]) {
    nodes.push({
      id,
      kind: 'group',
      label,
      subtitle: 'Ownership group',
      parentId: 'app',
      targetPaths: [],
      imports: [],
      exports: [],
      violationIds: [],
    });
    edges.push({
      id: `hierarchy:app:${id}`,
      source: 'app',
      target: id,
      kind: 'hierarchy',
      label: '',
    });
  }
  const ownerIdByPath = new Map(
    [...decisionsByOwner.entries()].map(([ownerId, { ownerPath }]) => [ownerPath, ownerId]),
  );
  const inspectedTargetPaths = new Set(
    targetInspection?.modules.map(({ relativePath }) => relativePath) ?? [],
  );
  const inspectedSources = new Set(
    session.mappings
      .filter(
        (mapping) =>
          mapping.targetPaths.length > 0 &&
          mapping.targetPaths.every((path) => inspectedTargetPaths.has(path)),
      )
      .map(({ sourcePath }) => sourcePath),
  );
  for (const [ownerId, owner] of [...decisionsByOwner.entries()].sort(([, left], [, right]) =>
    left.ownerPath.localeCompare(right.ownerPath),
  )) {
    const roles = [...new Set(owner.decisions.map(({ role }) => role))].sort();
    const parentId = parentOwnerId(owner.ownerKind, owner.ownerPath, ownerIdByPath);
    nodes.push({
      id: ownerId,
      kind: 'owner',
      label: owner.ownerName,
      subtitle: `${owner.ownerKind} · ${roles.join(', ')}`,
      parentId,
      ownerId,
      ownerKind: owner.ownerKind,
      targetPaths: [
        ...new Set(owner.decisions.flatMap(({ canonicalTargetPaths }) => canonicalTargetPaths)),
      ],
      imports: [],
      exports: [],
      violationIds: [],
    });
    edges.push({
      id: `hierarchy:${parentId}:${ownerId}`,
      source: parentId,
      target: ownerId,
      kind: 'hierarchy',
      label: owner.ownerKind,
    });
    for (const decision of owner.decisions) {
      if (inspectedSources.has(decision.sourcePath)) continue;
      nodes.push({
        id: fileNodeId(decision.sourcePath),
        kind: 'file',
        label: decision.sourcePath.split('/').at(-1) ?? decision.sourcePath,
        subtitle: `${decision.role} · ${decision.sourcePath}`,
        parentId: ownerId,
        ownerId,
        ownerKind: owner.ownerKind,
        role: decision.role,
        sourcePath: decision.sourcePath,
        stage: 'planned-source',
        targetPaths: decision.canonicalTargetPaths,
        imports: sourceImports(decision.dependencies),
        exports: [],
        violationIds: [],
      });
      edges.push({
        id: `hierarchy:${ownerId}:${fileNodeId(decision.sourcePath)}`,
        source: ownerId,
        target: fileNodeId(decision.sourcePath),
        kind: 'hierarchy',
        label: decision.role,
      });
    }
  }

  const ownerKindById = new Map(
    session.plan.ownership.map(({ ownerId, ownerKind }) => [ownerId, ownerKind]),
  );
  for (const module of targetInspection?.modules ?? []) {
    const ownerId = module.ownerIds.find((candidate) => decisionsByOwner.has(candidate));
    const parentId = ownerId ?? 'app';
    const role = module.roles[0];
    const ownerKind = ownerId === undefined ? undefined : ownerKindById.get(ownerId);
    nodes.push({
      id: targetNodeId(module.relativePath),
      kind: 'file',
      label: module.relativePath.split('/').at(-1) ?? module.relativePath,
      subtitle: `${role ?? 'unowned'} · converted target · ${module.relativePath}`,
      parentId,
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(ownerKind === undefined ? {} : { ownerKind }),
      ...(role === undefined ? {} : { role }),
      targetPath: module.relativePath,
      stage: 'converted-target',
      targetPaths: [module.relativePath],
      imports: module.imports.map((item) => ({
        specifier: item.specifier,
        kind: item.kind,
        ...(item.resolvedTargetPath === undefined ? {} : { resolvedPath: item.resolvedTargetPath }),
        ...(item.packageName === undefined ? {} : { packageName: item.packageName }),
      })),
      exports: module.exports,
      violationIds: [],
    });
    edges.push({
      id: `hierarchy:${parentId}:${targetNodeId(module.relativePath)}`,
      source: parentId,
      target: targetNodeId(module.relativePath),
      kind: 'hierarchy',
      label: role ?? 'unowned',
    });
  }

  const decisionBySource = new Map(
    session.plan.ownership.map((decision) => [decision.sourcePath, decision]),
  );
  const graphNodeIds = new Set(nodes.map(({ id }) => id));
  for (const decision of session.plan.ownership) {
    for (const dependency of decision.dependencies) {
      if (dependency.kind === 'unresolved-source') {
        const id = `unresolved:${decision.sourcePath}:${dependency.specifier}`;
        const nodeIds = [fileNodeId(decision.sourcePath), decision.ownerId];
        violations.push({
          id,
          severity: 'error',
          message: `${decision.sourcePath} has an unresolved source import: ${dependency.specifier}`,
          nodeIds,
        });
        for (const nodeId of nodeIds)
          violationIdsByNode.set(nodeId, [...(violationIdsByNode.get(nodeId) ?? []), id]);
        continue;
      }
      if (dependency.kind !== 'source' || !dependency.resolvedSourcePath) continue;
      const targetDecision = decisionBySource.get(dependency.resolvedSourcePath);
      if (!targetDecision) continue;
      if (
        !graphNodeIds.has(fileNodeId(decision.sourcePath)) ||
        !graphNodeIds.has(fileNodeId(dependency.resolvedSourcePath))
      ) {
        continue;
      }
      const kind = dependencyKind(
        decision.ownerId,
        targetDecision.ownerId,
        targetDecision.ownerKind,
      );
      edges.push({
        id: `import:${decision.sourcePath}:${dependency.resolvedSourcePath}:${dependency.specifier}`,
        source: fileNodeId(decision.sourcePath),
        target: fileNodeId(dependency.resolvedSourcePath),
        kind,
        label: dependency.specifier,
      });
    }
  }
  const targetModuleByPath = new Map(
    (targetInspection?.modules ?? []).map((module) => [module.relativePath, module]),
  );
  for (const module of targetInspection?.modules ?? []) {
    for (const dependency of module.imports) {
      if (dependency.kind !== 'target' || !dependency.resolvedTargetPath) continue;
      const targetModule = targetModuleByPath.get(dependency.resolvedTargetPath);
      if (!targetModule) continue;
      const sourceOwnerId = module.ownerIds[0] ?? '';
      const targetOwnerId = targetModule.ownerIds[0] ?? '';
      const targetOwnerKind = ownerKindById.get(targetOwnerId) ?? 'project';
      edges.push({
        id: `target-import:${module.relativePath}:${dependency.resolvedTargetPath}:${dependency.specifier}`,
        source: targetNodeId(module.relativePath),
        target: targetNodeId(dependency.resolvedTargetPath),
        kind: dependencyKind(sourceOwnerId, targetOwnerId, targetOwnerKind),
        label: dependency.specifier,
      });
    }
  }

  const addSessionViolation = (
    prefix: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
  ): void => {
    const matchingNodes = nodes
      .filter(
        ({ sourcePath, targetPath, targetPaths }) =>
          (sourcePath !== undefined && message.includes(sourcePath)) ||
          (targetPath !== undefined && message.includes(targetPath)) ||
          targetPaths.some((path) => message.includes(path)),
      )
      .flatMap((node) => [node.id, ...(node.ownerId ? [node.ownerId] : [])]);
    const nodeIds = [...new Set(matchingNodes.length > 0 ? matchingNodes : ['app'])];
    const id = `${prefix}:${violations.length}`;
    violations.push({ id, severity, message, nodeIds });
    for (const nodeId of nodeIds) {
      violationIdsByNode.set(nodeId, [...(violationIdsByNode.get(nodeId) ?? []), id]);
    }
  };
  for (const message of session.plan.unsupported) addSessionViolation('unsupported', message);
  for (const message of session.verification?.errors ?? [])
    addSessionViolation('verification', message);
  for (const message of session.verification?.wrapperFindings ?? [])
    addSessionViolation('wrapper', message);
  for (const sourcePath of session.verification?.unmappedSourcePaths ?? [])
    addSessionViolation('unmapped', `Unmapped source: ${sourcePath}`);
  for (const targetPath of session.verification?.unownedTargetPaths ?? [])
    addSessionViolation('unowned', `Unowned target: ${targetPath}`);
  for (const message of targetInspection?.graphFindings ?? [])
    addSessionViolation('live-target-graph', message);
  for (const message of targetInspection?.wrapperFindings ?? [])
    addSessionViolation('live-target-wrapper', message);
  for (const targetPath of targetInspection?.unownedTargetPaths ?? [])
    addSessionViolation('live-target-unowned', `Unowned target: ${targetPath}`);
  if (session.verification) {
    if (!session.verification.srijikaDiagnosticsValid)
      addSessionViolation('srijika-diagnostics', 'Target has unresolved Srijika diagnostics.');
    if (!session.verification.architectureValid)
      addSessionViolation('architecture', 'Target Srijika architecture validation failed.');
    if (!session.verification.targetGraphValid)
      addSessionViolation('target-graph', 'Target import/dependency graph is not closed.');
    if (!session.verification.nativeCompletionValid)
      addSessionViolation('native-completion', 'Native migration completion obligations remain.');
    if (!session.verification.environmentContractValid)
      addSessionViolation('environment', 'Target environment contract is incomplete.');
  }
  for (const applied of session.appliedSlices) {
    const planned = session.plan.slices.find(({ id }) => id === applied.id);
    const evidencePath = planned?.sourcePaths[0];
    const messagePrefix = evidencePath ? `${evidencePath}: ` : '';
    if (applied.verification && !applied.verification.srijikaDiagnosticsValid) {
      addSessionViolation(
        'slice-diagnostics',
        `${messagePrefix}${applied.title} has unresolved Srijika diagnostics.`,
      );
    }
    if (applied.verification && !applied.verification.architectureValid) {
      addSessionViolation(
        'slice-architecture',
        `${messagePrefix}${applied.title} failed architecture cross-verification.`,
      );
    }
    for (const command of applied.verification?.commands ?? []) {
      if (command.status === 'failed') {
        addSessionViolation(
          'slice-command',
          `${messagePrefix}${applied.title} ${command.name} failed${command.details ? `: ${command.details}` : '.'}`,
        );
      }
    }
  }

  const finalizedNodes = nodes.map((node) => ({
    ...node,
    violationIds: Object.freeze(violationIdsByNode.get(node.id) ?? []),
  }));
  const importEdges = edges.filter(({ kind }) => kind !== 'hierarchy');
  return Object.freeze({
    sessionId: session.id,
    phase: session.phase,
    sourceRoot: session.sourceRoot,
    targetRoot: session.targetRoot,
    nodes: Object.freeze(finalizedNodes),
    edges: Object.freeze(edges),
    violations: Object.freeze(violations),
    stats: Object.freeze({
      owners: finalizedNodes.filter(({ kind }) => kind === 'owner').length,
      files: finalizedNodes.filter(({ kind }) => kind === 'file').length,
      imports: importEdges.length,
      crossOwnerImports: importEdges.filter(({ kind }) => kind === 'cross-owner').length,
      sharedImports: importEdges.filter(({ kind }) => kind === 'shared').length,
      violations: violations.length,
    }),
  });
}

export function buildSrijikaArchitectureOwnerDetail(
  ownerId: string,
  session: ReactMigrationSession,
  contextItems: readonly ReactMigrationSliceContextItem[],
  errors: readonly string[] = [],
): SrijikaArchitectureOwnerDetail {
  const expected = new Map(
    session.plan.ownership
      .filter((decision) => decision.ownerId === ownerId)
      .map((decision) => [decision.sourcePath, decision]),
  );
  const contextByPath = new Map(contextItems.map((item) => [item.sourcePath, item]));
  return Object.freeze({
    ownerId,
    items: Object.freeze(
      [...expected.values()].map((decision) => {
        const context = contextByPath.get(decision.sourcePath);
        return Object.freeze({
          sourcePath: decision.sourcePath,
          category:
            context?.category ??
            session.inventory.files.find(({ relativePath }) => relativePath === decision.sourcePath)
              ?.category ??
            'unknown',
          role: decision.role,
          targetPaths: decision.canonicalTargetPaths,
          imports: sourceImports(context?.imports ?? decision.dependencies),
          exports: context?.exports ?? [],
        });
      }),
    ),
    errors: Object.freeze([...errors]),
  });
}
