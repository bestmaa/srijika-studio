import * as vscode from 'vscode';

import {
  createSrijikaDoctorReport,
  formatSrijikaCommand,
  inspectSrijikaProject,
  planSrijikaProjectCommand,
  type SrijikaProjectCommandKind,
  type SrijikaRuntimePreference,
} from '@srijika/developer-engine';

async function selectedWorkspaceFolder(resource?: vscode.Uri): Promise<vscode.WorkspaceFolder> {
  if (resource) {
    const folder = vscode.workspace.getWorkspaceFolder(resource);
    if (folder) return folder;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder) return folder;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1 && folders[0]) return folders[0];
  if (folders.length === 0) throw new Error('Open a Srijika project folder first.');
  const selected = await vscode.window.showWorkspaceFolderPick({
    placeHolder: 'Choose the Srijika project to run',
  });
  if (!selected) throw new Error('No Srijika project was selected.');
  return selected;
}

function runtimePreference(folder: vscode.WorkspaceFolder): SrijikaRuntimePreference {
  const configured = vscode.workspace
    .getConfiguration('srijika', folder.uri)
    .get<string>('runtime', 'auto');
  return configured === 'bun' || configured === 'node' ? configured : 'auto';
}

function runtimePort(folder: vscode.WorkspaceFolder): number {
  return vscode.workspace.getConfiguration('srijika', folder.uri).get<number>('devPort', 5173);
}

export class SrijikaRuntimeController implements vscode.Disposable {
  readonly #output: vscode.OutputChannel;
  #execution: vscode.TaskExecution | null = null;
  #endSubscription: vscode.Disposable;

  constructor(output: vscode.OutputChannel) {
    this.#output = output;
    this.#endSubscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== this.#execution) return;
      this.#output.appendLine(`Srijika app exited with code ${event.exitCode ?? 'unknown'}.`);
      this.#execution = null;
      void vscode.commands.executeCommand('setContext', 'srijika.runtimeRunning', false);
    });
  }

  async execute(kind: SrijikaProjectCommandKind, resource?: vscode.Uri): Promise<void> {
    if (kind === 'dev' && this.#execution) {
      void vscode.window.showInformationMessage('The Srijika app is already running.');
      return;
    }
    const folder = await selectedWorkspaceFolder(resource);
    const project = await inspectSrijikaProject(folder.uri.fsPath);
    const plan = planSrijikaProjectCommand(project, kind, {
      runtime: runtimePreference(folder),
      ...(kind === 'dev' || kind === 'preview' ? { port: runtimePort(folder) } : {}),
    });
    this.#output.appendLine(`[${kind}] ${formatSrijikaCommand(plan)}`);
    if (plan.fallbackReason) this.#output.appendLine(`[runtime fallback] ${plan.fallbackReason}`);
    const task = new vscode.Task(
      { type: 'srijika', action: kind, project: project.root },
      folder,
      kind === 'dev' ? 'Run App' : `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`,
      'Srijika',
      new vscode.ShellExecution(plan.executable, [...plan.args], { cwd: plan.cwd }),
      [],
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: kind === 'dev' ? vscode.TaskPanelKind.Dedicated : vscode.TaskPanelKind.Shared,
      clear: true,
      focus: kind === 'dev',
    };
    task.isBackground = kind === 'dev';
    const execution = await vscode.tasks.executeTask(task);
    if (kind === 'dev') {
      this.#execution = execution;
      await vscode.commands.executeCommand('setContext', 'srijika.runtimeRunning', true);
      void vscode.window.showInformationMessage(
        `Srijika started Vite on port ${runtimePort(folder)} (${plan.runtime}).`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.#execution) {
      void vscode.window.showInformationMessage('No Srijika app task is running.');
      return;
    }
    this.#execution.terminate();
    this.#execution = null;
    await vscode.commands.executeCommand('setContext', 'srijika.runtimeRunning', false);
  }

  async doctor(resource?: vscode.Uri): Promise<void> {
    const folder = await selectedWorkspaceFolder(resource);
    const report = await createSrijikaDoctorReport(folder.uri.fsPath, runtimePreference(folder));
    this.#output.appendLine(`Srijika Doctor — ${folder.name}`);
    this.#output.appendLine(`Runtime: ${report.selectedRuntime} — ${report.runtimeReason}`);
    for (const tool of report.tools) {
      this.#output.appendLine(
        `${tool.available ? '✓' : '·'} ${tool.name} ${tool.version ?? ''}`.trim(),
      );
    }
    for (const issue of report.issues) this.#output.appendLine(`! ${issue}`);
    this.#output.show(true);
    if (report.healthy)
      void vscode.window.showInformationMessage('Srijika Doctor: project is ready.');
    else
      void vscode.window.showWarningMessage(
        `Srijika Doctor found ${report.issues.length} issue(s).`,
      );
  }

  dispose(): void {
    this.#endSubscription.dispose();
    this.#execution?.terminate();
    this.#execution = null;
  }
}
