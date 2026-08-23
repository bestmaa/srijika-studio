import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';

import * as vscode from 'vscode';

import type { ReactMigrationSession } from '@srijika/developer-engine';

import {
  renderSrijikaMigrationDashboard,
  type SrijikaMigrationConnectorStatus,
  type SrijikaMigrationTargetMode,
} from './migration-dashboard';
import { SrijikaMigrationArchitecturePanel } from './migration-architecture-panel';
import {
  describeReactMigrationResult,
  runReactMigration,
  validateReactMigrationRequest,
} from './react-migration-adapter';

const MAX_MCP_CONFIG_BYTES = 256 * 1024;
type MigrationDashboardOperation = 'start' | 'status' | 'verify';

interface MigrationViewMessage {
  type:
    | 'selectSource'
    | 'selectTarget'
    | 'targetMode'
    | 'start'
    | 'status'
    | 'verify'
    | 'openTarget'
    | 'openSession'
    | 'openArchitecture'
    | 'refreshConnectors'
    | 'copyHandoff'
    | 'openDocs';
  source?: string;
  target?: string;
  targetMode?: SrijikaMigrationTargetMode;
}

function isMigrationViewMessage(value: unknown): value is MigrationViewMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  return [
    'selectSource',
    'selectTarget',
    'targetMode',
    'start',
    'status',
    'verify',
    'openTarget',
    'openSession',
    'openArchitecture',
    'refreshConnectors',
    'copyHandoff',
    'openDocs',
  ].includes(String(value.type));
}

async function configuredMcpPaths(target: string): Promise<readonly string[]> {
  if (!target || !isAbsolute(target)) return [];
  const configured: string[] = [];
  for (const relativePath of ['.vscode/mcp.json', '.mcp.json']) {
    const absolutePath = join(target, relativePath);
    try {
      const source = await readFile(absolutePath);
      if (source.byteLength > MAX_MCP_CONFIG_BYTES) continue;
      const text = source.toString('utf8');
      JSON.parse(text);
      if (/srijika/iu.test(text)) configured.push(relativePath);
    } catch {
      // A missing, unreadable, oversized, or malformed file is not reported as configured.
    }
  }
  return configured;
}

function detectedCodexExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find((extension) => {
    if (extension.id.toLowerCase() === 'openai.chatgpt') return true;
    const manifest = extension.packageJSON as {
      name?: unknown;
      displayName?: unknown;
      publisher?: unknown;
    };
    const publisher = typeof manifest.publisher === 'string' ? manifest.publisher : '';
    const name = typeof manifest.name === 'string' ? manifest.name : '';
    const displayName = typeof manifest.displayName === 'string' ? manifest.displayName : '';
    const label = `${name} ${displayName}`;
    return publisher.toLowerCase() === 'openai' && /codex|chatgpt/iu.test(label);
  });
}

function defaultTargetFor(source: string): string {
  return source ? join(dirname(source), `${basename(source)}-srijika`) : '';
}

function migrationHandoff(target: string, session: ReactMigrationSession | undefined): string {
  const phase = session?.phase ?? 'not-started';
  const nextSlice = session?.plan.slices.find(
    ({ id }) => !session.appliedSlices.some((applied) => applied.id === id && applied.verified),
  );
  return [
    `Continue the Srijika React migration at ${target}.`,
    `Current persisted phase: ${phase}.`,
    nextSlice
      ? `Next unverified engine slice: ${nextSlice.id} (${nextSlice.title}).`
      : 'Read the persisted status and choose the next engine-owned completion gate.',
    'Use the Srijika MCP migration tools and the persisted plan; keep the source immutable.',
    'Read bounded slice context, review one native slice, apply its unchanged review token, verify it, then repeat.',
    'Do not copy the legacy runtime, invent freehand target paths, bypass blockers, or report completion without engine-owned verification and browser parity evidence.',
  ].join('\n');
}

export class SrijikaMigrationViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  readonly #output: vscode.OutputChannel;
  readonly #architecturePanel: SrijikaMigrationArchitecturePanel;
  #view: vscode.WebviewView | undefined;
  #source = '';
  #target = '';
  #targetMode: SrijikaMigrationTargetMode = 'new';
  #busy = false;
  #activity: string | undefined;
  #error: string | undefined;
  #session: ReactMigrationSession | undefined;
  #connectors: SrijikaMigrationConnectorStatus = {
    codex: { detected: false, label: 'Codex extension has not been inspected yet.' },
    mcp: {
      configured: false,
      label: 'Choose a target to inspect its MCP configuration.',
      paths: [],
    },
  };

  constructor(output: vscode.OutputChannel) {
    this.#output = output;
    this.#architecturePanel = new SrijikaMigrationArchitecturePanel(output);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.#view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (isMigrationViewMessage(message)) void this.#handleMessage(message);
    });
    this.#render();
    void this.refreshConnectors();
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand('srijika.migration.focus');
  }

  async openArchitectureGraph(): Promise<void> {
    if (!this.#session && this.#target) await this.#run('status');
    if (!this.#session) {
      await this.reveal();
      void vscode.window.showWarningMessage(
        'Start or resume a React migration before opening its architecture graph.',
      );
      return;
    }
    this.#architecturePanel.show(this.#session);
  }

  dispose(): void {
    this.#architecturePanel.dispose();
  }

  async refreshConnectors(): Promise<void> {
    const codex = detectedCodexExtension();
    const paths = await configuredMcpPaths(this.#target || this.#currentWorkspace());
    this.#connectors = {
      codex: {
        detected: Boolean(codex),
        label: codex
          ? `${codex.id} is installed${codex.isActive ? ' and active' : ''}.`
          : 'No OpenAI Codex/ChatGPT VS Code extension was detected in this extension host.',
      },
      mcp: {
        configured: paths.length > 0,
        label:
          paths.length > 0
            ? 'Target contains a readable Srijika MCP server configuration.'
            : 'No readable Srijika entry was found in .vscode/mcp.json or .mcp.json.',
        paths,
      },
    };
    this.#render();
  }

  #currentWorkspace(): string {
    const activeDocument = vscode.window.activeTextEditor?.document;
    const activeFolder = activeDocument
      ? vscode.workspace.getWorkspaceFolder(activeDocument.uri)
      : undefined;
    return activeFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  }

  #updateFromMessage(message: MigrationViewMessage): void {
    if (typeof message.source === 'string') this.#source = message.source.trim();
    if (typeof message.target === 'string') this.#target = message.target.trim();
    if (message.targetMode === 'new' || message.targetMode === 'current') {
      this.#targetMode = message.targetMode;
      if (message.targetMode === 'current') this.#target = this.#currentWorkspace();
      else if (!this.#target || this.#target === this.#currentWorkspace()) {
        this.#target = defaultTargetFor(this.#source);
      }
    }
  }

  async #handleMessage(message: MigrationViewMessage): Promise<void> {
    this.#updateFromMessage(message);
    switch (message.type) {
      case 'selectSource':
        await this.#selectSource();
        return;
      case 'selectTarget':
        await this.#selectTarget();
        return;
      case 'targetMode':
        this.#error = undefined;
        await this.refreshConnectors();
        return;
      case 'start':
        await this.#run('start');
        return;
      case 'status':
        await this.#run('status');
        return;
      case 'verify':
        await this.#run('verify');
        return;
      case 'openTarget':
        if (this.#target) {
          await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(this.#target),
            true,
          );
        }
        return;
      case 'openSession':
        if (this.#session) {
          const sessionUri = vscode.Uri.file(
            join(this.#target, '.srijika/migrations/react/session.json'),
          );
          const document = await vscode.workspace.openTextDocument(sessionUri);
          await vscode.window.showTextDocument(document, { preview: true });
        }
        return;
      case 'openArchitecture':
        await this.openArchitectureGraph();
        return;
      case 'refreshConnectors':
        await this.refreshConnectors();
        return;
      case 'copyHandoff':
        if (this.#target) {
          await vscode.env.clipboard.writeText(migrationHandoff(this.#target, this.#session));
          void vscode.window.showInformationMessage('Srijika Codex migration handoff copied.');
        }
        return;
      case 'openDocs':
        await vscode.commands.executeCommand('srijika.showSetup');
    }
  }

  async #selectSource(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      title: 'Select the existing React source folder (read-only)',
      ...(this.#source ? { defaultUri: vscode.Uri.file(this.#source) } : {}),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use as read-only source',
    });
    const source = selected?.[0]?.fsPath;
    if (!source) return;
    const previousDefault = defaultTargetFor(this.#source);
    this.#source = source;
    if (this.#targetMode === 'new' && (!this.#target || this.#target === previousDefault)) {
      this.#target = defaultTargetFor(source);
    }
    this.#error = undefined;
    this.#render();
    await this.refreshConnectors();
  }

  async #selectTarget(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      title: 'Select an empty or resumable Srijika target folder',
      ...(this.#target ? { defaultUri: vscode.Uri.file(this.#target) } : {}),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use as Srijika target',
    });
    const target = selected?.[0]?.fsPath;
    if (!target) return;
    this.#target = target;
    this.#error = undefined;
    this.#render();
    await this.refreshConnectors();
  }

  async #run(operation: MigrationDashboardOperation): Promise<void> {
    if (this.#busy) return;
    try {
      const request = validateReactMigrationRequest({
        operation,
        target: this.#target,
        ...(operation === 'start' ? { source: this.#source } : {}),
      });
      this.#busy = true;
      this.#error = undefined;
      this.#activity =
        operation === 'start'
          ? 'Scanning source and creating/resuming the safe target…'
          : operation === 'status'
            ? 'Reading the persisted migration session…'
            : 'Running engine-owned verification checks…';
      this.#render();
      this.#output.appendLine('');
      this.#output.appendLine(
        `[React migration GUI] ${operation}: ${operation === 'start' ? `${this.#source} -> ` : ''}${this.#target}`,
      );
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `Srijika migration: ${operation}`,
          cancellable: false,
        },
        () =>
          runReactMigration(request, {
            onStatus: (session) => {
              this.#session = session;
              this.#activity = `Phase ${session.phase} · session ${session.id}`;
              this.#output.appendLine(JSON.stringify(session, null, 2));
              this.#architecturePanel.update(session);
              this.#render();
            },
          }),
      );
      this.#session = result.session;
      this.#architecturePanel.update(result.session);
      this.#activity = describeReactMigrationResult(operation, result.session);
      void vscode.window.showInformationMessage(`Srijika migration ${this.#activity}.`);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      this.#activity = `Migration ${operation} failed safely.`;
      this.#output.appendLine(`[React migration GUI error] ${this.#error}`);
      this.#output.show(true);
      void vscode.window.showErrorMessage(`Srijika migration failed: ${this.#error}`);
    } finally {
      this.#busy = false;
      this.#render();
      await this.refreshConnectors();
    }
  }

  #render(): void {
    if (!this.#view) return;
    this.#view.webview.html = renderSrijikaMigrationDashboard({
      nonce: randomBytes(16).toString('base64url'),
      source: this.#source,
      target: this.#target,
      targetMode: this.#targetMode,
      busy: this.#busy,
      connectors: this.#connectors,
      ...(this.#currentWorkspace() ? { currentWorkspace: this.#currentWorkspace() } : {}),
      ...(this.#activity === undefined ? {} : { activity: this.#activity }),
      ...(this.#error === undefined ? {} : { error: this.#error }),
      ...(this.#session === undefined ? {} : { session: this.#session }),
    });
  }
}
