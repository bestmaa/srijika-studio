import * as vscode from 'vscode';
import { dirname } from 'node:path';

import {
  createSrijikaDoctorReport,
  formatSrijikaCommand,
  inspectSrijikaProject,
  inspectSrijikaTool,
  planSrijikaProjectCommand,
  type SrijikaProjectCommandKind,
  type SrijikaRuntimePreference,
} from '@srijika/developer-engine';
import { nativeEditorRuntimePlan } from './native-runtime-model';
import { nearestEditorProjectRoot, readSrijikaEditorProject } from './project-profile';
import { openSafeSrijikaWorkspace } from './safe-workspace-files';

export async function selectedProjectRoot(
  folder: vscode.WorkspaceFolder,
  resource?: vscode.Uri,
): Promise<string> {
  const path = resource?.fsPath ?? vscode.window.activeTextEditor?.document.fileName;
  if (!path) return folder.uri.fsPath;
  const configs = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/srijika.config.json'),
    '**/{node_modules,.git,.expo,dist,build,coverage,.next,target}/**',
    129,
  );
  if (configs.length > 128) throw new Error('Project selection exceeds the 128-project budget.');
  return (
    nearestEditorProjectRoot(
      configs.map((uri) => dirname(uri.fsPath)),
      path,
    ) ?? folder.uri.fsPath
  );
}

export async function selectedWorkspaceFolder(
  resource?: vscode.Uri,
  placeHolder = 'Choose the Srijika project to run',
): Promise<vscode.WorkspaceFolder> {
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
    placeHolder,
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
    const root = await selectedProjectRoot(folder, resource);
    const fileSystem = await openSafeSrijikaWorkspace(root);
    if (await fileSystem.isRegularFile('srijika.native.json')) {
      await readSrijikaEditorProject(fileSystem);
      if (kind !== 'dev' && kind !== 'install')
        throw new Error('Native app binaries use the separate development/cloud-build workflow.');
      const settings = vscode.workspace.getConfiguration('srijika', vscode.Uri.file(root));
      const connection = settings.get<string>('nativeConnection', 'lan');
      if (connection !== 'lan' && connection !== 'tunnel')
        throw new Error('Native connection must be lan or tunnel.');
      const plan = nativeEditorRuntimePlan(root, kind, {
        connection,
        port: settings.get<number>('nativeDevPort', 8081),
        windows: process.platform === 'win32',
      });
      this.#output.appendLine(`[Native ${kind}] ${plan.executable} ${plan.args.join(' ')}`);
      const task = new vscode.Task(
        { type: 'srijika-native', action: kind, project: root },
        folder,
        kind === 'dev' ? 'Expo Go Preview' : 'Install Native Dependencies',
        'Srijika',
        new vscode.ShellExecution(plan.executable, plan.args, { cwd: plan.cwd }),
        [],
      );
      task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: kind === 'dev' ? vscode.TaskPanelKind.Dedicated : vscode.TaskPanelKind.Shared,
        focus: kind === 'dev',
        clear: true,
      };
      task.isBackground = kind === 'dev';
      const execution = await vscode.tasks.executeTask(task);
      if (kind === 'dev') {
        this.#execution = execution;
        await vscode.commands.executeCommand('setContext', 'srijika.runtimeRunning', true);
        void vscode.window.showInformationMessage(
          `Expo Go preview started over ${connection}. Scan its terminal QR code on your phone.`,
        );
      }
      return;
    }
    const project = await inspectSrijikaProject(root);
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
    const root = await selectedProjectRoot(folder, resource);
    const fileSystem = await openSafeSrijikaWorkspace(root);
    if (await fileSystem.isRegularFile('srijika.native.json')) {
      await readSrijikaEditorProject(fileSystem);
      const tools = [inspectSrijikaTool('node'), inspectSrijikaTool('pnpm')];
      this.#output.appendLine(
        `Native Doctor - ${root}: Expo Go profile valid. Native compilation tools are unnecessary.`,
      );
      for (const tool of tools)
        this.#output.appendLine(`${tool.name}: ${tool.version ?? 'not installed'}`);
      this.#output.appendLine(
        'Install / Sync project dependencies, then run pnpm verify for actual React Native types.',
      );
      this.#output.show(true);
      if (tools.every((tool) => tool.available))
        void vscode.window.showInformationMessage(
          'Native profile, Node and pnpm checks passed. Use Run App for Expo Go preview.',
        );
      else
        void vscode.window.showWarningMessage(
          'Native preview requires Node and the pinned pnpm package manager. See Srijika output.',
        );
      return;
    }
    const report = await createSrijikaDoctorReport(root, runtimePreference(folder));
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
