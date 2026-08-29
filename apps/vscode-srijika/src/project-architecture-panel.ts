import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import * as vscode from 'vscode';

import {
  parseSrijikaTypeScriptPathAliases,
  type SrijikaArchitectureSourceFile,
} from '@srijika/architecture-rules';

import { checkArchitectureWorkspace, parseSrijikaCodeProjectConfig } from './architecture-adapter';
import {
  assertCompleteArchitectureScanBudget,
  selectArchitectureScanBudget,
  SRIJIKA_ARCHITECTURE_SCAN_LIMITS,
} from './architecture-scan-budget';
import {
  buildSrijikaProjectArchitectureGraph,
  type SrijikaProjectArchitectureGraphModel,
} from './project-architecture-graph';
import { renderSrijikaProjectArchitectureWebview } from './project-architecture-webview';
import { discoverSafeSrijikaSources, openSafeSrijikaWorkspace } from './safe-workspace-files';

interface ProjectArchitecturePanelMessage {
  type: 'openFile' | 'refresh' | 'selectProject';
  relativePath?: string;
}

interface SrijikaProjectCandidate {
  configUri: vscode.Uri;
  projectRoot: string;
  label: string;
  description: string;
}

function isPanelMessage(value: unknown): value is ProjectArchitecturePanelMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    ['openFile', 'refresh', 'selectProject'].includes(String(value.type))
  );
}

function isInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function loadingHtml(nonce: string, message: string): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">body{padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.5 var(--vscode-font-family)}h1{font-size:18px}</style></head><body><h1>Srijika Structure Graph</h1><p>${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p></body></html>`;
}

export class SrijikaProjectArchitecturePanel implements vscode.Disposable {
  readonly #output: vscode.OutputChannel;
  readonly #subscriptions: vscode.Disposable[] = [];
  #panel: vscode.WebviewPanel | undefined;
  #project: SrijikaProjectCandidate | undefined;
  #model: SrijikaProjectArchitectureGraphModel | undefined;
  #loadRun = 0;
  #refreshTimer: NodeJS.Timeout | undefined;

  constructor(output: vscode.OutputChannel) {
    this.#output = output;
    this.#subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => this.#scheduleRefresh(document.uri)),
      vscode.workspace.onDidCreateFiles((event) => {
        if (event.files.some((uri) => this.#isProjectUri(uri))) this.#scheduleRefresh();
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        if (event.files.some((uri) => this.#isProjectUri(uri))) this.#scheduleRefresh();
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        if (
          event.files.some(
            ({ oldUri, newUri }) => this.#isProjectUri(oldUri) || this.#isProjectUri(newUri),
          )
        ) {
          this.#scheduleRefresh();
        }
      }),
    );
  }

  async show(): Promise<void> {
    const project = await this.#selectProject();
    if (!project) return;
    this.#project = project;
    if (!this.#panel) {
      this.#panel = vscode.window.createWebviewPanel(
        'srijika.projectArchitecture',
        'Srijika Structure Graph',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.#panel.onDidDispose(() => {
        this.#panel = undefined;
        this.#loadRun += 1;
        if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
      });
      this.#panel.webview.onDidReceiveMessage((message: unknown) => {
        if (isPanelMessage(message)) void this.#handleMessage(message);
      });
    } else {
      this.#panel.reveal(vscode.ViewColumn.Active, true);
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const project = this.#project;
    const panel = this.#panel;
    if (!project || !panel) return;
    const run = ++this.#loadRun;
    panel.webview.html = loadingHtml(
      randomBytes(16).toString('base64url'),
      `Scanning ${project.label} with bounded Srijika architecture rules…`,
    );
    try {
      const model = await this.#scanProject(project);
      if (run !== this.#loadRun || panel !== this.#panel) return;
      this.#model = model;
      panel.title = `Srijika Structure Graph · ${model.projectName}`;
      panel.webview.html = renderSrijikaProjectArchitectureWebview({
        nonce: randomBytes(16).toString('base64url'),
        graph: model,
      });
    } catch (error) {
      if (run !== this.#loadRun || panel !== this.#panel) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#output.appendLine(`[Structure graph] ${project.projectRoot}: ${message}`);
      panel.webview.html = loadingHtml(
        randomBytes(16).toString('base64url'),
        `Structure graph failed closed: ${message}`,
      );
      void vscode.window.showErrorMessage(`Srijika Structure Graph: ${message}`);
    }
  }

  dispose(): void {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    this.#panel?.dispose();
    this.#panel = undefined;
    this.#project = undefined;
    this.#model = undefined;
    this.#loadRun += 1;
    for (const subscription of this.#subscriptions) subscription.dispose();
  }

  async #handleMessage(message: ProjectArchitecturePanelMessage): Promise<void> {
    if (message.type === 'refresh') {
      await this.refresh();
      return;
    }
    if (message.type === 'selectProject') {
      const selected = await this.#selectProject(true);
      if (selected) {
        this.#project = selected;
        await this.refresh();
      }
      return;
    }
    if (message.type !== 'openFile' || typeof message.relativePath !== 'string') return;
    const project = this.#project;
    const model = this.#model;
    if (
      !project ||
      !model?.nodes.some(
        (node) => node.kind === 'file' && node.relativePath === message.relativePath,
      )
    ) {
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(resolve(project.projectRoot, ...message.relativePath.split('/'))),
      );
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#output.appendLine(
        `[Structure graph] Could not open ${message.relativePath}: ${detail}`,
      );
      void vscode.window.showErrorMessage(`Could not open ${message.relativePath}: ${detail}`);
    }
  }

  async #selectProject(forcePick = false): Promise<SrijikaProjectCandidate | undefined> {
    const candidateByRoot = new Map<string, SrijikaProjectCandidate>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const configs = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/srijika.config.json'),
        '**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,target,release-bundles}/**',
        129,
      );
      if (configs.length > 128) {
        void vscode.window.showErrorMessage(
          `${folder.name} contains more than 128 configured Srijika projects; narrow the open workspace before graphing.`,
        );
        return undefined;
      }
      for (const configUri of configs) {
        const projectRoot = dirname(configUri.fsPath);
        const projectRelative = relative(folder.uri.fsPath, projectRoot).replaceAll('\\', '/');
        candidateByRoot.set(resolve(projectRoot), {
          configUri,
          projectRoot,
          label: projectRelative ? `${folder.name}/${projectRelative}` : folder.name,
          description: projectRoot,
        });
      }
    }
    const candidates = [...candidateByRoot.values()];
    if (candidates.length > 128) {
      void vscode.window.showErrorMessage(
        'The open workspace contains more than 128 configured Srijika projects; narrow the workspace before graphing.',
      );
      return undefined;
    }
    candidates.sort((left, right) => left.projectRoot.localeCompare(right.projectRoot));
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(
        'No srijika.config.json was found in the open workspace or its monorepo packages.',
      );
      return undefined;
    }
    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const activeCandidate = activePath
      ? [...candidates]
          .filter(({ projectRoot }) => isInside(projectRoot, activePath))
          .sort((left, right) => right.projectRoot.length - left.projectRoot.length)[0]
      : undefined;
    if (!forcePick && activeCandidate) return activeCandidate;
    if (!forcePick && candidates.length === 1) return candidates[0];
    return vscode.window.showQuickPick(candidates, {
      title: 'Open Srijika Structure Graph',
      placeHolder: 'Select a configured Srijika project or monorepo package',
      matchOnDescription: true,
    });
  }

  async #scanProject(
    project: SrijikaProjectCandidate,
  ): Promise<SrijikaProjectArchitectureGraphModel> {
    const fileSystem = await openSafeSrijikaWorkspace(project.projectRoot);
    const configRead = await fileSystem.readText('srijika.config.json', 64 * 1024);
    const config = parseSrijikaCodeProjectConfig(configRead.source);
    let aliases: Readonly<Record<string, string>> = {};
    if (await fileSystem.isRegularFile('tsconfig.json')) {
      aliases = parseSrijikaTypeScriptPathAliases(
        (await fileSystem.readText('tsconfig.json', 1024 * 1024)).source,
      );
    }
    const discovered = await discoverSafeSrijikaSources(
      fileSystem,
      config.architecture,
      config.adoption,
    );
    const byPath = new Map(discovered.map((file) => [file.relativePath, file]));
    if (!byPath.has(config.entry)) {
      await fileSystem.inspectRegularFile(config.entry);
      byPath.set(config.entry, {
        relativePath: config.entry,
        absolutePath: fileSystem.resolve(config.entry),
      });
    }
    const candidates = [];
    for (const file of [...byPath.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )) {
      candidates.push({
        value: file,
        byteLength: (await fileSystem.inspectRegularFile(file.absolutePath)).size,
      });
    }
    const budget = selectArchitectureScanBudget(candidates);
    assertCompleteArchitectureScanBudget(budget);
    const files: SrijikaArchitectureSourceFile[] = [];
    let totalBytes = 0;
    for (const candidate of budget.accepted) {
      const read = await fileSystem.readText(
        candidate.value.relativePath,
        SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile,
      );
      totalBytes += read.size;
      if (totalBytes > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxTotalBytes) {
        throw new Error('The source corpus exceeds the 24 MiB aggregate limit.');
      }
      files.push({ fileName: candidate.value.absolutePath, source: read.source });
    }
    const architectureResult = checkArchitectureWorkspace({
      projectRoot: project.projectRoot,
      files,
      architecture: config.architecture,
      aliases,
      entry: config.entry,
      ...(config.adoption ? { adoption: config.adoption } : {}),
    });
    let projectName = basename(project.projectRoot);
    try {
      const packageSource = (await fileSystem.readText('package.json', 256 * 1024)).source;
      const packageJson = JSON.parse(packageSource) as { name?: unknown };
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
        projectName = packageJson.name.trim();
      }
    } catch {
      // The configured Srijika project name falls back to its bounded root folder.
    }
    return buildSrijikaProjectArchitectureGraph({
      projectName,
      projectRoot: project.projectRoot,
      entry: config.entry,
      architecture: config.architecture,
      aliases,
      files,
      diagnostics: architectureResult.diagnostics,
      ...(architectureResult.adoption ? { adoption: architectureResult.adoption } : {}),
    });
  }

  #isProjectUri(uri: vscode.Uri): boolean {
    return this.#project !== undefined && isInside(this.#project.projectRoot, uri.fsPath);
  }

  #scheduleRefresh(uri?: vscode.Uri): void {
    if (!this.#panel || (uri && !this.#isProjectUri(uri))) return;
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined;
      void this.refresh();
    }, 350);
  }
}
