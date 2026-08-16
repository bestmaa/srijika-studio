import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  File,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';

import {
  resolveSrijikaStructureOwner,
  type SrijikaArchitectureConfig,
} from '@srijika/architecture-rules';

import type { CodeProjectEntry } from '../../lib/project-service';

interface ProjectTreeNode {
  entry: CodeProjectEntry;
  children: ProjectTreeNode[];
}

export interface ProjectExplorerProps {
  mode: 'browser' | 'desktop';
  displayName: string | null;
  rootPath: string | null;
  entries: readonly CodeProjectEntry[];
  selectedPath: string | null;
  activeUiSourcePath: string | null;
  changedUiSourcePaths?: readonly string[];
  loading?: boolean;
  truncated?: boolean;
  creationDisabled?: boolean;
  standaloneSourceName?: string | null;
  architectureRoots?: Partial<SrijikaArchitectureConfig> | undefined;
  onRefresh: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onCreatePage: (folder?: string) => void;
  onCreateFeature: () => void;
  onCreateStructure?: ((folder: string) => void) | undefined;
  onSelect: (entry: CodeProjectEntry) => void;
  onSelectRoot: () => void;
  onOpenRoot: () => void;
  onOpenEntry: (entry: CodeProjectEntry) => void;
  dragHandleProps?:
    | {
        draggable: true;
        onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
        onDragEnd: () => void;
      }
    | undefined;
}

function joinProjectPath(rootPath: string, relativePath: string): string {
  return `${rootPath.replace(/[\\/]+$/, '')}/${relativePath}`;
}

export function codeProjectEntriesFromFileMap(
  files: Readonly<Record<string, string>>,
  rootPath = 'srijika-memory:/srijika-app',
  architecture?: Partial<SrijikaArchitectureConfig>,
): readonly CodeProjectEntry[] {
  const uiSuffix = architecture?.uiSuffix ?? '.ui.tsx';
  const entries = new Map<string, CodeProjectEntry>();
  for (const [rawPath, contents] of Object.entries(files)) {
    const relativePath = rawPath.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!relativePath || relativePath.split('/').some((part) => !part || part === '..')) continue;
    const parts = relativePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const directoryPath = parts.slice(0, index).join('/');
      entries.set(directoryPath, {
        path: joinProjectPath(rootPath, directoryPath),
        relativePath: directoryPath,
        kind: 'directory',
        bytes: null,
        hash: null,
        isUiSource: false,
      });
    }
    entries.set(relativePath, {
      path: joinProjectPath(rootPath, relativePath),
      relativePath,
      kind: 'file',
      bytes: new TextEncoder().encode(contents).byteLength,
      hash: null,
      isUiSource: relativePath.endsWith(uiSuffix),
    });
  }
  return [...entries.values()];
}

function projectTree(entries: readonly CodeProjectEntry[]): readonly ProjectTreeNode[] {
  const nodes = new Map<string, ProjectTreeNode>();
  for (const entry of entries) nodes.set(entry.relativePath, { entry, children: [] });
  const roots: ProjectTreeNode[] = [];
  for (const node of nodes.values()) {
    const separator = node.entry.relativePath.lastIndexOf('/');
    const parentPath = separator < 0 ? '' : node.entry.relativePath.slice(0, separator);
    const parent = nodes.get(parentPath);
    if (parent?.entry.kind === 'directory') parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: ProjectTreeNode[]): void => {
    items.sort((left, right) => {
      if (left.entry.kind !== right.entry.kind) return left.entry.kind === 'directory' ? -1 : 1;
      return left.entry.relativePath.localeCompare(right.entry.relativePath, undefined, {
        sensitivity: 'base',
      });
    });
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

function entryName(entry: CodeProjectEntry): string {
  return entry.relativePath.split('/').at(-1) ?? entry.relativePath;
}

interface ProjectTreeRowProps {
  node: ProjectTreeNode;
  depth: number;
  selectedPath: string | null;
  activeUiSourcePath: string | null;
  changedUiSourcePaths: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  createMenuFolder: string | null;
  creationDisabled: boolean;
  architectureRoots?: Partial<SrijikaArchitectureConfig> | undefined;
  onToggle: (path: string) => void;
  onToggleCreateMenu: (path: string) => void;
  onCreatePage: (folder: string) => void;
  onCreateFeature: () => void;
  onCreateStructure?: ((folder: string) => void) | undefined;
  onSelect: (entry: CodeProjectEntry) => void;
  onOpen: (entry: CodeProjectEntry) => void;
}

function ProjectTreeRow({
  node,
  depth,
  selectedPath,
  activeUiSourcePath,
  changedUiSourcePaths,
  collapsed,
  createMenuFolder,
  creationDisabled,
  architectureRoots,
  onToggle,
  onToggleCreateMenu,
  onCreatePage,
  onCreateFeature,
  onCreateStructure,
  onSelect,
  onOpen,
}: ProjectTreeRowProps) {
  const { entry } = node;
  const isDirectory = entry.kind === 'directory';
  const canCreateStructureInside =
    isDirectory &&
    onCreateStructure !== undefined &&
    resolveSrijikaStructureOwner(entry.relativePath, architectureRoots) !== null;
  const canCreatePageInside =
    isDirectory &&
    (entry.relativePath === 'src' ||
      entry.relativePath === 'src/pages' ||
      entry.relativePath.startsWith('src/pages/'));
  const canCreateFeatureInside = entry.relativePath === 'src' && onCreateStructure !== undefined;
  const canCreateInside = canCreatePageInside || canCreateFeatureInside || canCreateStructureInside;
  const isCollapsed = collapsed.has(entry.relativePath);
  const createMenuOpen = isDirectory && createMenuFolder === entry.relativePath;
  const classes = [
    'code-first-tree-row',
    selectedPath === entry.path ? 'is-selected' : '',
    activeUiSourcePath === entry.path ? 'is-active-source' : '',
    changedUiSourcePaths.has(entry.path) ? 'has-external-change' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      role="treeitem"
      aria-expanded={isDirectory ? !isCollapsed : undefined}
      aria-selected={selectedPath === entry.path}
    >
      <div
        className={classes}
        style={{ paddingInlineStart: 7 + depth * 14 }}
        onContextMenu={(event) => {
          if (!canCreateInside || creationDisabled) return;
          event.preventDefault();
          onSelect(entry);
          if (canCreateStructureInside) onCreateStructure(entry.relativePath);
          else onToggleCreateMenu(entry.relativePath);
        }}
      >
        {isDirectory ? (
          <button
            type="button"
            className="code-first-tree-disclosure"
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${entryName(entry)}`}
            onClick={() => onToggle(entry.relativePath)}
          >
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : (
          <span className="code-first-tree-disclosure" aria-hidden="true" />
        )}
        <button
          type="button"
          className="code-first-tree-label"
          title={entry.relativePath}
          onClick={() => onSelect(entry)}
          onDoubleClick={() => onOpen(entry)}
        >
          <span className="code-first-tree-file-icon" aria-hidden="true">
            {isDirectory ? (
              isCollapsed ? (
                <Folder size={13} />
              ) : (
                <FolderOpen size={13} />
              )
            ) : entry.isUiSource ? (
              <FileCode2 size={13} />
            ) : (
              <File size={13} />
            )}
          </span>
          <span>{entryName(entry)}</span>
          {entry.isUiSource && <span className="code-first-tree-tag">UI</span>}
          {changedUiSourcePaths.has(entry.path) && (
            <span className="code-first-tree-change" title="Changed in an external editor">
              changed
            </span>
          )}
        </button>
        {canCreateInside && (
          <button
            type="button"
            className="code-first-tree-add"
            aria-label={`${canCreatePageInside || canCreateFeatureInside ? 'Add page or feature' : 'Add capability'} inside ${entry.relativePath}`}
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            disabled={creationDisabled}
            title={`Add inside ${entry.relativePath} (or right-click the folder)`}
            onClick={() => {
              onSelect(entry);
              if (canCreateStructureInside) onCreateStructure(entry.relativePath);
              else onToggleCreateMenu(entry.relativePath);
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {createMenuOpen && (
        <div
          className="code-first-tree-create-menu"
          role="menu"
          aria-label={`Create inside ${entry.relativePath}`}
          style={{ marginInlineStart: 25 + depth * 14 }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onToggleCreateMenu(entry.relativePath);
            }
          }}
        >
          <span title={entry.relativePath}>Create in {entryName(entry)}</span>
          {canCreatePageInside ? (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={creationDisabled}
                onClick={() =>
                  onCreatePage(entry.relativePath === 'src' ? 'src/pages' : entry.relativePath)
                }
              >
                <LayoutTemplate size={13} aria-hidden="true" />
                UI page
              </button>
              {canCreateFeatureInside && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={creationDisabled}
                  onClick={onCreateFeature}
                >
                  <Workflow size={13} aria-hidden="true" />
                  New feature
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
      {isDirectory && !isCollapsed && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <ProjectTreeRow
              key={child.entry.relativePath}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              activeUiSourcePath={activeUiSourcePath}
              changedUiSourcePaths={changedUiSourcePaths}
              collapsed={collapsed}
              createMenuFolder={createMenuFolder}
              creationDisabled={creationDisabled}
              architectureRoots={architectureRoots}
              onToggle={onToggle}
              onToggleCreateMenu={onToggleCreateMenu}
              onCreatePage={onCreatePage}
              onCreateFeature={onCreateFeature}
              onCreateStructure={onCreateStructure}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProjectExplorer({
  mode,
  displayName,
  rootPath,
  entries,
  selectedPath,
  activeUiSourcePath,
  changedUiSourcePaths = [],
  loading = false,
  truncated = false,
  creationDisabled = false,
  standaloneSourceName = null,
  architectureRoots,
  onRefresh,
  onNewProject,
  onOpenProject,
  onCreatePage,
  onCreateFeature,
  onCreateStructure,
  onSelect,
  onSelectRoot,
  onOpenRoot,
  onOpenEntry,
  dragHandleProps,
}: ProjectExplorerProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [uiSourcesCollapsed, setUiSourcesCollapsed] = useState(false);
  const [allFilesCollapsed, setAllFilesCollapsed] = useState(false);
  const [createMenuFolder, setCreateMenuFolder] = useState<string | null>(null);
  const tree = useMemo(() => projectTree(entries), [entries]);
  const uiSources = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === 'file' && entry.isUiSource)
        .sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }),
        ),
    [entries],
  );
  const changedPaths = useMemo(() => new Set(changedUiSourcePaths), [changedUiSourcePaths]);
  const directoryPaths = useMemo(
    () => entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.relativePath),
    [entries],
  );
  const toggle = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const chooseCreatePage = (folder: string): void => {
    setCreateMenuFolder(null);
    onCreatePage(folder);
  };
  const selectEntry = (entry: CodeProjectEntry): void => {
    setCreateMenuFolder(null);
    onSelect(entry);
  };

  return (
    <section
      className={`code-first-navigator-section${workspaceCollapsed ? ' is-collapsed' : ''}${allFilesCollapsed ? ' is-files-collapsed' : ''}`}
      aria-label="Project Explorer"
    >
      <div className="code-first-navigator-header">
        <button
          type="button"
          className="code-first-workspace-disclosure"
          aria-label={`${workspaceCollapsed ? 'Expand' : 'Collapse'} project workspace`}
          aria-expanded={displayName ? !workspaceCollapsed : undefined}
          disabled={!displayName}
          onClick={() => setWorkspaceCollapsed((current) => !current)}
        >
          {workspaceCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <button
          type="button"
          className="code-first-workspace-title"
          title={rootPath ?? displayName ?? 'No workspace open'}
          disabled={!displayName}
          onClick={onSelectRoot}
          onDoubleClick={onOpenRoot}
        >
          {displayName?.toLocaleUpperCase('en-US') ?? 'PROJECT'}
        </button>
        <span className="code-first-toolbar-spacer" />
        <div className="code-first-navigator-actions">
          <button
            type="button"
            aria-label="New UI"
            title="New UI page"
            disabled={!displayName || creationDisabled}
            onClick={() => onCreatePage()}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            aria-label="New feature"
            title={`New feature in ${architectureRoots?.featuresRoot ?? 'src/features'}`}
            disabled={!displayName || creationDisabled || mode !== 'desktop'}
            onClick={onCreateFeature}
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            aria-label="Refresh project files"
            title="Refresh project files"
            disabled={loading || (!rootPath && entries.length === 0)}
            onClick={onRefresh}
          >
            <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} />
          </button>
          <button
            type="button"
            aria-label="Collapse all project folders"
            title="Collapse all project folders"
            disabled={directoryPaths.length === 0}
            onClick={() => setCollapsed(new Set(directoryPaths))}
          >
            <ChevronsUp size={14} />
          </button>
          {dragHandleProps && (
            <button
              type="button"
              aria-label="Drag Project panel to reorder"
              title="Drag panel to reorder"
              {...dragHandleProps}
            >
              <GripVertical size={14} />
            </button>
          )}
        </div>
      </div>
      {displayName && !workspaceCollapsed ? (
        <div className="code-first-project-content">
          <section className="code-first-ui-sources" aria-label="UI Sources">
            <header>
              <button
                type="button"
                aria-expanded={!uiSourcesCollapsed}
                onClick={() => setUiSourcesCollapsed((current) => !current)}
              >
                {uiSourcesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span>UI sources</span>
              </button>
              <span className="code-first-badge">{uiSources.length}</span>
            </header>
            {!uiSourcesCollapsed && uiSources.length > 0 ? (
              <ul className="code-first-ui-source-list">
                {uiSources.map((entry) => {
                  const active = entry.path === activeUiSourcePath;
                  const changed = changedPaths.has(entry.path);
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={`code-first-ui-source${active ? ' is-active' : ''}${changed ? ' has-external-change' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={`${entry.relativePath}${mode === 'desktop' ? ' · double-click for VS Code' : ''}`}
                        onClick={() => onSelect(entry)}
                        onDoubleClick={() => onOpenEntry(entry)}
                      >
                        <FileCode2 size={13} aria-hidden="true" />
                        <span>{entryName(entry)}</span>
                        {changed && <small>changed</small>}
                        {active && <small>open</small>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : !uiSourcesCollapsed ? (
              <p>
                No <code>{architectureRoots?.uiSuffix ?? '.ui.tsx'}</code> files indexed yet.
              </p>
            ) : null}
          </section>

          <div className="code-first-files-heading">
            <button
              type="button"
              className="code-first-files-disclosure"
              aria-expanded={!allFilesCollapsed}
              onClick={() => setAllFilesCollapsed((current) => !current)}
            >
              {allFilesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span>All project files</span>
            </button>
            {mode === 'desktop' && (
              <button type="button" onClick={onOpenRoot}>
                Open project in VS Code
              </button>
            )}
          </div>

          {!allFilesCollapsed && (
            <div className="code-first-tree-scroll">
              {tree.length > 0 ? (
                <ul
                  className="code-first-project-tree"
                  role="tree"
                  aria-label={`${displayName} files`}
                >
                  {tree.map((node) => (
                    <ProjectTreeRow
                      key={node.entry.relativePath}
                      node={node}
                      depth={0}
                      selectedPath={selectedPath}
                      activeUiSourcePath={activeUiSourcePath}
                      changedUiSourcePaths={changedPaths}
                      collapsed={collapsed}
                      createMenuFolder={createMenuFolder}
                      creationDisabled={creationDisabled}
                      architectureRoots={architectureRoots}
                      onToggle={toggle}
                      onToggleCreateMenu={(path) =>
                        setCreateMenuFolder((current) => (current === path ? null : path))
                      }
                      onCreatePage={chooseCreatePage}
                      onCreateFeature={onCreateFeature}
                      onCreateStructure={onCreateStructure}
                      onSelect={selectEntry}
                      onOpen={onOpenEntry}
                    />
                  ))}
                </ul>
              ) : (
                <p className="code-first-navigator-empty">
                  {loading ? 'Reading project files…' : 'No project files are indexed.'}
                </p>
              )}
              {truncated && (
                <p className="code-first-project-warning">
                  Project index reached its safe file limit.
                </p>
              )}
            </div>
          )}
        </div>
      ) : !displayName ? (
        <div className="code-first-project-onboarding">
          <span className="code-first-onboarding-kicker">
            {mode === 'desktop' ? 'REAL FOLDER WORKSPACE' : 'BROWSER DEMO'}
          </span>
          <h3>{standaloneSourceName ? 'Standalone UI preview' : 'Start with a Srijika project'}</h3>
          <p>
            {standaloneSourceName
              ? `${standaloneSourceName} is open for preview only. Attach a project to create and switch between UI files.`
              : mode === 'desktop'
                ? 'Create an independent React folder or open an existing Srijika project.'
                : 'Create an in-memory demo project to explore UI files, hierarchy, and preview.'}
          </p>
          <div className="code-first-onboarding-actions">
            <button type="button" disabled={creationDisabled} onClick={onNewProject}>
              {mode === 'desktop' ? 'New project folder' : 'Create demo project'}
            </button>
            <button type="button" disabled={creationDisabled} onClick={onOpenProject}>
              {mode === 'desktop' ? 'Open project folder' : 'Open standalone UI'}
            </button>
          </div>
          <ol>
            <li>Create or open a project.</li>
            <li>
              Use <strong>New UI</strong> for pages or <strong>New feature</strong> for feature
              ownership.
            </li>
            <li>Click any UI source to switch its source, tree, preview, and Inspector.</li>
          </ol>
          <p className="code-first-general-file-note">
            General code, styles, assets, and config stay in VS Code.
          </p>
        </div>
      ) : null}
    </section>
  );
}
