import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import * as vscode from 'vscode';

import {
  getReactMigrationSliceContext,
  getReactMigrationStatus,
  inspectReactMigrationArchitecture,
  type ReactMigrationArchitectureInspection,
  type ReactMigrationSession,
  type ReactMigrationSliceContextItem,
} from '@srijika/developer-engine';

import {
  buildSrijikaArchitectureGraph,
  buildSrijikaArchitectureOwnerDetail,
} from './migration-architecture-graph';
import { renderSrijikaMigrationArchitectureWebview } from './migration-architecture-webview';

interface ArchitecturePanelMessage {
  type: 'loadOwnerDetail' | 'openSource' | 'openTarget' | 'refresh' | 'back';
  ownerId?: string;
  sourcePath?: string;
  targetPath?: string;
}

function isArchitecturePanelMessage(value: unknown): value is ArchitecturePanelMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    ['loadOwnerDetail', 'openSource', 'openTarget', 'refresh', 'back'].includes(String(value.type))
  );
}

export class SrijikaMigrationArchitecturePanel implements vscode.Disposable {
  readonly #output: vscode.OutputChannel;
  #panel: vscode.WebviewPanel | undefined;
  #session: ReactMigrationSession | undefined;
  #targetInspection: ReactMigrationArchitectureInspection | undefined;
  #inspectionRun = 0;
  #sliceContext = new Map<string, readonly ReactMigrationSliceContextItem[]>();
  #sliceContextErrors = new Map<string, string>();

  constructor(output: vscode.OutputChannel) {
    this.#output = output;
  }

  show(session: ReactMigrationSession): void {
    const planChanged = this.#session?.plan.id !== session.plan.id;
    this.#session = session;
    if (planChanged) {
      this.#sliceContext.clear();
      this.#sliceContextErrors.clear();
      this.#targetInspection = undefined;
      this.#inspectionRun += 1;
    }
    if (!this.#panel) {
      this.#panel = vscode.window.createWebviewPanel(
        'srijika.migrationArchitecture',
        'Srijika Migration Architecture',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.#panel.onDidDispose(() => {
        this.#panel = undefined;
        this.#inspectionRun += 1;
      });
      this.#panel.webview.onDidReceiveMessage((message: unknown) => {
        if (isArchitecturePanelMessage(message)) void this.#handleMessage(message);
      });
    } else {
      this.#panel.reveal(vscode.ViewColumn.Active, true);
    }
    this.#render();
    void this.#loadTargetInspection(session);
  }

  update(session: ReactMigrationSession): void {
    if (!this.#panel) return;
    this.show(session);
  }

  dispose(): void {
    this.#panel?.dispose();
    this.#panel = undefined;
    this.#session = undefined;
    this.#targetInspection = undefined;
    this.#inspectionRun += 1;
    this.#sliceContext.clear();
    this.#sliceContextErrors.clear();
  }

  async #handleMessage(message: ArchitecturePanelMessage): Promise<void> {
    const session = this.#session;
    if (!session) return;
    switch (message.type) {
      case 'loadOwnerDetail':
        if (typeof message.ownerId === 'string') await this.#loadOwnerDetail(message.ownerId);
        return;
      case 'openSource':
        if (typeof message.sourcePath === 'string') await this.#openSource(message.sourcePath);
        return;
      case 'openTarget':
        if (typeof message.targetPath === 'string') await this.#openTarget(message.targetPath);
        return;
      case 'refresh':
        try {
          this.show(await getReactMigrationStatus(session.targetRoot));
        } catch (error) {
          this.#showError('Architecture refresh failed', error);
        }
        return;
      case 'back':
        await vscode.commands.executeCommand('srijika.migration.focus');
    }
  }

  async #loadOwnerDetail(ownerId: string): Promise<void> {
    const session = this.#session;
    if (!session || !session.plan.ownership.some((decision) => decision.ownerId === ownerId)) {
      return;
    }
    const sourcePaths = new Set(
      session.plan.ownership
        .filter((decision) => decision.ownerId === ownerId)
        .map(({ sourcePath }) => sourcePath),
    );
    const slices = session.plan.slices.filter((slice) =>
      slice.sourcePaths.some((sourcePath) => sourcePaths.has(sourcePath)),
    );
    const errors: string[] = [];
    const items: ReactMigrationSliceContextItem[] = [];
    for (const slice of slices) {
      if (!this.#sliceContext.has(slice.id) && !this.#sliceContextErrors.has(slice.id)) {
        try {
          this.#sliceContext.set(slice.id, await this.#readSliceContext(session, slice.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.#sliceContextErrors.set(slice.id, message);
          this.#output.appendLine(
            `[Migration architecture] Could not load bounded context for ${slice.id}: ${message}`,
          );
        }
      }
      items.push(...(this.#sliceContext.get(slice.id) ?? []));
      const error = this.#sliceContextErrors.get(slice.id);
      if (error) errors.push(`${slice.title}: ${error}`);
    }
    const detail = buildSrijikaArchitectureOwnerDetail(ownerId, session, items, errors);
    if (this.#session?.plan.id !== session.plan.id) return;
    await this.#panel?.webview.postMessage({ type: 'ownerDetail', detail });
  }

  async #loadTargetInspection(session: ReactMigrationSession): Promise<void> {
    const run = ++this.#inspectionRun;
    try {
      const inspection = await inspectReactMigrationArchitecture(session.targetRoot);
      if (
        run !== this.#inspectionRun ||
        this.#session?.id !== session.id ||
        this.#session.plan.id !== session.plan.id
      ) {
        return;
      }
      this.#targetInspection = inspection;
      this.#render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#output.appendLine(
        `[Migration architecture] Target graph inspection failed: ${message}`,
      );
    }
  }

  async #readSliceContext(
    session: ReactMigrationSession,
    sliceId: string,
  ): Promise<readonly ReactMigrationSliceContextItem[]> {
    const items: ReactMigrationSliceContextItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await getReactMigrationSliceContext({
        target: session.targetRoot,
        sliceId,
        expectedPlanId: session.plan.id,
        expectedSourceSnapshotSha256: session.inventory.snapshotSha256,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 32,
        maxBytes: 2 * 1024 * 1024,
      });
      items.push(
        ...page.items.map((item) =>
          Object.freeze({
            sourcePath: item.sourcePath,
            category: item.category,
            sha256: item.sha256,
            size: item.size,
            ...(item.environmentKeys === undefined
              ? {}
              : { environmentKeys: item.environmentKeys }),
            imports: item.imports,
            exports: item.exports,
            ownership: item.ownership,
          }),
        ),
      );
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return Object.freeze(items);
  }

  async #openSource(sourcePath: string): Promise<void> {
    const session = this.#session;
    if (!session || !session.plan.ownership.some((item) => item.sourcePath === sourcePath)) return;
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(join(session.sourceRoot, ...sourcePath.split('/'))),
      );
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      this.#showError(`Could not open ${sourcePath}`, error);
    }
  }

  async #openTarget(targetPath: string): Promise<void> {
    const session = this.#session;
    if (
      !session ||
      !this.#targetInspection?.modules.some(({ relativePath }) => relativePath === targetPath)
    ) {
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(join(session.targetRoot, ...targetPath.split('/'))),
      );
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      this.#showError(`Could not open ${targetPath}`, error);
    }
  }

  #showError(label: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#output.appendLine(`[Migration architecture] ${label}: ${message}`);
    void vscode.window.showErrorMessage(`${label}: ${message}`);
  }

  #render(): void {
    if (!this.#panel || !this.#session) return;
    this.#panel.webview.html = renderSrijikaMigrationArchitectureWebview({
      nonce: randomBytes(16).toString('base64url'),
      graph: buildSrijikaArchitectureGraph(this.#session, this.#targetInspection),
    });
  }
}
