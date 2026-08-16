import * as vscode from 'vscode';

import { resolveSrijikaArchitectureConfig } from '@srijika/architecture-rules';
import { parseSrijikaArchitectureConfig } from './architecture-adapter';
import { discoverSafeSrijikaSources, openSafeSrijikaWorkspace } from './safe-workspace-files';
import {
  buildSrijikaStructureTreeOwners,
  childSrijikaStructureOwners,
  type SrijikaStructureTreeOwner,
} from './structure-tree';

export class SrijikaStructureTreeItem extends vscode.TreeItem {
  constructor(
    readonly workspaceFolder: vscode.WorkspaceFolder,
    readonly structureOwner: SrijikaStructureTreeOwner,
  ) {
    super(
      structureOwner.name,
      structureOwner.level === 'part' ||
        structureOwner.level === 'sharedUi' ||
        structureOwner.level === 'sharedWidget' ||
        structureOwner.level === 'sharedCapability'
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `${workspaceFolder.uri.toString()}::${structureOwner.relativeFolder}`;
    this.contextValue = 'srijikaStructureOwner';
    if (structureOwner.level === 'featuresRoot' || structureOwner.level === 'sharedRoot') {
      this.description = workspaceFolder.name;
    } else if (structureOwner.level === 'sharedUi') {
      this.description = 'pure UI';
    } else if (structureOwner.level === 'sharedWidget') {
      this.description = 'widget';
    } else if (structureOwner.level === 'sharedCapability') {
      this.description = 'headless';
    }
    this.tooltip = `${structureOwner.relativeFolder}\nStrict owner-aware creation only; arbitrary shared files and folders are not offered.`;
    this.resourceUri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      ...structureOwner.relativeFolder.split('/'),
    );
    this.iconPath = new vscode.ThemeIcon(
      structureOwner.level === 'featuresRoot' || structureOwner.level === 'sharedRoot'
        ? 'library'
        : structureOwner.level === 'feature'
          ? 'symbol-module'
          : structureOwner.level === 'slot'
            ? 'symbol-namespace'
            : structureOwner.level === 'part'
              ? 'symbol-method'
              : structureOwner.level === 'sharedUi'
                ? 'symbol-color'
                : structureOwner.level === 'sharedWidget'
                  ? 'symbol-event'
                  : 'symbol-interface',
    );
  }
}

export class SrijikaStructureTreeProvider
  implements vscode.TreeDataProvider<SrijikaStructureTreeItem>, vscode.Disposable
{
  private readonly changes = new vscode.EventEmitter<SrijikaStructureTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  private readonly ownerCache = new Map<string, readonly SrijikaStructureTreeOwner[]>();

  refresh(): void {
    this.ownerCache.clear();
    this.changes.fire(undefined);
  }

  getTreeItem(element: SrijikaStructureTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SrijikaStructureTreeItem): Promise<SrijikaStructureTreeItem[]> {
    if (!element) {
      const roots: SrijikaStructureTreeItem[] = [];
      for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
        const owners = await this.ownersFor(workspaceFolder);
        for (const owner of childSrijikaStructureOwners(owners, null)) {
          roots.push(new SrijikaStructureTreeItem(workspaceFolder, owner));
        }
      }
      return roots;
    }

    const owners = await this.ownersFor(element.workspaceFolder);
    return childSrijikaStructureOwners(owners, element.structureOwner.relativeFolder).map(
      (owner) => new SrijikaStructureTreeItem(element.workspaceFolder, owner),
    );
  }

  dispose(): void {
    this.changes.dispose();
  }

  private async ownersFor(
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<readonly SrijikaStructureTreeOwner[]> {
    const cacheKey = workspaceFolder.uri.toString();
    const cached = this.ownerCache.get(cacheKey);
    if (cached) return cached;

    let architecture = resolveSrijikaArchitectureConfig();
    const fileSystem = await openSafeSrijikaWorkspace(workspaceFolder.uri.fsPath);
    try {
      const config = await fileSystem.readText('srijika.config.json', 64 * 1024);
      const parsed = parseSrijikaArchitectureConfig(config.source);
      if (!parsed) {
        this.ownerCache.set(cacheKey, []);
        return [];
      }
      architecture = resolveSrijikaArchitectureConfig(parsed);
    } catch (error) {
      if (!(
        (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') ||
        (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )) {
        // Keep malformed/unsupported project configuration visible to the
        // user instead of silently rendering a default or empty strict tree.
        throw error;
      }
      // An older project without config still gets the canonical default roots.
    }
    const sourceFiles = await discoverSafeSrijikaSources(fileSystem, architecture);
    const folders = sourceFiles.map(({ relativePath: relativeFile }) => {
      return relativeFile.slice(0, relativeFile.lastIndexOf('/'));
    });
    const owners = buildSrijikaStructureTreeOwners(folders, architecture);
    this.ownerCache.set(cacheKey, owners);
    return owners;
  }
}
