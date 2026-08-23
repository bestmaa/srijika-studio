import * as vscode from 'vscode';

import {
  collectSrijikaTestEvidence,
  inspectSrijikaProject,
  synchronizeSrijikaNextTests,
  synchronizeSrijikaViteTests,
  verifySrijikaOwnerTests,
  type CollectSrijikaTestEvidenceResult,
} from '@srijika/developer-engine';

import { selectedWorkspaceFolder } from './runtime-controller';
import {
  formatSrijikaTestEvidence,
  summarizeSrijikaTestSync,
  type SrijikaTestFramework,
  type SrijikaTestSyncSummary,
} from './testing-presentation';

async function selectFramework(
  viteProject: boolean,
  nextProject: boolean,
): Promise<SrijikaTestFramework> {
  if (viteProject && !nextProject) return 'vite';
  if (nextProject && !viteProject) return 'next-app-router';
  if (!viteProject && !nextProject) {
    throw new Error('This project is neither a detected Vite project nor a Next.js project.');
  }
  const selected = await vscode.window.showQuickPick(
    [
      { label: 'Next.js App Router', framework: 'next-app-router' as const },
      { label: 'Vite', framework: 'vite' as const },
    ],
    { placeHolder: 'Choose the owner-test adapter for this hybrid project' },
  );
  if (!selected) throw new Error('No test framework was selected.');
  return selected.framework;
}

function configuredPort(folder: vscode.WorkspaceFolder): number {
  return vscode.workspace.getConfiguration('srijika', folder.uri).get<number>('devPort', 5173);
}

export class SrijikaTestingController {
  readonly #output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.#output = output;
  }

  async synchronize(resource?: vscode.Uri): Promise<SrijikaTestSyncSummary> {
    const folder = await selectedWorkspaceFolder(
      resource,
      'Choose the Srijika project whose owner tests should be synchronized',
    );
    const project = await inspectSrijikaProject(folder.uri.fsPath);
    const framework = await selectFramework(project.viteProject, project.nextProject);
    const request = { project: project.root, port: configuredPort(folder) };
    const result =
      framework === 'vite'
        ? await synchronizeSrijikaViteTests(request)
        : await synchronizeSrijikaNextTests(request);
    const summary = summarizeSrijikaTestSync(result);
    this.#output.appendLine(`Srijika owner tests synchronized — ${folder.name}`);
    this.#output.appendLine(
      `${summary.framework}: ${summary.owners} owner(s), ${summary.artifacts} artifact(s), ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.preserved} authored fixture(s) preserved.`,
    );
    this.#output.appendLine(`Test scripts: ${summary.commands.join(' | ')}`);
    this.#output.appendLine(
      `Package sync: ${summary.packageScriptsAdded} script(s) and ${summary.packageDependenciesAdded} dev dependency entry/entries added.`,
    );
    this.#output.appendLine(`Test dev dependencies: ${summary.dependencies.join(', ')}`);
    this.#output.show(true);
    return summary;
  }

  async verify(resource?: vscode.Uri) {
    const folder = await selectedWorkspaceFolder(
      resource,
      'Choose the Srijika project whose owner tests should be verified',
    );
    const project = await inspectSrijikaProject(folder.uri.fsPath);
    const framework = await selectFramework(project.viteProject, project.nextProject);
    const result = await verifySrijikaOwnerTests({
      project: project.root,
      framework,
      port: configuredPort(folder),
    });
    this.#output.appendLine(`Srijika owner verification — ${folder.name}: ${result.status}`);
    for (const gate of result.gates) {
      this.#output.appendLine(
        `${gate.status === 'passed' ? '✓' : gate.status === 'failed' ? '✗' : '·'} ${gate.name}: ${gate.status}${gate.message ? ` — ${gate.message}` : ''}`,
      );
    }
    for (const line of formatSrijikaTestEvidence(result.evidence)) this.#output.appendLine(line);
    this.#output.show(true);
    return result;
  }

  async showEvidence(resource?: vscode.Uri): Promise<CollectSrijikaTestEvidenceResult> {
    const folder = await selectedWorkspaceFolder(
      resource,
      'Choose the Srijika project whose test evidence should be inspected',
    );
    const project = await inspectSrijikaProject(folder.uri.fsPath);
    const framework = await selectFramework(project.viteProject, project.nextProject);
    const result = await collectSrijikaTestEvidence({ project: project.root, framework });
    this.#output.appendLine(`Srijika test evidence — ${folder.name}`);
    for (const line of formatSrijikaTestEvidence(result)) this.#output.appendLine(line);
    this.#output.show(true);
    return result;
  }
}
