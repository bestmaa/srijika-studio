import * as vscode from 'vscode';

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
      structureOwner.level === 'part'
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `${workspaceFolder.uri.toString()}::${structureOwner.relativeFolder}`;
    this.contextValue = 'srijikaStructureOwner';
    if (structureOwner.level === 'featuresRoot') this.description = workspaceFolder.name;
    this.tooltip = `${structureOwner.relativeFolder}\nUse the + action to add only valid Srijika capabilities.`;
    this.resourceUri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      ...structureOwner.relativeFolder.split('/'),
    );
    this.iconPath = new vscode.ThemeIcon(
      structureOwner.level === 'featuresRoot'
        ? 'library'
        : structureOwner.level === 'feature'
          ? 'symbol-module'
          : structureOwner.level === 'slot'
            ? 'symbol-namespace'
            : 'symbol-method',
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

    const sourceUris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, 'src/features/**/*.{ts,tsx,mts,cts}'),
      '**/{node_modules,dist,build,target,.git}/**',
      20_000,
    );
    const folders = sourceUris.map((uri) => {
      const relativeFile = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
      return relativeFile.slice(0, relativeFile.lastIndexOf('/'));
    });
    const owners = buildSrijikaStructureTreeOwners(folders);
    this.ownerCache.set(cacheKey, owners);
    return owners;
  }
}
