import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import type { UiDocument, UiNode, ValueShape, ValueType } from '@srijika/contracts';
import {
  createSrijikaProjectFileMap,
  createSrijikaUiSourcePair,
} from '@srijika/project-scaffold/templates';
import {
  bindSrijikaNodeEvent,
  insertSrijikaContractMember,
  insertSrijikaJsxElement,
  insertSrijikaNodeProp,
  replaceSrijikaNodeProp,
  replaceSrijikaTextNode,
  type SrijikaDiagnostic,
  type SrijikaQuickFix,
  type SrijikaSourceMap,
  type SrijikaSourceSpan,
} from '@srijika/tsx-compiler';

import {
  buildCodeProject,
  chooseAndCreateCodeProject,
  chooseAndLoadTsxSource,
  chooseAndOpenCodeProject,
  chooseAndRunReactMigration,
  createCodeProjectUiSource,
  describeOwnerTestCommand,
  describeReactMigrationCommand,
  getLaunchProject,
  type CodeProjectEntry,
  type CodeProjectPreviewAsset,
  type CodeProjectPreviewStylesheet,
  getProjectRuntimeStatus,
  installProjectDependencies,
  isTauriDesktop,
  loadCodeProjectArchitectureSources,
  loadCodeProjectPreviewStyles,
  loadTsxSource,
  openCodeProject,
  openCodeProjectApp,
  openCodeProjectPreview,
  openInVsCode,
  openBrowserPreview,
  ownerTestEvidenceSummary,
  type OwnerTestEvidenceSummary,
  type ProjectRuntimeStatus,
  runOwnerTests,
  saveTsxSource,
  scanCodeProject,
  scaffoldCodeProjectStructure,
  startCodeProject,
  stopCodeProject,
} from '../../lib/project-service';
import {
  analyzeCodeProjectFileMap,
  architectureConfigFromFileMap,
  frameworkComponentsFromFileMap,
  type CodeProjectArchitectureConfig,
  type CodeProjectArchitectureDiagnostic,
} from '../../lib/architecture-diagnostics';
import { projectServiceErrorMessage } from '../../lib/error-message';
import {
  nextPreviewRoutes,
  resolveNextPreviewRoute,
  sameOriginPreviewUrl,
} from '../../lib/next-preview-routes';
import { persistPreviewDocument, persistPreviewViewportSize } from '../../lib/preview-channel';
import {
  resolvedCodeProjectTypeModules,
  useCodeProjectStore,
} from '../../store/code-project-store';
import {
  loadProjectSessionRecovery,
  projectDisplayName,
  projectEntryForPath,
  type ProjectSessionRecovery,
  useProjectSessionStore,
} from '../../store/project-session-store';
import { VIEWPORT_PRESET_SIZES, useStudioStore } from '../../store/studio-store';
import { FullscreenPreview } from '../FullscreenPreview';
import { SettingsDialog } from '../SettingsDialog';
import { CodeFirstInspectorPanel } from './CodeFirstInspectorPanel';
import { CodeFirstPreviewFrame } from './CodeFirstPreviewFrame';
import { CreateUiSourceDialog, type CreateUiSourceInput } from './CreateUiSourceDialog';
import {
  CreateStructureItemDialog,
  structureOwnerFromFolder,
  type CreateStructureItemInput,
  type StructureOwnerContext,
} from './CreateStructureItemDialog';
import {
  LiveCodeProjectFrame,
  type LivePreviewRuntimeState,
  type LivePreviewSourceLocation,
} from './LiveCodeProjectFrame';
import { OwnerTestEvidenceDialog } from './OwnerTestEvidenceDialog';
import { codeProjectEntriesFromFileMap, ProjectExplorer } from './ProjectExplorer';
import { ProjectWelcomeScreen } from './ProjectWelcomeScreen';
import { StructureGuideDialog } from './StructureGuideDialog';
import { UiNodesPanel } from './UiNodesPanel';
import {
  VisualComponentPalette,
  visualComponentById,
  type VisualComponentDefinition,
} from './VisualComponentPalette';
import { intrinsicElementTag, uiNodeChildren } from './ui-node-presentation';

const EXTERNAL_SOURCE_POLL_MS = 1_500;
const NAVIGATOR_ORDER_KEY = 'srijika-studio:navigator-order:v1';
type NavigatorPanelId = 'project' | 'components' | 'nodes';
const DEFAULT_NAVIGATOR_ORDER: readonly NavigatorPanelId[] = ['project', 'components', 'nodes'];
const DEFAULT_ARCHITECTURE_ROOTS: CodeProjectArchitectureConfig = architectureConfigFromFileMap({});

function initialNavigatorOrder(): readonly NavigatorPanelId[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(NAVIGATOR_ORDER_KEY) ?? 'null') as unknown;
    if (
      Array.isArray(value) &&
      value.length === DEFAULT_NAVIGATOR_ORDER.length &&
      DEFAULT_NAVIGATOR_ORDER.every((id) => value.includes(id))
    ) {
      return value as NavigatorPanelId[];
    }
  } catch {
    // A corrupt preference must never block the editor.
  }
  return DEFAULT_NAVIGATOR_ORDER;
}

function closestVisualContainer(document: UiDocument | null, nodeId: string): string | null {
  if (!document) return null;
  const node = document.nodes[nodeId];
  if (
    node?.kind === 'element' &&
    (node.componentId === 'srijika.page' || node.componentId === 'srijika.container')
  ) {
    return nodeId;
  }
  const visited = new Set<string>();
  const findParent = (parentId: string): string | null => {
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    const parent = document.nodes[parentId];
    if (!parent) return null;
    if (uiNodeChildren(parent).includes(nodeId)) return parentId;
    for (const childId of uiNodeChildren(parent)) {
      const match = findParent(childId);
      if (match) return match;
    }
    return null;
  };
  const directParent = findParent(document.rootNodeId);
  return directParent ? closestVisualContainer(document, directParent) : null;
}

function errorMessage(error: unknown): string {
  return projectServiceErrorMessage(error);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function sourceOffsetAt(source: string, line: number, column: number): number | null {
  if (line < 1 || column < 1) return null;
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line) {
    const nextLine = source.indexOf('\n', offset);
    if (nextLine < 0) return null;
    offset = nextLine + 1;
    currentLine += 1;
  }
  const lineEnd = source.indexOf('\n', offset);
  const maximum = lineEnd < 0 ? source.length : lineEnd;
  const target = offset + column - 1;
  return target <= maximum ? target : null;
}

function diagnosticNodeId(
  sourceMap: SrijikaSourceMap | null,
  diagnostic: SrijikaDiagnostic,
): string | null {
  if (!sourceMap) return null;
  const containing = Object.entries(sourceMap.nodes)
    .filter(([, span]) => span.start <= diagnostic.span.start && span.end >= diagnostic.span.end)
    .sort(([, left], [, right]) => left.end - left.start - (right.end - right.start));
  return containing[0]?.[0] ?? null;
}

function nodeIdAtSourceLocation(
  source: string,
  nodes: Readonly<Record<string, SrijikaSourceSpan>>,
  line: number,
  column: number,
): string | null {
  const offset = sourceOffsetAt(source, line, column);
  if (offset === null) return null;
  return (
    Object.entries(nodes)
      .filter(([, span]) => span.start <= offset && offset < span.end)
      .sort(([, left], [, right]) => left.end - left.start - (right.end - right.start))[0]?.[0] ??
    null
  );
}

type RuntimeAction = 'install' | 'run' | 'stop' | 'build';

function runtimeLabel(
  projectRoot: string | null,
  status: ProjectRuntimeStatus | null,
  action: RuntimeAction | null,
  runtimeError: string | null,
): string {
  if (!projectRoot) return 'Desktop project required';
  if (action === 'install') return 'Installing dependencies…';
  if (action === 'run') return 'Starting application…';
  if (action === 'stop') return 'Stopping application…';
  if (action === 'build') return 'Building application…';
  if (runtimeError) return runtimeError;
  if (!status) return 'Checking toolchain…';
  if (status.running) {
    return status.devServer.ready
      ? `Running on port ${status.port ?? '…'}`
      : `Starting on port ${status.port ?? '…'}`;
  }
  if (status.devServer.state === 'exited') {
    const output = status.devServer.stderr.trim() || status.devServer.stdout.trim();
    const detail = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const exitCode = status.devServer.exitCode;
    return `App exited${exitCode === null ? '' : ` (code ${exitCode})`}${detail ? ` — ${detail.slice(0, 140)}` : ''}`;
  }
  switch (status.dependencyState) {
    case 'missingLockfile':
      return 'Lockfile missing';
    case 'notInstalled':
      return 'Dependencies not installed';
    case 'outdated':
      return 'Dependencies need sync';
    case 'ready':
      return 'Ready to run';
  }
}

function scaffold() {
  const files = createSrijikaProjectFileMap();
  const configSource = files['srijika.config.json'];
  if (!configSource) throw new Error('Generated project is missing srijika.config.json');
  const config = JSON.parse(configSource) as {
    entry?: unknown;
    preview?: { props?: unknown };
  };
  if (typeof config.entry !== 'string')
    throw new Error('Generated srijika.config.json is missing its TSX entry');
  const entrySource = files[config.entry];
  if (!entrySource) throw new Error(`Generated project is missing ${config.entry}`);
  const previewProps =
    typeof config.preview?.props === 'object' && config.preview.props !== null
      ? (config.preview.props as Readonly<Record<string, unknown>>)
      : {};
  return { files, entryPath: config.entry, entrySource, previewProps };
}

function valueForShape(shape: ValueShape, name: string): unknown {
  switch (shape.kind) {
    case 'string':
      return /(?:url|src|avatar|image)/i.test(name)
        ? '/profile-placeholder.svg'
        : name.replace(/([a-z])([A-Z])/g, '$1 $2');
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'color':
      return '#6366f1';
    case 'array':
      return [];
    case 'object':
      return Object.fromEntries(
        Object.entries(shape.fields).map(([fieldName, field]) => [
          fieldName,
          valueForShape(field.shape, fieldName),
        ]),
      );
    default:
      return undefined;
  }
}

function fallbackShape(valueType: ValueType): ValueShape {
  switch (valueType) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'color':
      return { kind: valueType };
    case 'array':
      return { kind: 'array', item: { kind: 'unknown' } };
    case 'object':
      return { kind: 'object', fields: {}, additionalProperties: true };
    default:
      return { kind: 'unknown' };
  }
}

function cssClassPreviewValue(
  name: string,
  stylesheets: readonly CodeProjectPreviewStylesheet[],
): string | undefined {
  if (!/className$/i.test(name)) return undefined;
  const classNames = stylesheets.flatMap((stylesheet) =>
    [...stylesheet.source.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((match) => match[1] ?? ''),
  );
  const baseClass = classNames.find(Boolean);
  if (!baseClass) return undefined;
  const modifier = classNames.find((className) => className.startsWith(`${baseClass}--`));
  return /^pageClassName$/i.test(name) && modifier ? `${baseClass} ${modifier}` : baseClass;
}

function previewSymbols(
  document: UiDocument,
  designProps: Readonly<Record<string, unknown>>,
  stylesheets: readonly CodeProjectPreviewStylesheet[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.values(document.symbols)
      .filter((symbol) => symbol.valueType !== 'event')
      .map((symbol) => [
        symbol.id,
        (Object.hasOwn(designProps, symbol.name) ? designProps[symbol.name] : undefined) ??
          symbol.defaultValue ??
          cssClassPreviewValue(symbol.name, stylesheets) ??
          valueForShape(symbol.valueShape ?? fallbackShape(symbol.valueType), symbol.name),
      ]),
  );
}

function literalTextOfNode(node: UiNode | null): string | null {
  if (!node) return null;
  if (
    node.kind === 'text' &&
    node.value.kind === 'literal' &&
    typeof node.value.value === 'string'
  ) {
    return node.value.value;
  }
  if (node.kind !== 'element') return null;
  const propName = node.componentId === 'srijika.button' ? 'label' : 'text';
  const expression = node.props[propName];
  return expression?.kind === 'literal' && typeof expression.value === 'string'
    ? expression.value
    : null;
}

type StudioProblem =
  | { kind: 'source'; index: number; diagnostic: SrijikaDiagnostic }
  | { kind: 'architecture'; index: number; diagnostic: CodeProjectArchitectureDiagnostic };

function problemKey(problem: StudioProblem): string {
  return `${problem.kind}:${problem.index}`;
}

function problemDisplayPath(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/');
  const sourceMarker = normalized.lastIndexOf('/src/');
  return sourceMarker >= 0 ? normalized.slice(sourceMarker + 1) : normalized;
}

function projectEntryForDiagnostic(
  entries: readonly CodeProjectEntry[],
  fileName: string,
): CodeProjectEntry | null {
  const normalizedFileName = fileName.replaceAll('\\', '/');
  return (
    entries.find((entry) => {
      if (entry.kind !== 'file') return false;
      const path = entry.path.replaceAll('\\', '/');
      const relativePath = entry.relativePath.replaceAll('\\', '/');
      return (
        path === normalizedFileName ||
        relativePath === normalizedFileName ||
        normalizedFileName.endsWith(`/${relativePath}`)
      );
    }) ?? null
  );
}

interface DiagnosticListProps {
  problems: readonly StudioProblem[];
  selectedKey: string | null;
  onSelect: (problem: StudioProblem) => void;
}

function DiagnosticList({ problems, selectedKey, onSelect }: DiagnosticListProps) {
  if (problems.length === 0) {
    return (
      <div className="code-first-empty">No Srijika diagnostics. The source contract is valid.</div>
    );
  }
  return (
    <div>
      {problems.map((problem) => (
        <button
          key={`${problemKey(problem)}-${problem.diagnostic.code}-${problem.diagnostic.span.start}`}
          type="button"
          className={`code-first-diagnostic${
            problem.kind === 'architecture' && problem.diagnostic.severity === 'warning'
              ? ' is-warning'
              : ''
          }${selectedKey === problemKey(problem) ? ' is-selected' : ''}`}
          onClick={() => onSelect(problem)}
        >
          <span className="code-first-diagnostic-code">{problem.diagnostic.code}</span>
          <span className="code-first-diagnostic-message">{problem.diagnostic.message}</span>
          <span className="code-first-diagnostic-position">
            {problemDisplayPath(problem.diagnostic.fileName)}:{problem.diagnostic.span.line}:
            {problem.diagnostic.span.column}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CodeFirstStudio() {
  const hasLoadedSource = useCodeProjectStore((state) => state.hasLoadedSource);
  const fileName = useCodeProjectStore((state) => state.fileName);
  const sourcePath = useCodeProjectStore((state) => state.sourcePath);
  const source = useCodeProjectStore((state) => state.source);
  const diskHash = useCodeProjectStore((state) => state.diskHash);
  const dirty = useCodeProjectStore((state) => state.dirty);
  const compileStatus = useCodeProjectStore((state) => state.compileStatus);
  const diagnostics = useCodeProjectStore((state) => state.diagnostics);
  const sourceMap = useCodeProjectStore((state) => state.sourceMap);
  const document = useCodeProjectStore((state) => state.lastValidDocument);
  const componentContract = useCodeProjectStore((state) => state.componentContract);
  const framework = useCodeProjectStore((state) => state.framework);
  const previewStale = useCodeProjectStore((state) => state.previewStale);
  const selectedDiagnosticIndex = useCodeProjectStore((state) => state.selectedDiagnosticIndex);
  const architectureDiagnostics = useCodeProjectStore((state) => state.architectureDiagnostics);
  const architectureRecommendations = useCodeProjectStore(
    (state) => state.architectureRecommendations,
  );
  const architectureCheckedFileCount = useCodeProjectStore(
    (state) => state.architectureCheckedFileCount,
  );
  const selectedArchitectureDiagnosticIndex = useCodeProjectStore(
    (state) => state.selectedArchitectureDiagnosticIndex,
  );
  const loadSource = useCodeProjectStore((state) => state.loadSource);
  const updateSource = useCodeProjectStore((state) => state.updateSource);
  const markSaved = useCodeProjectStore((state) => state.markSaved);
  const selectDiagnostic = useCodeProjectStore((state) => state.selectDiagnostic);
  const setArchitectureAnalysis = useCodeProjectStore((state) => state.setArchitectureAnalysis);
  const clearArchitectureAnalysis = useCodeProjectStore((state) => state.clearArchitectureAnalysis);
  const selectArchitectureDiagnostic = useCodeProjectStore(
    (state) => state.selectArchitectureDiagnostic,
  );
  const applyQuickFix = useCodeProjectStore((state) => state.applyQuickFix);
  const setResolvedTypeModules = useCodeProjectStore((state) => state.setResolvedTypeModules);
  const setProjectComponents = useCodeProjectStore((state) => state.setProjectComponents);

  const projectRoot = useProjectSessionStore((state) => state.rootPath);
  const projectDisplay = useProjectSessionStore((state) => state.displayName);
  const projectEntries = useProjectSessionStore((state) => state.entries);
  const changedUiSourcePaths = useProjectSessionStore(
    (state) => state.externallyChangedUiSourcePaths,
  );
  const selectedProjectPath = useProjectSessionStore((state) => state.selectedPath);
  const activeUiSourcePath = useProjectSessionStore((state) => state.activeUiSourcePath);
  const projectIndexStatus = useProjectSessionStore((state) => state.indexStatus);
  const projectIndexError = useProjectSessionStore((state) => state.indexError);
  const projectIndexTruncated = useProjectSessionStore((state) => state.truncated);
  const attachProject = useProjectSessionStore((state) => state.attachProject);
  const replaceProjectIndex = useProjectSessionStore((state) => state.replaceIndex);
  const setProjectIndexLoading = useProjectSessionStore((state) => state.setIndexLoading);
  const setProjectIndexError = useProjectSessionStore((state) => state.setIndexError);
  const selectProjectPath = useProjectSessionStore((state) => state.selectPath);
  const activateUiSource = useProjectSessionStore((state) => state.activateUiSource);
  const resetProjectSession = useProjectSessionStore((state) => state.resetSession);

  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const selectNode = useStudioStore((state) => state.selectNode);
  const viewport = useStudioStore((state) => state.viewport);
  const customViewportSize = useStudioStore((state) => state.customViewportSize);
  const [message, setMessage] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<ProjectRuntimeStatus | null>(null);
  const [runtimeAction, setRuntimeAction] = useState<RuntimeAction | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [selectedNextRouteId, setSelectedNextRouteId] = useState<string | null>(null);
  const [nextRouteValues, setNextRouteValues] = useState<Readonly<Record<string, string>>>({});
  const [livePreviewRuntimeState, setLivePreviewRuntimeState] =
    useState<LivePreviewRuntimeState | null>(null);
  const [recoverableProject, setRecoverableProject] = useState<ProjectSessionRecovery | null>(() =>
    isTauriDesktop() ? loadProjectSessionRecovery() : null,
  );
  const [openingApp, setOpeningApp] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [previewStylesheets, setPreviewStylesheets] = useState<
    readonly CodeProjectPreviewStylesheet[]
  >([]);
  const [previewStylesError, setPreviewStylesError] = useState<string | null>(null);
  const [previewAssets, setPreviewAssets] = useState<readonly CodeProjectPreviewAsset[]>([]);
  const [previewDesignProps, setPreviewDesignProps] = useState<Readonly<Record<string, unknown>>>(
    {},
  );
  const [textDraftState, setTextDraftState] = useState<{
    nodeId: string;
    value: string;
  } | null>(null);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [structureGuideOpen, setStructureGuideOpen] = useState(false);
  const [ownerTestsBusy, setOwnerTestsBusy] = useState(false);
  const [ownerTestEvidence, setOwnerTestEvidence] = useState<OwnerTestEvidenceSummary | null>(null);
  const [architectureRoots, setArchitectureRoots] = useState<CodeProjectArchitectureConfig>(
    DEFAULT_ARCHITECTURE_ROOTS,
  );
  const [projectChooserOpen, setProjectChooserOpen] = useState(false);
  const [componentSelectionFile, setComponentSelectionFile] = useState<string | null>(null);
  const [sourceVisible, setSourceVisible] = useState(true);
  const [problemsExpanded, setProblemsExpanded] = useState(true);
  const [navigatorOrder, setNavigatorOrder] =
    useState<readonly NavigatorPanelId[]>(initialNavigatorOrder);
  const [draggedNavigatorPanel, setDraggedNavigatorPanel] = useState<NavigatorPanelId | null>(null);
  const [draggedComponentId, setDraggedComponentId] = useState<string | null>(null);
  const [createDialogRequest, setCreateDialogRequest] = useState<{
    folder?: string;
  } | null>(null);
  const [structureDialogOwner, setStructureDialogOwner] = useState<StructureOwnerContext | null>(
    null,
  );
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const browserFileInputRef = useRef<HTMLInputElement>(null);
  const projectScanInFlightRef = useRef<{
    generation: number;
    rootPath: string;
  } | null>(null);
  const projectSessionGenerationRef = useRef(0);
  const sourceLoadRequestRef = useRef(0);
  const runtimeActionRequestRef = useRef(0);
  const previewStylesRequestRef = useRef(0);
  const architectureSourcesRequestRef = useRef(0);
  const browserProjectFilesRef = useRef<Readonly<Record<string, string>> | null>(null);
  const launchProjectHandledRef = useRef(false);

  const problems: readonly StudioProblem[] = [
    ...diagnostics.map((diagnostic, index) => ({
      kind: 'source' as const,
      index,
      diagnostic,
    })),
    ...architectureDiagnostics.map((diagnostic, index) => ({
      kind: 'architecture' as const,
      index,
      diagnostic,
    })),
  ];
  const architectureErrorCount = architectureDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  ).length;
  const blockingProblemCount = diagnostics.length + architectureErrorCount;
  const selectedProblem: StudioProblem | null =
    selectedDiagnosticIndex !== null && diagnostics[selectedDiagnosticIndex]
      ? {
          kind: 'source',
          index: selectedDiagnosticIndex,
          diagnostic: diagnostics[selectedDiagnosticIndex],
        }
      : selectedArchitectureDiagnosticIndex !== null &&
          architectureDiagnostics[selectedArchitectureDiagnosticIndex]
        ? {
            kind: 'architecture',
            index: selectedArchitectureDiagnosticIndex,
            diagnostic: architectureDiagnostics[selectedArchitectureDiagnosticIndex],
          }
        : null;
  const selectedDiagnostic = selectedProblem?.diagnostic ?? null;
  const selectedProblemKey = selectedProblem ? problemKey(selectedProblem) : null;
  const selectedDiagnosticFixes =
    selectedProblem?.kind === 'source' ? (selectedProblem.diagnostic.quickFixes ?? []) : [];
  const selectedDiagnosticPrimaryFix =
    selectedDiagnosticFixes.find((fix) => fix.kind === 'bind-event-prop') ??
    selectedDiagnosticFixes[0];
  const selectedDiagnosticOtherFixes = selectedDiagnosticFixes.filter(
    (fix) => fix !== selectedDiagnosticPrimaryFix,
  );
  const componentFunctionSelected = componentSelectionFile === fileName;
  const selectedNode = document?.nodes[selectedNodeId] ?? null;
  const visualTargetNodeId = closestVisualContainer(document, selectedNodeId);
  const visualTargetNode = visualTargetNodeId ? document?.nodes[visualTargetNodeId] : null;
  const visualTargetLabel =
    visualTargetNode?.kind === 'element'
      ? `<${intrinsicElementTag(visualTargetNode)}>`
      : (document?.name ?? 'a layout container');
  const selectedProjectEntry = projectEntryForPath(projectEntries, selectedProjectPath);
  const activeUiSourceEntry = projectEntryForPath(projectEntries, activeUiSourcePath);
  const fullAppStatus = runtimeLabel(projectRoot, runtimeStatus, runtimeAction, runtimeError);
  const fullAppHasError = runtimeError !== null || runtimeStatus?.devServer.state === 'exited';
  const desktopMode = isTauriDesktop();
  const discoveredNextRoutes = useMemo(() => nextPreviewRoutes(projectEntries), [projectEntries]);
  const selectedNextRoute =
    discoveredNextRoutes.find(({ id }) => id === selectedNextRouteId) ??
    discoveredNextRoutes[0] ??
    null;
  let nextPreviewPath = '/';
  let nextPreviewRouteError: string | null = null;
  if (runtimeStatus?.framework === 'next-app-router') {
    if (!selectedNextRoute) {
      nextPreviewRouteError = 'No App Router page was found in the bounded project index.';
    } else {
      try {
        nextPreviewPath = resolveNextPreviewRoute(selectedNextRoute, nextRouteValues);
      } catch (error) {
        nextPreviewRouteError = errorMessage(error);
      }
    }
  }
  const liveProjectBaseUrl =
    desktopMode &&
    projectRoot &&
    runtimeStatus?.running &&
    runtimeStatus.devServer.ready &&
    runtimeStatus.devServer.url
      ? runtimeStatus.devServer.url
      : null;
  const liveProjectUrl =
    liveProjectBaseUrl && !nextPreviewRouteError
      ? runtimeStatus?.framework === 'next-app-router'
        ? sameOriginPreviewUrl(liveProjectBaseUrl, nextPreviewPath)
        : liveProjectBaseUrl
      : null;
  const showFullAppPreview = Boolean(projectRoot && desktopMode);
  const projectRuntimeBlocksTransition =
    runtimeAction !== null || (runtimeStatus?.activeTask ?? null) !== null;
  const projectCreationBlocked =
    busy || runtimeAction !== null || (runtimeStatus?.activeTask ?? null) !== null;
  const standaloneSourceName = hasLoadedSource && !projectDisplay ? baseName(fileName) : null;
  const symbols = useMemo(
    () => (document ? previewSymbols(document, previewDesignProps, previewStylesheets) : {}),
    [document, previewDesignProps, previewStylesheets],
  );
  const selectedLiteralText = literalTextOfNode(selectedNode);
  const selectedLiveSource = activeUiSourceEntry?.isUiSource
    ? sourceMap?.nodes[selectedNodeId]
      ? `${activeUiSourceEntry.relativePath}:${sourceMap.nodes[selectedNodeId].line}:${sourceMap.nodes[selectedNodeId].column}`
      : `${activeUiSourceEntry.relativePath}:1:1`
    : null;
  const livePreviewUiSources = useMemo(
    () => projectEntries.filter((entry) => entry.isUiSource).map((entry) => entry.relativePath),
    [projectEntries],
  );
  const textDraft =
    textDraftState?.nodeId === selectedNodeId ? textDraftState.value : (selectedLiteralText ?? '');
  const canEditSelectedText = useMemo(() => {
    if (previewStale || !sourceMap || !selectedNode || selectedLiteralText === null) return false;
    return replaceSrijikaTextNode(source, sourceMap, selectedNode.id, selectedLiteralText).ok;
  }, [previewStale, selectedLiteralText, selectedNode, source, sourceMap]);

  const invalidateAsyncProjectSession = useCallback((): void => {
    projectSessionGenerationRef.current += 1;
    sourceLoadRequestRef.current += 1;
    runtimeActionRequestRef.current += 1;
    previewStylesRequestRef.current += 1;
    architectureSourcesRequestRef.current += 1;
  }, []);

  const isProjectSessionCurrent = useCallback(
    (generation: number, rootPath: string | null): boolean =>
      projectSessionGenerationRef.current === generation &&
      useProjectSessionStore.getState().rootPath === rootPath,
    [],
  );

  const confirmDiscardVisualEdits = useCallback((action: string): boolean => {
    if (!useCodeProjectStore.getState().dirty) return true;
    return window.confirm(`Discard unsaved Studio-generated visual edits and ${action}?`);
  }, []);

  const closeCreateUiDialog = useCallback((): void => setCreateDialogRequest(null), []);

  const revealSpan = useCallback((span: SrijikaSourceSpan) => {
    const input = sourceInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(span.start, span.end);
    const lineHeight = 20;
    input.scrollTop = Math.max(0, (span.line - 4) * lineHeight);
  }, []);

  const selectNodeAndReveal = useCallback(
    (nodeId: string): void => {
      setComponentSelectionFile(null);
      selectNode(nodeId);
      const span = sourceMap?.nodes[nodeId];
      if (span) window.requestAnimationFrame(() => revealSpan(span));
    },
    [revealSpan, selectNode, sourceMap],
  );

  const chooseDiagnostic = useCallback(
    (index: number, diagnostic: SrijikaDiagnostic) => {
      selectDiagnostic(index);
      setSourceVisible(true);
      const nodeId = diagnosticNodeId(sourceMap, diagnostic);
      if (nodeId) {
        setComponentSelectionFile(null);
        selectNode(nodeId);
      }
      revealSpan(diagnostic.span);
    },
    [revealSpan, selectDiagnostic, selectNode, sourceMap],
  );

  useEffect(() => {
    if (!document || previewStale) return;
    try {
      persistPreviewDocument(document);
    } catch (error) {
      const nextMessage = `Preview sync failed: ${errorMessage(error)}`;
      queueMicrotask(() => setMessage(nextMessage));
    }
  }, [document, previewStale]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnsavedNavigation = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnsavedNavigation);
    return () => window.removeEventListener('beforeunload', preventUnsavedNavigation);
  }, [dirty]);

  useEffect(() => {
    try {
      persistPreviewViewportSize(customViewportSize ?? VIEWPORT_PRESET_SIZES[viewport]);
    } catch (error) {
      const nextMessage = `Preview viewport sync failed: ${errorMessage(error)}`;
      queueMicrotask(() => setMessage(nextMessage));
    }
  }, [customViewportSize, viewport]);

  useEffect(() => {
    if (projectRoot) return;
    const currentFiles = browserProjectFilesRef.current;
    if (!currentFiles) {
      clearArchitectureAnalysis();
      setArchitectureRoots(DEFAULT_ARCHITECTURE_ROOTS);
      setProjectComponents([]);
      return;
    }
    const activeEntry = projectEntryForPath(projectEntries, activeUiSourcePath);
    const nextFiles = activeEntry
      ? {
          ...currentFiles,
          [activeEntry.relativePath]: source,
        }
      : currentFiles;
    browserProjectFilesRef.current = nextFiles;
    const resolvedArchitecture = architectureConfigFromFileMap(nextFiles);
    setArchitectureRoots(resolvedArchitecture);
    setArchitectureAnalysis(analyzeCodeProjectFileMap(nextFiles));
    setProjectComponents(frameworkComponentsFromFileMap(nextFiles));
    setResolvedTypeModules(
      resolvedCodeProjectTypeModules({
        fileName,
        source,
        uiSuffix: resolvedArchitecture.uiSuffix,
        typesSuffix: resolvedArchitecture.typesSuffix,
        sourceByFileName: new Map(
          Object.entries(nextFiles).map(([path, fileSource]) => [path, { source: fileSource }]),
        ),
      }),
    );
  }, [
    activeUiSourcePath,
    clearArchitectureAnalysis,
    fileName,
    projectEntries,
    projectRoot,
    setArchitectureAnalysis,
    setProjectComponents,
    setResolvedTypeModules,
    source,
  ]);

  useEffect(() => {
    const handleError = (event: ErrorEvent): void => {
      setMessage(`Unexpected editor error: ${errorMessage(event.error ?? event.message)}`);
      if (event.cancelable) event.preventDefault();
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
      setMessage(`Unexpected editor error: ${errorMessage(event.reason)}`);
      event.preventDefault();
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const openLoadedSource = useCallback(
    (loaded: { path: string; source: string; hash: string }, activePath = loaded.path) => {
      loadSource({
        fileName: loaded.path,
        sourcePath: loaded.path,
        source: loaded.source,
        diskHash: loaded.hash,
      });
      activateUiSource(activePath);
      setExternalChange(false);
      setMessage(`Opened ${loaded.path}`);
    },
    [activateUiSource, loadSource],
  );

  const refreshProjectIndex = useCallback(
    async (announce = false): Promise<void> => {
      const rootPath = useProjectSessionStore.getState().rootPath;
      if (!rootPath || !isTauriDesktop()) return;
      const generation = projectSessionGenerationRef.current;
      const activeScan = projectScanInFlightRef.current;
      if (activeScan?.rootPath === rootPath && activeScan.generation === generation) return;
      const scanRequest = { generation, rootPath };
      projectScanInFlightRef.current = scanRequest;
      if (announce) setProjectIndexLoading();
      try {
        let architectureTruncated = false;
        let architectureRefreshError: string | null = null;
        const scanned = await scanCodeProject(rootPath);
        if (!scanned || !isProjectSessionCurrent(generation, rootPath)) return;
        replaceProjectIndex({ entries: scanned.entries, truncated: scanned.truncated });

        const stylesRequest = ++previewStylesRequestRef.current;
        try {
          const loadedStyles = await loadCodeProjectPreviewStyles(rootPath);
          if (
            loadedStyles &&
            previewStylesRequestRef.current === stylesRequest &&
            isProjectSessionCurrent(generation, rootPath)
          ) {
            setPreviewStylesheets(loadedStyles.stylesheets);
            setPreviewAssets(loadedStyles.assets);
            setPreviewDesignProps(loadedStyles.designProps);
            setPreviewStylesError(null);
          }
        } catch (error) {
          if (
            previewStylesRequestRef.current === stylesRequest &&
            isProjectSessionCurrent(generation, rootPath)
          ) {
            setPreviewStylesheets([]);
            setPreviewAssets([]);
            setPreviewDesignProps({});
            setPreviewStylesError(errorMessage(error));
          }
        }

        const current = useCodeProjectStore.getState();
        const recoveredActivePath = useProjectSessionStore.getState().activeUiSourcePath;
        const activeEntry =
          scanned.entries.find((entry) => entry.path === current.sourcePath) ??
          scanned.entries.find((entry) => entry.path === recoveredActivePath);
        if (!activeEntry) {
          const fallbackEntry = scanned.entries.find(
            (entry) =>
              entry.path === scanned.entrySourcePath && entry.kind === 'file' && entry.isUiSource,
          );
          if (current.dirty) {
            setExternalChange(true);
            setMessage(
              'The active UI source was removed in VS Code. Save to restore it or reload another UI file.',
            );
          } else if (fallbackEntry) {
            const expectedSourcePath = current.sourcePath;
            const sourceRequest = ++sourceLoadRequestRef.current;
            const loaded = await loadTsxSource(fallbackEntry.path);
            const latest = useCodeProjectStore.getState();
            if (
              loaded &&
              isProjectSessionCurrent(generation, rootPath) &&
              sourceLoadRequestRef.current === sourceRequest &&
              latest.sourcePath === expectedSourcePath &&
              !latest.dirty
            ) {
              openLoadedSource(loaded, fallbackEntry.path);
              setMessage(
                'The previous UI source was removed. Opened the configured project entry.',
              );
            }
          }
        } else if (activeEntry.hash && activeEntry.hash !== current.diskHash) {
          if (current.dirty) {
            setExternalChange(true);
          } else if (useProjectSessionStore.getState().selectedPath === activeEntry.path) {
            // A tree click updates selectedPath before its asynchronous source load finishes.
            // Never let background polling create a newer request for the old active source,
            // otherwise the user's selected UI is discarded while the tree still looks selected.
            const expectedSourcePath = current.sourcePath;
            const sourceRequest = ++sourceLoadRequestRef.current;
            const loaded = await loadTsxSource(activeEntry.path);
            const latest = useCodeProjectStore.getState();
            if (
              loaded &&
              isProjectSessionCurrent(generation, rootPath) &&
              sourceLoadRequestRef.current === sourceRequest &&
              latest.sourcePath === expectedSourcePath &&
              !latest.dirty
            ) {
              openLoadedSource(loaded, activeEntry.path);
              setMessage('Project index and active UI reloaded from VS Code.');
            }
          }
        }

        const architectureRequest = ++architectureSourcesRequestRef.current;
        try {
          const loadedArchitecture = await loadCodeProjectArchitectureSources(rootPath);
          if (
            loadedArchitecture &&
            architectureSourcesRequestRef.current === architectureRequest &&
            isProjectSessionCurrent(generation, rootPath)
          ) {
            const architectureFiles: Record<string, string> = {
              'srijika.config.json': loadedArchitecture.configSource,
            };
            if (loadedArchitecture.tsconfigSource !== undefined) {
              architectureFiles['tsconfig.json'] = loadedArchitecture.tsconfigSource;
            }
            for (const architectureSource of loadedArchitecture.sources) {
              architectureFiles[architectureSource.relativePath] = architectureSource.source;
            }
            const latest = useCodeProjectStore.getState();
            const activeArchitectureSource = loadedArchitecture.sources.find(
              (architectureSource) => architectureSource.path === latest.sourcePath,
            );
            if (activeArchitectureSource) {
              architectureFiles[activeArchitectureSource.relativePath] = latest.source;
            }
            setArchitectureAnalysis(
              analyzeCodeProjectFileMap(architectureFiles, loadedArchitecture.path),
            );
            setProjectComponents(frameworkComponentsFromFileMap(architectureFiles));
            const resolvedArchitecture = architectureConfigFromFileMap(architectureFiles);
            setArchitectureRoots(resolvedArchitecture);
            if (latest.sourcePath) {
              setResolvedTypeModules(
                resolvedCodeProjectTypeModules({
                  fileName: latest.sourcePath,
                  source: latest.source,
                  uiSuffix: resolvedArchitecture.uiSuffix,
                  typesSuffix: resolvedArchitecture.typesSuffix,
                  sourceByFileName: new Map(
                    loadedArchitecture.sources.map((entry) => [
                      entry.path,
                      { source: entry.source, hash: entry.hash },
                    ]),
                  ),
                }),
              );
            }
            architectureTruncated = loadedArchitecture.truncated;
          }
        } catch (error) {
          if (
            architectureSourcesRequestRef.current === architectureRequest &&
            isProjectSessionCurrent(generation, rootPath)
          ) {
            clearArchitectureAnalysis();
            setArchitectureRoots(DEFAULT_ARCHITECTURE_ROOTS);
            architectureRefreshError = errorMessage(error);
          }
        }
        if (announce && isProjectSessionCurrent(generation, rootPath)) {
          setMessage(
            architectureRefreshError
              ? `Indexed ${scanned.entries.length} project entries. Architecture checks unavailable: ${architectureRefreshError}`
              : `Indexed ${scanned.entries.length} project entries${architectureTruncated ? '; architecture source scan reached its safe limit' : ''}.`,
          );
        }
      } catch (error) {
        if (!isProjectSessionCurrent(generation, rootPath)) return;
        const nextMessage = errorMessage(error);
        setProjectIndexError(nextMessage);
        if (announce) setMessage(`Could not refresh project: ${nextMessage}`);
      } finally {
        if (projectScanInFlightRef.current === scanRequest) {
          projectScanInFlightRef.current = null;
        }
      }
    },
    [
      clearArchitectureAnalysis,
      isProjectSessionCurrent,
      openLoadedSource,
      replaceProjectIndex,
      setArchitectureAnalysis,
      setResolvedTypeModules,
      setProjectComponents,
      setProjectIndexError,
      setProjectIndexLoading,
    ],
  );

  const handleResumeProject = async (): Promise<void> => {
    const recovery = recoverableProject;
    if (!recovery || !isTauriDesktop()) return;
    setBusy(true);
    setMessage(`Opening ${recovery.displayName}…`);
    setRuntimeStatus(null);
    setRuntimeError(null);
    setRuntimeAction(null);
    clearArchitectureAnalysis();
    try {
      invalidateAsyncProjectSession();
      attachProject({
        rootPath: recovery.rootPath,
        displayName: recovery.displayName,
        activeUiSourcePath: recovery.activeUiSourcePath,
      });
      await refreshProjectIndex(true);
      if (!useCodeProjectStore.getState().hasLoadedSource) {
        throw new Error('The remembered project no longer contains its selected UI source.');
      }
      setRecoverableProject(null);
      setProjectChooserOpen(false);
      setMessage(`Resumed ${recovery.displayName}.`);
    } catch (error) {
      resetProjectSession();
      setMessage(`Could not resume project: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!projectRoot || !isTauriDesktop()) return;
    const initialRefresh = window.setTimeout(() => void refreshProjectIndex(), 0);
    const interval = window.setInterval(() => void refreshProjectIndex(), EXTERNAL_SOURCE_POLL_MS);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [projectRoot, refreshProjectIndex]);

  useEffect(() => {
    if (projectRoot || !sourcePath || !isTauriDesktop()) return;
    const generation = projectSessionGenerationRef.current;
    let disposed = false;
    let checking = false;
    const checkDetachedSource = async (): Promise<void> => {
      if (checking) return;
      checking = true;
      try {
        const loaded = await loadTsxSource(sourcePath);
        if (!loaded || disposed || !isProjectSessionCurrent(generation, null)) return;
        const current = useCodeProjectStore.getState();
        if (current.sourcePath !== sourcePath) return;
        if (loaded.hash === current.diskHash) return;
        if (current.dirty) setExternalChange(true);
        else openLoadedSource(loaded);
      } catch (error) {
        if (!disposed && isProjectSessionCurrent(generation, null)) {
          setMessage(`Source watch failed: ${errorMessage(error)}`);
        }
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => void checkDetachedSource(), EXTERNAL_SOURCE_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [isProjectSessionCurrent, openLoadedSource, projectRoot, sourcePath]);

  useEffect(() => {
    if (!projectRoot || !isTauriDesktop()) return;
    let disposed = false;
    const refreshRuntime = async (): Promise<void> => {
      try {
        const status = await getProjectRuntimeStatus(projectRoot);
        if (!disposed && status) {
          setRuntimeStatus(status);
          setRuntimeError((current) => (status.running && status.devServer.ready ? null : current));
        }
      } catch (error) {
        if (!disposed) setRuntimeError(errorMessage(error));
      }
    };
    void refreshRuntime();
    const interval = window.setInterval(() => void refreshRuntime(), 2_500);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [projectRoot]);

  const stopRunningProjectForTransition = async (): Promise<boolean> => {
    if (runtimeAction !== null || runtimeStatus?.activeTask) {
      setMessage('Wait for the current Full App task before changing projects.');
      return false;
    }
    if (!projectRoot || !runtimeStatus?.running || !isTauriDesktop()) return true;
    setRuntimeAction('stop');
    setMessage('Stopping the current Full App before changing projects…');
    try {
      const status = await stopCodeProject(projectRoot);
      if (!status) throw new Error('Desktop did not return the stopped project status.');
      setRuntimeStatus(status);
      setRuntimeError(null);
      return !status.running;
    } catch (error) {
      setRuntimeError(errorMessage(error));
      setMessage(`Could not stop the current Full App: ${errorMessage(error)}`);
      return false;
    } finally {
      setRuntimeAction(null);
    }
  };

  const handleNewProject = async (): Promise<void> => {
    if (projectRuntimeBlocksTransition) return;
    if (!confirmDiscardVisualEdits('create a new project')) return;
    if (!(await stopRunningProjectForTransition())) return;
    setProjectChooserOpen(false);
    setBusy(true);
    setMessage(null);
    setRuntimeStatus(null);
    setRuntimeError(null);
    setRuntimeAction(null);
    clearArchitectureAnalysis();
    try {
      const generated = scaffold();
      setPreviewStylesheets([]);
      setPreviewAssets([]);
      setPreviewDesignProps({});
      setPreviewStylesError(null);
      if (isTauriDesktop()) {
        const created = await chooseAndCreateCodeProject(
          Object.entries(generated.files).map(([path, contents]) => ({ path, contents })),
          generated.entryPath,
        );
        if (!created) return;
        invalidateAsyncProjectSession();
        attachProject({
          rootPath: created.path,
          displayName: projectDisplayName(created.path),
          activeUiSourcePath: created.entrySourcePath,
        });
        const loaded = await loadTsxSource(created.entrySourcePath);
        if (!loaded) throw new Error('Desktop did not return the generated entry source.');
        openLoadedSource(loaded);
        await refreshProjectIndex();
        setMessage(`Created code-first project at ${created.path}`);
      } else {
        const memoryRoot = 'srijika-memory:/srijika-app';
        const generatedArchitecture = architectureConfigFromFileMap(generated.files);
        const entries = codeProjectEntriesFromFileMap(
          generated.files,
          memoryRoot,
          generatedArchitecture,
        );
        const activeEntry = entries.find((entry) => entry.relativePath === generated.entryPath);
        browserProjectFilesRef.current = generated.files;
        const browserStyles = generated.files['src/styles.css'];
        const browserMark = generated.files['public/srijika-mark.svg'];
        setPreviewStylesheets(
          browserStyles === undefined
            ? []
            : [
                {
                  path: 'srijika-memory:/srijika-app/src/styles.css',
                  relativePath: 'src/styles.css',
                  bytes: new TextEncoder().encode(browserStyles).byteLength,
                  hash: 'memory:src/styles.css',
                  source: browserStyles,
                },
              ],
        );
        setPreviewAssets(
          browserMark === undefined
            ? []
            : [
                {
                  path: 'srijika-memory:/srijika-app/public/srijika-mark.svg',
                  publicPath: '/srijika-mark.svg',
                  bytes: new TextEncoder().encode(browserMark).byteLength,
                  hash: 'memory:public/srijika-mark.svg',
                  mediaType: 'image/svg+xml',
                  source: browserMark,
                },
              ],
        );
        setPreviewDesignProps(generated.previewProps);
        invalidateAsyncProjectSession();
        attachProject({
          rootPath: null,
          displayName: 'srijika-app',
          entries,
          activeUiSourcePath: activeEntry?.path ?? null,
        });
        loadSource({
          fileName: generated.entryPath,
          source: generated.entrySource,
          sourcePath: null,
          diskHash: null,
        });
        setMessage(
          'Created an in-memory Srijika project. The source viewer is read-only; use VS Code in desktop projects for manual coding.',
        );
      }
    } catch (error) {
      setMessage(`Could not create project: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (): Promise<void> => {
    if (projectRuntimeBlocksTransition) return;
    if (!confirmDiscardVisualEdits('open another UI source')) return;
    if (!(await stopRunningProjectForTransition())) return;
    setProjectChooserOpen(false);
    if (!isTauriDesktop()) {
      browserFileInputRef.current?.click();
      return;
    }
    setBusy(true);
    setMessage(null);
    setRuntimeStatus(null);
    setRuntimeError(null);
    setRuntimeAction(null);
    clearArchitectureAnalysis();
    try {
      const loaded = await chooseAndLoadTsxSource();
      if (loaded) {
        browserProjectFilesRef.current = null;
        setPreviewStylesheets([]);
        setPreviewAssets([]);
        setPreviewDesignProps({});
        setPreviewStylesError(null);
        invalidateAsyncProjectSession();
        resetProjectSession();
        openLoadedSource(loaded);
      }
    } catch (error) {
      setMessage(`Could not open source: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenProject = async (): Promise<void> => {
    if (!isTauriDesktop()) {
      await handleOpen();
      return;
    }
    if (projectRuntimeBlocksTransition) return;
    if (!confirmDiscardVisualEdits('open another project')) return;
    if (!(await stopRunningProjectForTransition())) return;
    setProjectChooserOpen(false);
    setBusy(true);
    setMessage(null);
    setRuntimeStatus(null);
    setRuntimeError(null);
    setRuntimeAction(null);
    clearArchitectureAnalysis();
    try {
      const opened = await chooseAndOpenCodeProject();
      if (!opened) return;
      browserProjectFilesRef.current = null;
      setPreviewStylesheets([]);
      setPreviewAssets([]);
      setPreviewDesignProps({});
      setPreviewStylesError(null);
      invalidateAsyncProjectSession();
      attachProject({
        rootPath: opened.path,
        displayName: projectDisplayName(opened.path),
        activeUiSourcePath: opened.entrySourcePath,
      });
      openLoadedSource({
        path: opened.entrySourcePath,
        source: opened.source,
        hash: opened.hash,
      });
      await refreshProjectIndex();
      setMessage(`Opened Srijika project at ${opened.path}`);
    } catch (error) {
      setMessage(`Could not open project: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReactMigration = async (operation: 'start' | 'status' | 'verify'): Promise<void> => {
    if (!isTauriDesktop()) {
      setMessage('React project migration is available in desktop Studio.');
      return;
    }
    if (projectRuntimeBlocksTransition) return;
    if (operation === 'start' && !confirmDiscardVisualEdits('import a React project')) return;
    if (operation === 'start' && !(await stopRunningProjectForTransition())) return;
    setBusy(true);
    setMessage(
      operation === 'start'
        ? 'Select the read-only React or Next.js source, then choose a separate Srijika target.'
        : operation === 'status'
          ? 'Select an existing Srijika migration target.'
          : 'Select the converted Srijika project to verify.',
    );
    try {
      const response = await chooseAndRunReactMigration(operation);
      if (!response) {
        setMessage('Migration selection was cancelled; no files were changed.');
        return;
      }
      const summary = describeReactMigrationCommand(response);
      if (operation !== 'start') {
        setMessage(summary);
        return;
      }

      const opened = await openCodeProject(response.targetPath);
      if (!opened) {
        setMessage(`${summary} Reopen the target when its project entry is ready.`);
        return;
      }
      browserProjectFilesRef.current = null;
      setPreviewStylesheets([]);
      setPreviewAssets([]);
      setPreviewDesignProps({});
      setPreviewStylesError(null);
      invalidateAsyncProjectSession();
      attachProject({
        rootPath: opened.path,
        displayName: projectDisplayName(opened.path),
        activeUiSourcePath: opened.entrySourcePath,
      });
      openLoadedSource({
        path: opened.entrySourcePath,
        source: opened.source,
        hash: opened.hash,
      });
      setProjectChooserOpen(false);
      await refreshProjectIndex();
      setMessage(`${summary} Opened converted project at ${opened.path}`);
    } catch (error) {
      setMessage(`Migration failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOwnerTests = async (operation: 'sync' | 'verify' | 'evidence'): Promise<void> => {
    if (!projectRoot || !desktopMode) {
      setMessage('Owner-test commands require an open desktop Srijika project.');
      return;
    }
    if (ownerTestsBusy) return;
    const actionRoot = projectRoot;
    const generation = projectSessionGenerationRef.current;
    setOwnerTestsBusy(true);
    setMessage(
      operation === 'sync'
        ? 'Synchronizing owner Vitest and Playwright artifacts…'
        : operation === 'verify'
          ? 'Running architecture, typecheck, Vitest, and Playwright owner gates…'
          : 'Reading engine-produced owner test evidence…',
    );
    try {
      const response = await runOwnerTests(actionRoot, operation);
      if (!response) throw new Error('Desktop did not return the owner-test result.');
      if (!isProjectSessionCurrent(generation, actionRoot)) return;
      if (operation === 'sync') {
        await refreshProjectIndex();
        if (!isProjectSessionCurrent(generation, actionRoot)) return;
        setMessage(describeOwnerTestCommand(response));
      } else {
        const evidence = ownerTestEvidenceSummary(response);
        setOwnerTestEvidence(evidence);
        setMessage(describeOwnerTestCommand(response));
      }
    } catch (error) {
      if (isProjectSessionCurrent(generation, actionRoot)) {
        setMessage(`Owner-test command failed: ${errorMessage(error)}`);
      }
    } finally {
      setOwnerTestsBusy(false);
    }
  };

  useEffect(() => {
    if (!isTauriDesktop() || launchProjectHandledRef.current) return;
    launchProjectHandledRef.current = true;
    void (async () => {
      try {
        const launchProject = await getLaunchProject();
        if (!launchProject) return;
        setBusy(true);
        setMessage(null);
        const opened = await openCodeProject(launchProject);
        if (!opened) return;
        browserProjectFilesRef.current = null;
        setPreviewStylesheets([]);
        setPreviewAssets([]);
        setPreviewDesignProps({});
        setPreviewStylesError(null);
        invalidateAsyncProjectSession();
        attachProject({
          rootPath: opened.path,
          displayName: projectDisplayName(opened.path),
          activeUiSourcePath: opened.entrySourcePath,
        });
        openLoadedSource({
          path: opened.entrySourcePath,
          source: opened.source,
          hash: opened.hash,
        });
        await refreshProjectIndex();
        setProjectChooserOpen(false);
        setMessage(`Opened Srijika project from CLI at ${opened.path}`);
      } catch (error) {
        setMessage(`Could not open CLI project: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    })();
  }, [attachProject, invalidateAsyncProjectSession, openLoadedSource, refreshProjectIndex]);

  const handleBrowserFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!file.name.endsWith('.ui.tsx')) {
      setMessage('Srijika UI source files must end in .ui.tsx.');
      return;
    }
    try {
      setRuntimeStatus(null);
      setRuntimeError(null);
      setRuntimeAction(null);
      clearArchitectureAnalysis();
      const contents = await file.text();
      invalidateAsyncProjectSession();
      loadSource({
        fileName: file.name,
        source: contents,
        sourcePath: null,
        diskHash: null,
      });
      browserProjectFilesRef.current = null;
      setPreviewStylesheets([]);
      setPreviewAssets([]);
      setPreviewDesignProps({});
      setPreviewStylesError(null);
      resetProjectSession();
      setMessage(`Opened ${file.name}`);
    } catch (error) {
      setMessage(`Could not read source: ${errorMessage(error)}`);
    }
  };

  const openCreateUiDialog = (folder?: string): void => {
    if (!projectDisplay) {
      setMessage('Create or open a Srijika project before adding a UI source.');
      return;
    }
    if (projectCreationBlocked) {
      setMessage('Wait for the active project task to finish before creating a UI source.');
      return;
    }
    setCreateDialogRequest({ ...(folder ? { folder } : {}) });
  };

  const openCreateStructureDialog = (folder: string): void => {
    if (!desktopMode || !projectRoot) {
      setMessage('Structure scaffolding is available for an open desktop Srijika project.');
      return;
    }
    if (projectCreationBlocked) {
      setMessage('Wait for the active project task to finish before adding a capability.');
      return;
    }
    const owner = structureOwnerFromFolder(folder, architectureRoots);
    if (!owner) {
      setMessage(
        `Select ${architectureRoots.featuresRoot}, an exact Feature/Slot/Part owner, ${architectureRoots.sharedRoot}, or an exact Shared owner folder.`,
      );
      return;
    }
    setStructureDialogOwner(owner);
  };

  const handleCreateStructure = async (input: CreateStructureItemInput): Promise<string | null> => {
    const currentSession = useProjectSessionStore.getState();
    const expectedRoot = currentSession.rootPath;
    if (!desktopMode || !expectedRoot) {
      return 'Open a desktop Srijika project before adding a structured capability.';
    }
    if (runtimeAction !== null || (runtimeStatus?.activeTask ?? null) !== null) {
      return 'Wait for the active project task to finish before adding a capability.';
    }
    const createsUi =
      input.capability.kind === 'feature' ||
      input.capability.kind === 'slot' ||
      input.capability.kind === 'part' ||
      input.capability.kind === 'sharedUi' ||
      input.capability.kind === 'sharedWidget';
    if (
      createsUi &&
      useCodeProjectStore.getState().dirty &&
      !confirmDiscardVisualEdits('create and open the new structured UI')
    ) {
      return 'Creation was cancelled so your unsaved visual edit stays open.';
    }

    const generation = projectSessionGenerationRef.current;
    if (createsUi) ++sourceLoadRequestRef.current;
    setBusy(true);
    setMessage(null);
    try {
      const created = await scaffoldCodeProjectStructure({
        projectPath: expectedRoot,
        featureName: input.featureName,
        capability: input.capability,
      });
      if (!created) return 'Desktop did not return the scaffolded structure.';
      if (!isProjectSessionCurrent(generation, expectedRoot)) {
        return 'The active project changed before structure creation finished.';
      }

      const createdUi = created.files.find(
        (file) =>
          file.role === 'featureUi' ||
          file.role === 'slotUi' ||
          file.role === 'partUi' ||
          file.role === 'sharedUi' ||
          file.role === 'sharedWidgetUi',
      );
      let previewWarning: string | null = null;
      if (createdUi) {
        const loaded = await loadTsxSource(createdUi.path);
        if (!loaded) {
          previewWarning = ` The file was created, but Studio could not open ${createdUi.relativePath}.`;
        } else {
          if (!isProjectSessionCurrent(generation, expectedRoot)) {
            return 'The active project changed before the created UI could open.';
          }
          openLoadedSource(loaded, createdUi.path);
        }
      }

      await refreshProjectIndex();
      if (!isProjectSessionCurrent(generation, expectedRoot)) {
        return 'The active project changed before its file index refreshed.';
      }
      const primaryFile = createdUi ?? created.files[0];
      if (primaryFile) selectProjectPath(primaryFile.path);
      setMessage(
        `Created ${created.files.length} ${created.files.length === 1 ? 'file' : 'files'} in ${created.featurePath}.${previewWarning ?? ''}`,
      );
      return null;
    } catch (error) {
      const nextMessage = `Could not create the structured capability: ${errorMessage(error)}`;
      setMessage(nextMessage);
      return nextMessage;
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUiSource = async (input: CreateUiSourceInput): Promise<string | null> => {
    const currentSession = useProjectSessionStore.getState();
    if (!currentSession.displayName) {
      return 'Create or open a Srijika project before adding a UI source.';
    }
    if (
      runtimeAction !== null ||
      (runtimeStatus?.activeTask ?? null) !== null ||
      (useCodeProjectStore.getState().dirty &&
        !confirmDiscardVisualEdits('create and open the new UI source'))
    ) {
      return runtimeAction !== null || (runtimeStatus?.activeTask ?? null) !== null
        ? 'Wait for the active project task to finish before creating a UI source.'
        : 'Creation was cancelled so your unsaved visual edit stays open.';
    }

    const generation = projectSessionGenerationRef.current;
    const expectedRoot = currentSession.rootPath;
    ++sourceLoadRequestRef.current;
    setBusy(true);
    setMessage(null);
    try {
      if (desktopMode) {
        if (!expectedRoot) return 'Open a desktop Srijika project folder first.';
        const created = await createCodeProjectUiSource({
          projectPath: expectedRoot,
          relativePath: input.relativePath,
          kind: input.kind,
          componentName: input.componentName,
          createConnector: input.createConnector,
        });
        if (!created) return 'Desktop did not return the created UI source.';
        if (!isProjectSessionCurrent(generation, expectedRoot)) {
          return 'The active project changed before creation finished.';
        }
        openLoadedSource(created, created.path);
        await refreshProjectIndex();
        if (!isProjectSessionCurrent(generation, expectedRoot)) {
          return 'The active project changed before its file index refreshed.';
        }
        setMessage(
          created.connectorPath
            ? `Created and opened ${created.relativePath} with its Connector.`
            : `Created and opened ${created.relativePath} without a Connector.`,
        );
        return null;
      }

      const currentFiles = browserProjectFilesRef.current;
      if (!currentFiles) return 'Create the browser demo project before adding a UI source.';
      const pair = createSrijikaUiSourcePair({
        kind: input.kind,
        componentName: input.componentName,
      });
      const connectorPath = input.createConnector
        ? `${input.folder}/${pair.connectorFileName}`
        : null;
      if (
        currentFiles[input.relativePath] !== undefined ||
        (connectorPath !== null && currentFiles[connectorPath] !== undefined)
      ) {
        return 'A UI or Connector with this name already exists in that folder.';
      }
      const nextFiles = connectorPath
        ? {
            ...currentFiles,
            [input.relativePath]: pair.uiSource,
            [connectorPath]: pair.connectorSource,
          }
        : {
            ...currentFiles,
            [input.relativePath]: pair.uiSource,
          };
      const nextArchitecture = architectureConfigFromFileMap(nextFiles);
      const nextEntries = codeProjectEntriesFromFileMap(nextFiles, undefined, nextArchitecture);
      const createdEntry = nextEntries.find(
        (entry) => entry.kind === 'file' && entry.relativePath === input.relativePath,
      );
      if (!createdEntry) return 'The in-memory project could not index the new UI source.';
      if (!isProjectSessionCurrent(generation, expectedRoot)) {
        return 'The active project changed before creation finished.';
      }
      browserProjectFilesRef.current = nextFiles;
      replaceProjectIndex({ entries: nextEntries });
      loadSource({
        fileName: input.relativePath,
        sourcePath: null,
        source: pair.uiSource,
        diskHash: null,
      });
      activateUiSource(createdEntry.path);
      setExternalChange(false);
      setMessage(
        connectorPath
          ? `Created and opened ${input.relativePath} with its Connector.`
          : `Created and opened ${input.relativePath} without a Connector.`,
      );
      return null;
    } catch (error) {
      const nextMessage = `Could not create ${input.relativePath}: ${errorMessage(error)}`;
      setMessage(nextMessage);
      return nextMessage;
    } finally {
      setBusy(false);
    }
  };

  const handleSelectProjectEntry = async (entry: CodeProjectEntry): Promise<void> => {
    if (
      entry.isUiSource &&
      entry.path !== activeUiSourcePath &&
      dirty &&
      !confirmDiscardVisualEdits('switch UI files')
    ) {
      return;
    }
    const needsUiLoad =
      entry.isUiSource && entry.kind === 'file' && entry.path !== activeUiSourcePath;
    selectProjectPath(entry.path);
    if (!needsUiLoad) {
      if (entry.kind === 'file' && !entry.isUiSource) {
        setMessage(
          `${entry.relativePath} is selected. Srijika opens ${architectureRoots.uiSuffix} files; edit other project files in VS Code.`,
        );
      }
      return;
    }
    const generation = projectSessionGenerationRef.current;
    const expectedRoot = useProjectSessionStore.getState().rootPath;
    const sourceRequest = ++sourceLoadRequestRef.current;
    setBusy(true);
    try {
      if (isTauriDesktop()) {
        const loaded = await loadTsxSource(entry.path);
        if (!loaded) throw new Error('Desktop did not return the selected UI source.');
        if (
          !isProjectSessionCurrent(generation, expectedRoot) ||
          sourceLoadRequestRef.current !== sourceRequest ||
          useProjectSessionStore.getState().selectedPath !== entry.path
        ) {
          return;
        }
        openLoadedSource(loaded, entry.path);
      } else {
        const sourceContents = browserProjectFilesRef.current?.[entry.relativePath];
        if (sourceContents === undefined)
          throw new Error('The in-memory project no longer contains this UI source.');
        if (
          !isProjectSessionCurrent(generation, expectedRoot) ||
          sourceLoadRequestRef.current !== sourceRequest ||
          useProjectSessionStore.getState().selectedPath !== entry.path
        ) {
          return;
        }
        loadSource({
          fileName: entry.relativePath,
          source: sourceContents,
          sourcePath: null,
          diskHash: null,
        });
        activateUiSource(entry.path);
        setMessage(`Opened ${entry.relativePath}`);
      }
    } catch (error) {
      if (
        isProjectSessionCurrent(generation, expectedRoot) &&
        sourceLoadRequestRef.current === sourceRequest
      ) {
        setMessage(`Could not open UI source: ${errorMessage(error)}`);
      }
    } finally {
      if (sourceLoadRequestRef.current === sourceRequest) setBusy(false);
    }
  };

  const handleSelectProblem = (problem: StudioProblem): void => {
    if (problem.kind === 'source') {
      chooseDiagnostic(problem.index, problem.diagnostic);
      return;
    }

    selectArchitectureDiagnostic(problem.index);
    setSourceVisible(true);
    const entry = projectEntryForDiagnostic(projectEntries, problem.diagnostic.fileName);
    if (!entry) {
      setMessage(
        `${problemDisplayPath(problem.diagnostic.fileName)} violates the architecture contract. ${problem.diagnostic.guidance}`,
      );
      return;
    }

    if (entry.isUiSource) {
      void handleSelectProjectEntry(entry).then(() => {
        if (useProjectSessionStore.getState().activeUiSourcePath !== entry.path) return;
        window.requestAnimationFrame(() => revealSpan(problem.diagnostic.span));
      });
      return;
    }

    selectProjectPath(entry.path);
    setMessage(problem.diagnostic.guidance);
    if (projectRoot && desktopMode) {
      void openProjectLocationInVsCode(entry.relativePath, problem.diagnostic.span);
    }
  };

  const handleLivePreviewSourceSelection = async (
    location: LivePreviewSourceLocation,
  ): Promise<void> => {
    const entry = projectEntries.find(
      (candidate) =>
        candidate.kind === 'file' &&
        candidate.isUiSource &&
        candidate.relativePath === location.relativePath,
    );
    if (!entry) {
      setMessage(
        `Live preview selected ${location.relativePath}, which is not indexed as a UI source.`,
      );
      return;
    }
    if (entry.path !== useProjectSessionStore.getState().activeUiSourcePath) {
      await handleSelectProjectEntry(entry);
    }
    const currentProject = useProjectSessionStore.getState();
    const currentSource = useCodeProjectStore.getState();
    if (currentProject.activeUiSourcePath !== entry.path || !currentSource.sourceMap) return;
    const nodeId = nodeIdAtSourceLocation(
      currentSource.source,
      currentSource.sourceMap.nodes,
      location.line,
      location.column,
    );
    if (!nodeId) {
      setMessage(`Could not map the live element to ${location.relativePath}:${location.line}.`);
      return;
    }
    setComponentSelectionFile(null);
    selectNode(nodeId);
    const span = currentSource.sourceMap.nodes[nodeId];
    if (span) window.requestAnimationFrame(() => revealSpan(span));
    setMessage(`Selected the live element from ${location.relativePath}:${location.line}.`);
  };

  const openProjectLocationInVsCode = useCallback(
    async (
      relativePath?: string,
      span?: Pick<SrijikaSourceSpan, 'line' | 'column'>,
    ): Promise<void> => {
      if (!projectRoot || !isTauriDesktop()) {
        setMessage('VS Code linking is available when a desktop Srijika project is open.');
        return;
      }
      try {
        const opened = await openInVsCode({
          projectPath: projectRoot,
          ...(relativePath ? { relativePath } : {}),
          ...(span ? { line: span.line, column: span.column } : {}),
        });
        if (opened)
          setMessage(
            relativePath
              ? `Opened ${relativePath}${span ? `:${span.line}:${span.column}` : ''} in VS Code.`
              : `Opened ${projectDisplayName(projectRoot)} in VS Code.`,
          );
      } catch (error) {
        setMessage(`Could not open VS Code: ${errorMessage(error)}`);
      }
    },
    [projectRoot],
  );

  const handleOpenProjectEntry = (entry: CodeProjectEntry): void => {
    void openProjectLocationInVsCode(
      entry.relativePath,
      entry.kind === 'file' ? { line: 1, column: 1 } : undefined,
    );
  };

  const handleOpenUiNode = (_nodeId: string, span: SrijikaSourceSpan): void => {
    const activeEntry = projectEntryForPath(projectEntries, activeUiSourcePath);
    if (!activeEntry) {
      setMessage('Open this source through its Srijika project before linking a node to VS Code.');
      return;
    }
    void openProjectLocationInVsCode(activeEntry.relativePath, span);
  };

  const handleOpenSelectedDiagnostic = (): void => {
    if (!selectedProblem) return;
    const owningEntry =
      selectedProblem.kind === 'architecture'
        ? projectEntryForDiagnostic(projectEntries, selectedProblem.diagnostic.fileName)
        : projectEntryForPath(projectEntries, activeUiSourcePath);
    if (!owningEntry) {
      setMessage('Open this source through its Srijika project before linking to VS Code.');
      return;
    }
    void openProjectLocationInVsCode(owningEntry.relativePath, selectedProblem.diagnostic.span);
  };

  const handleRefreshProject = (): void => {
    if (projectRoot) {
      void refreshProjectIndex(true);
      return;
    }
    if (browserProjectFilesRef.current) {
      replaceProjectIndex({
        entries: codeProjectEntriesFromFileMap(
          browserProjectFilesRef.current,
          undefined,
          architectureConfigFromFileMap(browserProjectFilesRef.current),
        ),
      });
      setMessage('Refreshed the in-memory project explorer.');
    }
  };

  const handleRuntimeAction = async (action: RuntimeAction): Promise<void> => {
    if (!projectRoot || !isTauriDesktop()) {
      setMessage(
        'Full App commands are available for desktop projects. Design Preview is ready now.',
      );
      return;
    }
    const actionRoot = projectRoot;
    const generation = projectSessionGenerationRef.current;
    const runtimeRequest = ++runtimeActionRequestRef.current;
    const isCurrentRuntimeRequest = (): boolean =>
      runtimeActionRequestRef.current === runtimeRequest &&
      isProjectSessionCurrent(generation, actionRoot);
    setRuntimeAction(action);
    setRuntimeError(null);
    try {
      // Polling is only a UX hint. Always re-read the lockfile/toolchain state
      // when the user explicitly requests Install, Run, Stop, or Build.
      const freshStatus = await getProjectRuntimeStatus(actionRoot);
      if (!isCurrentRuntimeRequest()) return;
      if (!freshStatus) throw new Error('Desktop did not return the toolchain status.');
      let currentStatus: ProjectRuntimeStatus = freshStatus;
      setRuntimeStatus(currentStatus);
      let installedDuration: number | null = null;
      const ensureDependenciesReady = async (): Promise<boolean> => {
        if (currentStatus.dependencyState === 'missingLockfile')
          throw new Error(
            `${currentStatus.packageManager} lockfile is missing. Restore the authoritative project lockfile first.`,
          );
        if (currentStatus.dependenciesReady) return true;

        setRuntimeAction('install');
        setMessage('Synchronizing the exact lockfile dependencies before continuing…');
        const installResult = await installProjectDependencies(actionRoot);
        if (!isCurrentRuntimeRequest()) return false;
        if (!installResult) throw new Error('Desktop did not return the install result.');
        if (!installResult.success)
          throw new Error(
            installResult.stderr.trim() ||
              `Dependency install exited with ${installResult.exitCode}.`,
          );
        installedDuration = installResult.durationMillis;
        const refreshedStatus = await getProjectRuntimeStatus(actionRoot);
        if (!isCurrentRuntimeRequest()) return false;
        if (!refreshedStatus?.dependenciesReady)
          throw new Error('Dependencies were installed but the lockfile is still not ready.');
        currentStatus = refreshedStatus;
        setRuntimeStatus(currentStatus);
        await refreshProjectIndex();
        if (action !== 'install') setRuntimeAction(action);
        return true;
      };

      if (action === 'stop') {
        const status = await stopCodeProject(actionRoot);
        if (!isCurrentRuntimeRequest()) return;
        if (!status) throw new Error('Desktop did not return the application status.');
        setRuntimeStatus(status);
        setMessage('Full application stopped.');
      } else {
        if (!(await ensureDependenciesReady())) return;
      }

      if (action === 'install') {
        setMessage(
          installedDuration === null
            ? 'Dependencies are already synchronized.'
            : `Dependencies installed in ${(installedDuration / 1_000).toFixed(1)}s.`,
        );
      } else if (action === 'build') {
        const result = await buildCodeProject(actionRoot);
        if (!isCurrentRuntimeRequest()) return;
        if (!result) throw new Error('Desktop did not return the build result.');
        if (!result.success)
          throw new Error(
            result.stderr.trim() || `Application build exited with ${result.exitCode}.`,
          );
        setMessage(
          `Application build completed in ${(result.durationMillis / 1_000).toFixed(1)}s.`,
        );
      } else if (action === 'run') {
        const status = await startCodeProject(actionRoot);
        if (!isCurrentRuntimeRequest()) return;
        if (!status) throw new Error('Desktop did not return the application status.');
        setRuntimeStatus(status);
        setMessage(status.message);
      }

      if (action === 'build') {
        const status = await getProjectRuntimeStatus(actionRoot);
        if (isCurrentRuntimeRequest() && status) setRuntimeStatus(status);
      }
    } catch (error) {
      if (!isCurrentRuntimeRequest()) return;
      const nextError = errorMessage(error);
      setRuntimeError(nextError);
      setMessage(`${action === 'build' ? 'Build' : 'Full App'} failed: ${nextError}`);
    } finally {
      if (runtimeActionRequestRef.current === runtimeRequest) setRuntimeAction(null);
    }
  };

  const handleOpenRunningApp = async (): Promise<void> => {
    if (!projectRoot || !runtimeStatus?.running || !runtimeStatus.devServer.ready) {
      setMessage('Wait for the managed Full App to become ready before opening it.');
      return;
    }
    if (nextPreviewRouteError) {
      setMessage(nextPreviewRouteError);
      return;
    }
    const actionRoot = projectRoot;
    const generation = projectSessionGenerationRef.current;
    setOpeningApp(true);
    try {
      const opened =
        runtimeStatus.framework === 'next-app-router'
          ? await openCodeProjectApp(actionRoot, nextPreviewPath)
          : await openCodeProjectApp(actionRoot);
      if (!isProjectSessionCurrent(generation, actionRoot)) return;
      if (!opened) throw new Error('Desktop did not return the opened application URL.');
      setMessage(`Opened the managed Full App at ${opened.url}`);
    } catch (error) {
      if (isProjectSessionCurrent(generation, actionRoot)) {
        setMessage(`Could not open the managed Full App: ${errorMessage(error)}`);
      }
    } finally {
      setOpeningApp(false);
    }
  };

  const handleSaveVisualEdits = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      if (isTauriDesktop()) {
        if (!sourcePath) {
          setMessage('Create a project first so Srijika has a safe source path to save.');
          return;
        }
        const saved = await saveTsxSource(sourcePath, source, diskHash);
        if (!saved) return;
        markSaved({ sourcePath: saved.path, diskHash: saved.hash });
        activateUiSource(saved.path);
        setExternalChange(false);
        setMessage(`Saved Studio-generated visual edits to ${saved.path}`);
        return;
      }

      const blob = new Blob([source], { type: 'text/typescript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = fileName.split(/[\\/]/).at(-1) ?? 'Component.ui.tsx';
      anchor.click();
      URL.revokeObjectURL(url);
      markSaved({ sourcePath: null, diskHash: null });
      setMessage(`Downloaded ${anchor.download}`);
    } catch (error) {
      setMessage(`Could not save visual source edit: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReload = async (): Promise<void> => {
    if (!sourcePath || !isTauriDesktop()) {
      setMessage('This source is not linked to a desktop file.');
      return;
    }
    if (
      dirty &&
      !window.confirm('Discard unsaved Studio-generated visual edits and reload from VS Code?')
    )
      return;
    setBusy(true);
    try {
      const loaded = await loadTsxSource(sourcePath);
      if (loaded) openLoadedSource(loaded);
    } catch (error) {
      setMessage(`Could not reload source: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (!projectRoot || !isTauriDesktop()) {
      try {
        await openBrowserPreview();
      } catch (error) {
        setMessage(`Could not open preview: ${errorMessage(error)}`);
      }
      return;
    }

    const actionRoot = projectRoot;
    const generation = projectSessionGenerationRef.current;
    const runtimeRequest = ++runtimeActionRequestRef.current;
    const isCurrentRuntimeRequest = (): boolean =>
      runtimeActionRequestRef.current === runtimeRequest &&
      isProjectSessionCurrent(generation, actionRoot);
    setOpeningPreview(true);
    setRuntimeAction('run');
    setRuntimeError(null);
    try {
      let status = await getProjectRuntimeStatus(actionRoot);
      if (!isCurrentRuntimeRequest()) return;
      if (!status) throw new Error('Desktop did not return the toolchain status.');
      setRuntimeStatus(status);

      if (status.dependencyState === 'missingLockfile') {
        throw new Error(
          `${status.packageManager} lockfile is missing. Restore the authoritative project lockfile first.`,
        );
      }
      if (!status.dependenciesReady) {
        setRuntimeAction('install');
        setMessage('Synchronizing project dependencies for the live preview…');
        const install = await installProjectDependencies(actionRoot);
        if (!isCurrentRuntimeRequest()) return;
        if (!install) throw new Error('Desktop did not return the install result.');
        if (!install.success) {
          throw new Error(
            install.stderr.trim() || `Dependency install exited with ${install.exitCode}.`,
          );
        }
        status = await getProjectRuntimeStatus(actionRoot);
        if (!isCurrentRuntimeRequest()) return;
        if (!status?.dependenciesReady) {
          throw new Error('Dependencies were installed but the lockfile is still not ready.');
        }
        setRuntimeStatus(status);
        await refreshProjectIndex();
      }

      setRuntimeAction('run');
      if (!status.running || !status.devServer.ready) {
        setMessage('Building and starting the project preview…');
        const started = await startCodeProject(actionRoot);
        if (!isCurrentRuntimeRequest()) return;
        if (!started?.running || !started.devServer.ready) {
          throw new Error(
            started?.message ?? 'The project process started without a ready application.',
          );
        }
        status = started;
        setRuntimeStatus(status);
      }

      if (nextPreviewRouteError) throw new Error(nextPreviewRouteError);
      const opened =
        status.framework === 'next-app-router'
          ? await openCodeProjectPreview(actionRoot, nextPreviewPath)
          : await openCodeProjectPreview(actionRoot);
      if (!isCurrentRuntimeRequest()) return;
      if (!opened) throw new Error('Desktop did not return the live preview URL.');
      setMessage(`Live project preview opened at ${opened.url}`);
    } catch (error) {
      if (!isCurrentRuntimeRequest()) return;
      const nextError = errorMessage(error);
      setRuntimeError(nextError);
      setMessage(`Could not open live project preview: ${nextError}`);
    } finally {
      if (runtimeActionRequestRef.current === runtimeRequest) {
        setOpeningPreview(false);
        setRuntimeAction(null);
      }
    }
  };

  const applyFix = (fix: SrijikaQuickFix): void => {
    const affectedNodeId = selectedNodeId;
    applyQuickFix(fix);
    setMessage(`Applied validated Srijika source fix: ${fix.title}`);
    window.requestAnimationFrame(() => {
      sourceInputRef.current?.focus();
      if (useCodeProjectStore.getState().lastValidDocument?.nodes[affectedNodeId]) {
        selectNode(affectedNodeId);
      }
    });
  };

  const applyTextEdit = (): void => {
    if (!sourceMap || !selectedNode) return;
    const result = replaceSrijikaTextNode(source, sourceMap, selectedNode.id, textDraft);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    updateSource(result.source);
    setMessage(`Applied an AST-safe visual text edit to ${selectedNode.name}.`);
  };

  const applyNodePropEdit = (nextSource: string, propName: string): void => {
    updateSource(nextSource);
    setMessage(`Applied the ${propName} prop to authoritative TSX.`);
    window.requestAnimationFrame(() => {
      const span = useCodeProjectStore.getState().sourceMap?.nodes[selectedNodeId];
      if (span) revealSpan(span);
    });
  };

  const persistInsertedVisualSource = async (nextSource: string): Promise<void> => {
    if (!desktopMode || !sourcePath) return;
    try {
      const currentHash = useCodeProjectStore.getState().diskHash;
      const saved = await saveTsxSource(sourcePath, nextSource, currentHash);
      if (!saved || useCodeProjectStore.getState().source !== nextSource) return;
      markSaved({ sourcePath: saved.path, diskHash: saved.hash });
      activateUiSource(saved.path);
      setExternalChange(false);
      setMessage('Component added to TSX and synchronized with the live project.');
    } catch (error) {
      setMessage(
        `Component is valid in Studio but could not be synchronized to disk: ${errorMessage(error)}`,
      );
    }
  };

  const insertVisualComponent = (
    component: VisualComponentDefinition,
    requestedTargetId: string | null = visualTargetNodeId,
  ): void => {
    if (!sourceMap || previewStale) {
      setMessage('Fix the current TSX problems before adding another component.');
      return;
    }
    const targetId = requestedTargetId
      ? closestVisualContainer(document, requestedTargetId)
      : visualTargetNodeId;
    if (!targetId) {
      setMessage('Select main, div, section, header, nav, form, or another container first.');
      return;
    }
    const result = insertSrijikaJsxElement(source, sourceMap, targetId, component.template);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    updateSource(result.source);
    const nextMap = useCodeProjectStore.getState().sourceMap;
    const insertedNodeId = nextMap
      ? Object.entries(nextMap.nodes)
          .filter(([id]) => id !== targetId)
          .sort(([, left], [, right]) => {
            const leftDistance = Math.abs(left.start - result.insertedAt);
            const rightDistance = Math.abs(right.start - result.insertedAt);
            return (
              leftDistance - rightDistance || left.end - left.start - (right.end - right.start)
            );
          })[0]?.[0]
      : null;
    if (insertedNodeId) {
      setComponentSelectionFile(null);
      selectNode(insertedNodeId);
      const span = nextMap?.nodes[insertedNodeId];
      if (span) window.requestAnimationFrame(() => revealSpan(span));
    }
    setMessage(
      `Added ${component.name} inside ${visualTargetLabel}. The authoritative TSX is valid.`,
    );
    void persistInsertedVisualSource(result.source);
  };

  const insertVisualComponentById = (componentId: string, targetNodeId?: string): void => {
    const component = visualComponentById(componentId);
    if (!component) {
      setMessage(`Unknown visual component ${componentId}.`);
      return;
    }
    insertVisualComponent(component, targetNodeId ?? visualTargetNodeId);
  };

  const moveNavigatorPanel = (sourcePanel: NavigatorPanelId, target: NavigatorPanelId): void => {
    if (sourcePanel === target) return;
    setNavigatorOrder((current) => {
      const next = [...current];
      const from = next.indexOf(sourcePanel);
      const to = next.indexOf(target);
      if (from < 0 || to < 0) return current;
      next.splice(from, 1);
      next.splice(to, 0, sourcePanel);
      window.localStorage.setItem(NAVIGATOR_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  };

  const navigatorDragHandle = (panel: NavigatorPanelId) => ({
    draggable: true as const,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-srijika-panel', panel);
      setDraggedNavigatorPanel(panel);
    },
    onDragEnd: () => setDraggedNavigatorPanel(null),
  });

  const handleLiveComponentDrop = (componentId: string, targetSource: string | null): void => {
    let targetNodeId = visualTargetNodeId;
    const match = /^([A-Za-z0-9_./ -]+):(\d+):(\d+)$/.exec(targetSource ?? '');
    if (
      match &&
      match[1]?.endsWith(architectureRoots.uiSuffix) &&
      sourceMap &&
      activeUiSourceEntry?.relativePath === match[1]
    ) {
      targetNodeId =
        nodeIdAtSourceLocation(source, sourceMap.nodes, Number(match[2]), Number(match[3])) ??
        targetNodeId;
    }
    insertVisualComponentById(componentId, targetNodeId ?? undefined);
    setDraggedComponentId(null);
  };

  if (!hasLoadedSource || projectChooserOpen) {
    return (
      <div className="code-first-shell code-first-welcome-shell">
        <ProjectWelcomeScreen
          mode={desktopMode ? 'desktop' : 'browser'}
          disabled={busy || projectRuntimeBlocksTransition}
          statusMessage={message}
          recentProject={
            recoverableProject
              ? {
                  displayName: recoverableProject.displayName,
                  path: recoverableProject.rootPath,
                }
              : null
          }
          onCreateProject={() => void handleNewProject()}
          onOpenProject={() => void handleOpenProject()}
          onOpenStandaloneUi={() => void handleOpen()}
          onImportReactProject={() => void handleReactMigration('start')}
          onInspectReactMigration={() => void handleReactMigration('status')}
          onVerifyReactMigration={() => void handleReactMigration('verify')}
          onResumeProject={() => void handleResumeProject()}
          onBackToProject={hasLoadedSource ? () => setProjectChooserOpen(false) : undefined}
          onOpenStructure={() => setStructureGuideOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <input
          ref={browserFileInputRef}
          hidden
          type="file"
          accept=".ui.tsx"
          onChange={(event) => void handleBrowserFile(event.target.files?.[0])}
        />
        {settingsOpen && <SettingsDialog open onClose={() => setSettingsOpen(false)} />}
        {structureGuideOpen && (
          <StructureGuideDialog onClose={() => setStructureGuideOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="code-first-shell">
      <header className="code-first-toolbar">
        <div className="code-first-brand">
          <strong>Srijika Studio</strong>
          <span>TSX source of truth</span>
        </div>
        <button type="button" onClick={() => setProjectChooserOpen(true)}>
          Projects
        </button>
        <button
          type="button"
          disabled={busy || projectRuntimeBlocksTransition}
          title={
            desktopMode
              ? 'Create an independent React project folder'
              : 'Create a browser demo whose files stay in memory'
          }
          onClick={() => void handleNewProject()}
        >
          {desktopMode ? 'New project' : 'New demo project'}
        </button>
        {desktopMode && (
          <button
            type="button"
            disabled={busy || projectRuntimeBlocksTransition}
            onClick={() => void handleOpenProject()}
          >
            Open project
          </button>
        )}
        <button
          type="button"
          disabled={busy || projectRuntimeBlocksTransition}
          title={
            desktopMode
              ? 'Open one standalone .ui.tsx preview without attaching its project'
              : 'Choose one .ui.tsx file. Project folders must be opened in desktop Studio.'
          }
          onClick={() => void handleOpen()}
        >
          {desktopMode ? 'Open standalone UI' : 'Import one .ui.tsx file'}
        </button>
        <button
          type="button"
          disabled={busy || !dirty}
          title="Persist AST-safe visual edits generated by Srijika Studio"
          onClick={() => void handleSaveVisualEdits()}
        >
          Save visual edits
        </button>
        <button type="button" disabled={busy || !sourcePath} onClick={() => void handleReload()}>
          Reload
        </button>
        <button
          type="button"
          disabled={busy || !projectRoot}
          title={
            projectRoot
              ? 'Open the selected file or project folder in VS Code'
              : 'Desktop project required'
          }
          onClick={() => {
            if (selectedProjectEntry) handleOpenProjectEntry(selectedProjectEntry);
            else void openProjectLocationInVsCode();
          }}
        >
          Open in VS Code
        </button>
        <button
          type="button"
          disabled={busy || openingPreview || runtimeAction !== null}
          title={
            projectRoot && desktopMode
              ? 'Build and start the managed project if needed, then open that live app in Srijika'
              : 'Open the install-free derived preview'
          }
          onClick={() => void handlePreview()}
        >
          {openingPreview ? 'Opening live preview…' : 'Browser preview'}
        </button>
        <button
          type="button"
          aria-label="Enter fullscreen preview"
          disabled={busy || !document}
          title={
            document
              ? 'Open the selected UI document in fullscreen'
              : 'Select a valid UI source first'
          }
          onClick={() => setFullscreenPreview(true)}
        >
          Fullscreen
        </button>
        <button
          type="button"
          aria-label="Open structure guide"
          title="Feature, slot, part, and ownership rules"
          onClick={() => setStructureGuideOpen(true)}
        >
          Structure
        </button>
        <button type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        <span className="code-first-toolbar-spacer" />
        <span
          className="code-first-save-state"
          title={sourcePath ?? fileName}
          role={
            message &&
            /^(?:Could not|Unexpected|Preview .*failed|Source watch failed)/.test(message)
              ? 'alert'
              : 'status'
          }
        >
          {externalChange
            ? 'VS Code changed this file while a Studio-generated visual edit is unsaved'
            : (message ??
              (dirty ? 'Studio-generated visual edit not saved' : (sourcePath ?? fileName)))}
        </span>
        <input
          ref={browserFileInputRef}
          hidden
          type="file"
          accept=".ui.tsx"
          onChange={(event) => void handleBrowserFile(event.target.files?.[0])}
        />
      </header>

      <section className="code-first-runtimebar" aria-label="Project runtime">
        <div className="code-first-runtime-status code-first-workspace-mode">
          <span className={`code-first-mode-dot is-${desktopMode ? 'desktop' : 'browser'}`} />
          <span className="code-first-runtime-label">
            {desktopMode ? 'Desktop workspace' : 'Browser demo'}
          </span>
          <span>{desktopMode ? 'real project folder' : 'files stay in memory'}</span>
        </div>
        <span className="code-first-runtime-divider" aria-hidden="true" />
        <div className="code-first-runtime-status">
          <span className="code-first-runtime-label">Live UI</span>
          <span className={liveProjectUrl ? 'is-ok' : undefined}>
            {baseName(fileName)} · Connector target
          </span>
        </div>
        <span className="code-first-runtime-divider" aria-hidden="true" />
        <div className="code-first-runtime-status">
          <span className="code-first-runtime-label">App runtime</span>
          <span
            className={fullAppHasError ? 'is-error' : runtimeStatus?.running ? 'is-ok' : undefined}
          >
            {fullAppStatus}
          </span>
        </div>
        {runtimeStatus?.framework === 'next-app-router' && (
          <>
            <span className="code-first-runtime-divider" aria-hidden="true" />
            <div className="code-first-runtime-status code-first-next-route-controls">
              <label htmlFor="srijika-next-preview-route" className="code-first-runtime-label">
                Next route
              </label>
              <select
                id="srijika-next-preview-route"
                aria-label="Next preview route"
                value={selectedNextRoute?.id ?? ''}
                onChange={(event) => {
                  setSelectedNextRouteId(event.target.value);
                  setNextRouteValues({});
                }}
              >
                {discoveredNextRoutes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.pathname}
                    {route.routeGroups.length > 0 ? ` · ${route.routeGroups.join(' ')}` : ''}
                    {route.states.length > 0 ? ` · ${route.states.join('/')}` : ''}
                  </option>
                ))}
              </select>
              {selectedNextRoute?.parameters.map((parameter) => (
                <input
                  key={parameter.name}
                  aria-label={`Next route parameter ${parameter.name}`}
                  value={nextRouteValues[parameter.name] ?? ''}
                  placeholder={
                    parameter.kind === 'single'
                      ? parameter.name
                      : `${parameter.name}/segments${parameter.kind === 'optional-catch-all' ? ' (optional)' : ''}`
                  }
                  onChange={(event) =>
                    setNextRouteValues((current) => ({
                      ...current,
                      [parameter.name]: event.target.value,
                    }))
                  }
                />
              ))}
            </div>
          </>
        )}
        <span className="code-first-toolbar-spacer" />
        <button
          type="button"
          disabled={
            !projectRoot ||
            !isTauriDesktop() ||
            !runtimeStatus ||
            runtimeAction !== null ||
            runtimeStatus.activeTask !== null ||
            runtimeStatus.running ||
            runtimeStatus.dependencyState === 'missingLockfile' ||
            runtimeStatus.dependencyState === 'ready'
          }
          title={
            projectRoot ? 'Install the exact lockfile dependencies' : 'Desktop project required'
          }
          onClick={() => void handleRuntimeAction('install')}
        >
          Install / Sync
        </button>
        <button
          type="button"
          disabled={
            !projectRoot ||
            !isTauriDesktop() ||
            !runtimeStatus ||
            runtimeAction !== null ||
            runtimeStatus.activeTask !== null ||
            runtimeStatus.running ||
            runtimeStatus.dependencyState === 'missingLockfile'
          }
          title={
            projectRoot
              ? 'Synchronize dependencies if needed, then start the complete application'
              : 'Desktop project required'
          }
          onClick={() => void handleRuntimeAction('run')}
        >
          Run App
        </button>
        <button
          type="button"
          disabled={
            !projectRoot ||
            !isTauriDesktop() ||
            openingApp ||
            runtimeAction !== null ||
            !runtimeStatus?.running ||
            !runtimeStatus.devServer.ready
          }
          title="Open the ready, managed loopback application in your system browser"
          onClick={() => void handleOpenRunningApp()}
        >
          {openingApp ? 'Opening…' : 'Open App'}
        </button>
        <button
          type="button"
          disabled={!projectRoot || openingApp || runtimeAction !== null || !runtimeStatus?.running}
          onClick={() => void handleRuntimeAction('stop')}
        >
          Stop
        </button>
        <button
          type="button"
          disabled={
            !projectRoot ||
            !isTauriDesktop() ||
            !runtimeStatus ||
            runtimeAction !== null ||
            runtimeStatus.activeTask !== null ||
            runtimeStatus.running ||
            runtimeStatus.dependencyState === 'missingLockfile'
          }
          title={
            projectRoot
              ? 'Synchronize dependencies if needed, then create a production build'
              : 'Desktop project required'
          }
          onClick={() => void handleRuntimeAction('build')}
        >
          Build App
        </button>
        <button
          type="button"
          disabled={!projectRoot || !desktopMode || busy || ownerTestsBusy}
          title="Create or safely update owner-scoped Vitest and Playwright artifacts"
          onClick={() => void handleOwnerTests('sync')}
        >
          {ownerTestsBusy ? 'Owner tests…' : 'Sync Owner Tests'}
        </button>
        <button
          type="button"
          disabled={!projectRoot || !desktopMode || busy || ownerTestsBusy}
          title="Synchronize and run architecture, typecheck, Vitest, and Playwright owner gates"
          onClick={() => void handleOwnerTests('verify')}
        >
          Verify Owner Tests
        </button>
        <button
          type="button"
          disabled={!projectRoot || !desktopMode || busy || ownerTestsBusy}
          title="Read owner-wise passed, failed, uncovered, and not-run evidence"
          onClick={() => void handleOwnerTests('evidence')}
        >
          Test Evidence
        </button>
      </section>

      <div
        className={`code-first-workspace${sourceVisible ? '' : ' is-source-hidden'}${problemsExpanded ? '' : ' is-problems-collapsed'}`}
        role="main"
        aria-label="Page editor workspace"
      >
        <aside className="code-first-navigator" aria-label="Project and UI navigation">
          {navigatorOrder.map((panel) => (
            <div
              key={panel === 'project' ? `${panel}:${projectDisplay ?? 'detached'}` : panel}
              className={`code-first-navigator-slot${draggedNavigatorPanel === panel ? ' is-dragging' : ''}`}
              data-navigator-panel={panel}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('application/x-srijika-panel')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                const sourcePanel = event.dataTransfer.getData('application/x-srijika-panel');
                if (!DEFAULT_NAVIGATOR_ORDER.includes(sourcePanel as NavigatorPanelId)) return;
                event.preventDefault();
                moveNavigatorPanel(sourcePanel as NavigatorPanelId, panel);
              }}
            >
              {panel === 'project' ? (
                <ProjectExplorer
                  mode={desktopMode ? 'desktop' : 'browser'}
                  displayName={projectDisplay}
                  rootPath={projectRoot}
                  entries={projectEntries}
                  selectedPath={selectedProjectPath}
                  activeUiSourcePath={activeUiSourcePath}
                  changedUiSourcePaths={changedUiSourcePaths}
                  loading={projectIndexStatus === 'loading'}
                  truncated={projectIndexTruncated}
                  creationDisabled={projectCreationBlocked}
                  standaloneSourceName={standaloneSourceName}
                  architectureRoots={architectureRoots}
                  dragHandleProps={navigatorDragHandle('project')}
                  onRefresh={handleRefreshProject}
                  onNewProject={() => void handleNewProject()}
                  onOpenProject={() => void handleOpenProject()}
                  onCreatePage={openCreateUiDialog}
                  onCreateFeature={() => openCreateStructureDialog(architectureRoots.featuresRoot)}
                  onCreateStructure={
                    desktopMode && projectRoot ? openCreateStructureDialog : undefined
                  }
                  onSelect={(entry) => void handleSelectProjectEntry(entry)}
                  onSelectRoot={() => selectProjectPath(projectRoot)}
                  onOpenRoot={() => void openProjectLocationInVsCode()}
                  onOpenEntry={handleOpenProjectEntry}
                />
              ) : panel === 'components' ? (
                <VisualComponentPalette
                  selectedTarget={visualTargetLabel}
                  disabled={!sourceMap || previewStale || busy}
                  dragHandleProps={navigatorDragHandle('components')}
                  onInsert={insertVisualComponent}
                  onDragStateChange={setDraggedComponentId}
                />
              ) : (
                <UiNodesPanel
                  document={document}
                  sourceMap={sourceMap}
                  fileName={fileName}
                  selectedNodeId={selectedNodeId}
                  componentSelected={componentFunctionSelected}
                  dragHandleProps={navigatorDragHandle('nodes')}
                  onSelectComponent={() => setComponentSelectionFile(fileName)}
                  onSelect={(nodeId) => {
                    setComponentSelectionFile(null);
                    selectNode(nodeId);
                  }}
                  onRevealSource={(_nodeId, span) => revealSpan(span)}
                  onOpenSource={handleOpenUiNode}
                  onDropComponent={(nodeId, componentId) =>
                    insertVisualComponentById(componentId, nodeId)
                  }
                />
              )}
            </div>
          ))}
        </aside>

        {sourceVisible && (
          <section
            className={`code-first-source-column${externalChange ? ' has-external-change' : ''}`}
            aria-label="TSX source workspace"
          >
            <div className="code-first-panel-header code-first-source-header">
              <h2>Source viewer</h2>
              <span className="code-first-file-meta" title={sourcePath ?? fileName}>
                {fileName}
              </span>
              <span className="code-first-toolbar-spacer" />
              <span className="code-first-badge">read-only</span>
              {dirty && <span className="code-first-badge">modified</span>}
              <button
                type="button"
                className="code-first-panel-action"
                aria-label="Hide source viewer"
                onClick={() => setSourceVisible(false)}
              >
                Hide
              </button>
            </div>
            {externalChange && (
              <div className="code-first-source-conflict" role="alert">
                <div>
                  <strong>VS Code has a newer saved version</strong>
                  <p>
                    Studio is still protecting an unsaved visual edit. Load the saved VS Code source
                    to recompile its props, UI Nodes, preview, and Inspector.
                  </p>
                </div>
                <button
                  type="button"
                  className="code-first-source-conflict__reload"
                  disabled={busy}
                  onClick={() => void handleReload()}
                >
                  Load VS Code changes
                </button>
              </div>
            )}
            <textarea
              ref={sourceInputRef}
              className="code-first-editor"
              aria-label="Srijika TSX source"
              aria-readonly="true"
              value={source}
              readOnly
              spellCheck={false}
            />
          </section>
        )}

        <section
          className="code-first-preview-column"
          aria-label={showFullAppPreview ? 'Live application preview' : 'Derived UI preview'}
        >
          <div className="code-first-panel-header">
            <h2>{showFullAppPreview ? 'Live app preview' : 'Browser UI preview'}</h2>
            {!sourceVisible && (
              <button
                type="button"
                className="code-first-panel-action"
                aria-label="Show source viewer"
                onClick={() => setSourceVisible(true)}
              >
                Show source
              </button>
            )}
            <span className="code-first-toolbar-spacer" />
            {showFullAppPreview ? (
              <>
                <span
                  className={`code-first-badge${
                    liveProjectUrl && livePreviewRuntimeState?.state === 'ready'
                      ? ' is-valid'
                      : runtimeError ||
                          livePreviewRuntimeState?.state === 'error' ||
                          livePreviewRuntimeState?.state === 'unsupported'
                        ? ' is-stale'
                        : ''
                  }`}
                  title={livePreviewRuntimeState?.error ?? fullAppStatus}
                >
                  {liveProjectUrl
                    ? livePreviewRuntimeState?.state === 'ready'
                      ? `live ${baseName(fileName)}`
                      : livePreviewRuntimeState?.state === 'error'
                        ? 'UI runtime failed'
                        : livePreviewRuntimeState?.state === 'unsupported'
                          ? 'runtime bridge unavailable'
                          : `switching ${baseName(fileName)}`
                    : runtimeAction === 'run' || runtimeAction === 'install'
                      ? 'starting'
                      : runtimeError
                        ? document
                          ? 'last good · app failed'
                          : 'failed'
                        : nextPreviewRouteError
                          ? 'route needs input'
                          : 'app stopped'}
                </span>
                {liveProjectUrl && <span className="code-first-badge">HMR</span>}
              </>
            ) : (
              <>
                {previewStale ? (
                  <span className="code-first-badge is-stale">last valid</span>
                ) : (
                  <span className={`code-first-badge is-${compileStatus}`}>{compileStatus}</span>
                )}
                <span
                  className={`code-first-badge${previewStylesError ? ' is-stale' : ''}`}
                  title={
                    previewStylesError ??
                    previewStylesheets.map((style) => style.relativePath).join(', ')
                  }
                >
                  {previewStylesError
                    ? 'CSS issue'
                    : previewStylesheets.length === 0
                      ? 'CSS default'
                      : `CSS ${previewStylesheets.length}`}
                </span>
              </>
            )}
          </div>
          <div
            className="code-first-preview-scroll"
            tabIndex={0}
            aria-label="Preview canvas scroll area"
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('application/x-srijika-component')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(event) => {
              const componentId = event.dataTransfer.getData('application/x-srijika-component');
              if (!componentId) return;
              event.preventDefault();
              insertVisualComponentById(componentId);
              setDraggedComponentId(null);
            }}
          >
            {showFullAppPreview ? (
              liveProjectUrl ? (
                <LiveCodeProjectFrame
                  url={liveProjectUrl}
                  selectedSource={selectedLiveSource}
                  uiSuffix={architectureRoots.uiSuffix}
                  allowedUiSources={livePreviewUiSources}
                  onSelectSource={(location) => void handleLivePreviewSourceSelection(location)}
                  onRuntimeState={setLivePreviewRuntimeState}
                  dragActive={draggedComponentId !== null}
                  onDropComponent={handleLiveComponentDrop}
                />
              ) : runtimeError && document ? (
                <div data-preview-runtime="last-good-derived">
                  <div className="code-first-live-preview-fallback" role="alert">
                    Live application startup failed. Showing the last valid derived UI:{' '}
                    {runtimeError}
                  </div>
                  <CodeFirstPreviewFrame
                    document={document}
                    selectedNodeId={selectedNodeId}
                    stylesheets={previewStylesheets}
                    assets={previewAssets}
                    symbols={symbols}
                    stale
                    onSelectNode={selectNodeAndReveal}
                  />
                </div>
              ) : (
                <div className="code-first-live-preview-empty">
                  <div>
                    <strong>
                      {runtimeAction === 'run' || runtimeAction === 'install'
                        ? 'Building and starting the real project…'
                        : nextPreviewRouteError
                          ? 'Complete the selected Next route'
                          : runtimeError
                            ? 'The real application could not start'
                            : 'Start the app to preview the selected UI'}
                    </strong>
                    <p>
                      {nextPreviewRouteError ??
                        (runtimeError
                          ? runtimeError
                          : `The center view uses the managed ${runtimeStatus?.framework === 'next-app-router' ? 'Next.js' : 'Vite'} application with its real routes, providers, CSS, dependencies, assets, state, APIs, and HMR.`)}
                    </p>
                    {!nextPreviewRouteError && (
                      <button
                        type="button"
                        disabled={
                          runtimeAction !== null ||
                          runtimeStatus?.activeTask !== null ||
                          runtimeStatus?.dependencyState === 'missingLockfile'
                        }
                        onClick={() => void handleRuntimeAction('run')}
                      >
                        {runtimeAction === 'run' || runtimeAction === 'install'
                          ? 'Starting App…'
                          : runtimeError
                            ? 'Retry App'
                            : 'Start App'}
                      </button>
                    )}
                  </div>
                </div>
              )
            ) : document ? (
              <CodeFirstPreviewFrame
                document={document}
                selectedNodeId={selectedNodeId}
                stylesheets={previewStylesheets}
                assets={previewAssets}
                symbols={symbols}
                stale={previewStale}
                onSelectNode={selectNodeAndReveal}
              />
            ) : (
              <div className="code-first-empty">
                Fix the TSX structure to create the first safe derived preview.
              </div>
            )}
          </div>
        </section>

        <section
          className={`code-first-console${problemsExpanded ? '' : ' is-collapsed'}`}
          aria-label="Srijika diagnostics console"
        >
          <div className="code-first-console-header">
            <span>Problems</span>
            <span className="code-first-badge">
              {blockingProblemCount} {blockingProblemCount === 1 ? 'issue' : 'issues'}
            </span>
            {architectureCheckedFileCount > 0 && (
              <span className="code-first-badge" title="Feature, Slot, and Part ownership scan">
                {architectureCheckedFileCount} architecture files checked
              </span>
            )}
            {architectureRecommendations.length > 0 && (
              <span
                className="code-first-badge"
                title="Deterministic progressive architecture guidance"
              >
                {architectureRecommendations.length}{' '}
                {architectureRecommendations.length === 1 ? 'recommendation' : 'recommendations'}
              </span>
            )}
            <span className="code-first-toolbar-spacer" />
            <button
              type="button"
              className="code-first-panel-action"
              aria-expanded={problemsExpanded}
              aria-controls="srijika-problems-content"
              onClick={() => setProblemsExpanded((current) => !current)}
            >
              {problemsExpanded ? 'Minimize' : 'Open'}
            </button>
          </div>
          {problemsExpanded && (
            <div id="srijika-problems-content" className="code-first-console-content">
              <DiagnosticList
                problems={problems}
                selectedKey={selectedProblemKey}
                onSelect={handleSelectProblem}
              />
            </div>
          )}
        </section>

        <aside className="code-first-inspector" aria-label="Srijika source Inspector">
          <div className="code-first-panel-header">
            <h2>Inspector</h2>
            <span className="code-first-toolbar-spacer" />
            <span className="code-first-badge">read model</span>
          </div>
          <div className="code-first-inspector-scroll">
            {selectedDiagnostic && (
              <section
                className="code-first-inspector-card code-first-problem-details"
                aria-label="Selected problem details"
              >
                <div className="code-first-inspector-card-heading">
                  <div>
                    <p className="code-first-inspector-eyebrow">Selected problem</p>
                    <h3>{selectedDiagnostic.code}</h3>
                  </div>
                  <span className="code-first-inspector-chip">
                    {selectedProblem?.kind === 'architecture'
                      ? selectedProblem.diagnostic.severity === 'warning'
                        ? 'Architecture recommendation'
                        : 'Architecture boundary'
                      : 'Needs attention'}
                  </span>
                </div>
                <div className="code-first-problem-explanation">
                  <h4>Why this happens</h4>
                  <p>{selectedDiagnostic.message}</p>
                  <span>
                    {problemDisplayPath(selectedDiagnostic.fileName)}:{selectedDiagnostic.span.line}
                    :{selectedDiagnostic.span.column}
                  </span>
                </div>
                <div className="code-first-problem-fixes" aria-label="Available problem fixes">
                  <h4>Recommended action</h4>
                  {selectedProblem?.kind === 'architecture' ? (
                    <>
                      <p className="code-first-inspector-help">
                        {selectedProblem.diagnostic.guidance}
                      </p>
                      {selectedProblem.diagnostic.ruleId ? (
                        <code className="code-first-inspector-expression">
                          {selectedProblem.diagnostic.ruleId}
                        </code>
                      ) : null}
                    </>
                  ) : selectedDiagnosticPrimaryFix ? (
                    <button
                      className="code-first-fix is-primary"
                      type="button"
                      onClick={() => applyFix(selectedDiagnosticPrimaryFix)}
                    >
                      {selectedDiagnosticPrimaryFix.title}
                    </button>
                  ) : (
                    <p className="code-first-inspector-help">
                      No automatic source edit is safe for this rule. Open the exact source location
                      in VS Code.
                    </p>
                  )}
                  {selectedDiagnosticOtherFixes.length > 0 && (
                    <details className="code-first-problem-more-fixes">
                      <summary>More safe fixes ({selectedDiagnosticOtherFixes.length})</summary>
                      <div>
                        {selectedDiagnosticOtherFixes.map((fix) => (
                          <button
                            key={`${fix.kind}-${fix.title}`}
                            className="code-first-fix"
                            type="button"
                            onClick={() => applyFix(fix)}
                          >
                            {fix.title}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
                <button
                  className="code-first-inspector-action"
                  type="button"
                  onClick={handleOpenSelectedDiagnostic}
                >
                  Open exact line in VS Code
                </button>
              </section>
            )}

            <CodeFirstInspectorPanel
              document={document}
              componentContract={componentContract}
              framework={framework}
              selectedNodeId={componentFunctionSelected ? null : selectedNodeId}
              fileName={fileName}
              sourceMap={sourceMap}
              onRevealSource={(_nodeId, span) => revealSpan(span)}
              isLiteralPropEditable={({ nodeId, propName, value }) => {
                if (previewStale || !sourceMap) {
                  return {
                    editable: false,
                    reason: previewStale
                      ? 'The preview is using the last valid source.'
                      : 'The source map is unavailable.',
                  };
                }
                const probe = replaceSrijikaNodeProp(source, sourceMap, nodeId, propName, value);
                return probe.ok ? { editable: true } : { editable: false, reason: probe.message };
              }}
              onApplyLiteralProp={({ nodeId, propName, value }) => {
                if (!sourceMap) return { ok: false, message: 'The source map is unavailable.' };
                const result = replaceSrijikaNodeProp(source, sourceMap, nodeId, propName, value);
                if (!result.ok) return { ok: false, message: result.message };
                applyNodePropEdit(result.source, propName);
                return { ok: true };
              }}
              onInsertLiteralProp={({ nodeId, propName, value }) => {
                if (!sourceMap) return { ok: false, message: 'The source map is unavailable.' };
                const result = insertSrijikaNodeProp(source, sourceMap, nodeId, propName, value);
                if (!result.ok) return { ok: false, message: result.message };
                updateSource(result.source);
                setMessage(`Added ${propName} to authoritative TSX.`);
                window.requestAnimationFrame(() => selectNode(nodeId));
                return { ok: true };
              }}
              onBindEvent={({ nodeId, eventName, callbackPropName }) => {
                if (!sourceMap) return { ok: false, message: 'The source map is unavailable.' };
                const result = bindSrijikaNodeEvent(
                  source,
                  sourceMap,
                  nodeId,
                  eventName,
                  callbackPropName,
                );
                if (!result.ok) return { ok: false, message: result.message };
                updateSource(result.source);
                setMessage(`Connected ${eventName} to props.${callbackPropName} in TSX.`);
                window.requestAnimationFrame(() => selectNode(nodeId));
                return { ok: true };
              }}
              onInsertContractMember={(input) => {
                if (!sourceMap) return { ok: false, message: 'The source map is unavailable.' };
                const result = insertSrijikaContractMember(source, sourceMap, input);
                if (!result.ok) return { ok: false, message: result.message };
                updateSource(result.source);
                setMessage(`Added ${input.name} to the authoritative UI contract.`);
                return { ok: true };
              }}
              selectedNodeActions={
                selectedNode && selectedLiteralText !== null ? (
                  <div className="code-first-text-edit">
                    <label className="code-first-subtle" htmlFor="code-first-text-value">
                      Visual text override (AST-safe TSX edit)
                    </label>
                    <input
                      id="code-first-text-value"
                      value={textDraft}
                      disabled={!canEditSelectedText}
                      onChange={(event) =>
                        setTextDraftState({
                          nodeId: selectedNode.id,
                          value: event.target.value,
                        })
                      }
                    />
                    <button
                      className="code-first-fix"
                      type="button"
                      disabled={!canEditSelectedText || textDraft === selectedLiteralText}
                      onClick={applyTextEdit}
                    >
                      Apply validated visual edit
                    </button>
                  </div>
                ) : null
              }
            />

            <section className="code-first-section">
              <h3>Authority</h3>
              <p className="code-first-subtle">
                TSX remains authoritative and the source viewer never accepts manual typing.
                Deliberate Inspector and diagnostic actions may emit validated AST-safe source
                edits; normal coding belongs in VS Code.
              </p>
            </section>
          </div>
        </aside>
      </div>

      <footer className="code-first-statusbar">
        <span
          className={
            compileStatus === 'valid' && architectureErrorCount === 0 ? 'is-ok' : 'is-error'
          }
        >
          {compileStatus !== 'valid'
            ? `${diagnostics.length} source ${diagnostics.length === 1 ? 'problem' : 'problems'}`
            : architectureErrorCount > 0
              ? `${architectureErrorCount} architecture ${architectureErrorCount === 1 ? 'problem' : 'problems'}`
              : architectureRecommendations.length > 0
                ? `${architectureRecommendations.length} architecture ${architectureRecommendations.length === 1 ? 'recommendation' : 'recommendations'}`
                : 'Srijika contract valid'}
        </span>
        <span>TSX → UiDocument</span>
        {document && <span>{Object.keys(document.nodes).length} derived nodes</span>}
        {projectDisplay && (
          <span>{projectEntries.filter((entry) => entry.isUiSource).length} UI files indexed</span>
        )}
        {projectIndexError && <span className="is-error">Project scan: {projectIndexError}</span>}
        <span className="code-first-status-spacer" />
        <span>React Compiler project policy: enabled</span>
        <span>AST v{document?.formatVersion ?? '—'}</span>
      </footer>

      {fullscreenPreview && document && (
        <FullscreenPreview
          documentOverride={document}
          symbolValuesOverride={symbols}
          onClose={() => setFullscreenPreview(false)}
        />
      )}
      {settingsOpen && <SettingsDialog open onClose={() => setSettingsOpen(false)} />}
      {structureGuideOpen && (
        <StructureGuideDialog
          architectureRoots={architectureRoots}
          onClose={() => setStructureGuideOpen(false)}
          onCreateStructure={
            desktopMode && projectRoot
              ? () => {
                  setStructureGuideOpen(false);
                  openCreateStructureDialog(architectureRoots.featuresRoot);
                }
              : undefined
          }
        />
      )}
      {createDialogRequest && (
        <CreateUiSourceDialog
          initialFolder={createDialogRequest.folder}
          uiSuffix={architectureRoots.uiSuffix}
          connectorSuffix={architectureRoots.connectorSuffix}
          existingRelativePaths={projectEntries.map((entry) => entry.relativePath)}
          onClose={closeCreateUiDialog}
          onCreate={handleCreateUiSource}
        />
      )}
      {structureDialogOwner && (
        <CreateStructureItemDialog
          owner={structureDialogOwner}
          architectureRoots={architectureRoots}
          existingRelativePaths={projectEntries.map((entry) => entry.relativePath)}
          onClose={() => setStructureDialogOwner(null)}
          onCreate={handleCreateStructure}
        />
      )}
      {ownerTestEvidence && (
        <OwnerTestEvidenceDialog
          evidence={ownerTestEvidence}
          onClose={() => setOwnerTestEvidence(null)}
        />
      )}
    </div>
  );
}
