import { dirname, relative, resolve } from 'node:path';

import * as vscode from 'vscode';

import { compileSrijikaNativeTsx } from '@srijika/native/editor';

import {
  assertCompleteArchitectureScanBudget,
  selectArchitectureScanBudget,
  SRIJIKA_ARCHITECTURE_SCAN_LIMITS,
} from './architecture-scan-budget';
import { sourceSpanToRange } from './diagnostic-model';
import { nativeDiagnosticToEditorDiagnostic, nativeProjectDiagnostics } from './native-adapter';
import {
  nearestEditorProjectRoot,
  projectContainsFile,
  readSrijikaEditorProject,
  type SrijikaEditorProject,
} from './project-profile';
import { discoverSafeSrijikaNativeSources, openSafeSrijikaWorkspace } from './safe-workspace-files';

interface NativeEditorProject {
  root: string;
  uri: vscode.Uri;
  project?: SrijikaEditorProject;
  error?: string;
}

const exclude =
  '**/{node_modules,.git,.expo,dist,build,out,coverage,.next,.turbo,target,release-bundles}/**';
const key = (fileName: string): string =>
  process.platform === 'win32' ? resolve(fileName).toLowerCase() : resolve(fileName);

/** Native language state is kept outside the React/Next compiler and quick-fix caches. */
export class SrijikaNativeController implements vscode.Disposable {
  readonly #ui = vscode.languages.createDiagnosticCollection('srijika-native');
  readonly #architecture = vscode.languages.createDiagnosticCollection(
    'srijika-native-architecture',
  );
  readonly #config = vscode.languages.createDiagnosticCollection('srijika-native-config');
  readonly #output: vscode.OutputChannel;
  #projects = new Map<string, NativeEditorProject>();
  #roots: string[] = [];
  #revision = 0;
  #watchers: vscode.Disposable[] = [];
  readonly #onSourcesChanged: () => void;

  constructor(output: vscode.OutputChannel, onSourcesChanged: () => void = () => {}) {
    this.#output = output;
    this.#onSourcesChanged = onSourcesChanged;
  }

  async refreshProjects(): Promise<void> {
    const revision = ++this.#revision;
    const projects = new Map<string, NativeEditorProject>();
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const [configs, markers] = await Promise.all([
        vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, '**/srijika.config.json'),
          exclude,
          129,
        ),
        vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, '**/srijika.native.json'),
          exclude,
          129,
        ),
      ]);
      for (const uri of configs) roots.add(key(dirname(uri.fsPath)));
      for (const uri of markers) {
        const root = key(dirname(uri.fsPath));
        roots.add(root);
        projects.set(root, { root: dirname(uri.fsPath), uri });
      }
      if (configs.length > 128 || markers.length > 128 || roots.size > 128) {
        for (const project of projects.values())
          project.error =
            'Native project discovery exceeds the 128-project budget; narrow the open workspace.';
        break;
      }
    }
    for (const record of projects.values()) {
      if (record.error) continue;
      try {
        const fileSystem = await openSafeSrijikaWorkspace(record.root);
        const project = await readSrijikaEditorProject(fileSystem);
        if (project.kind !== 'native')
          throw new Error('Native profile disappeared while reading the project.');
        await fileSystem.readText(
          project.config.entry,
          SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile,
        );
        record.project = project;
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
      }
    }
    if (revision !== this.#revision) return;
    this.#projects = projects;
    this.#roots = [...roots];
    this.#ui.clear();
    this.#architecture.clear();
    this.#config.clear();
    for (const watcher of this.#watchers) watcher.dispose();
    this.#watchers = [];
    for (const record of projects.values()) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(record.root),
          '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
        ),
      );
      const changed = (uri: vscode.Uri): void => {
        if (
          !/[\\/](?:node_modules|\.git|\.expo|\.srijika|android|ios|dist|build|coverage)[\\/]/.test(
            uri.fsPath.slice(record.root.length),
          )
        )
          this.#onSourcesChanged();
      };
      this.#watchers.push(
        watcher,
        watcher.onDidCreate(changed),
        watcher.onDidChange(changed),
        watcher.onDidDelete(changed),
      );
    }
    for (const record of projects.values())
      if (record.error) this.#reportSetup(record, record.error);
    for (const document of vscode.workspace.textDocuments) this.compileDocument(document);
  }

  ownsFile(fileName: string): boolean {
    const root = nearestEditorProjectRoot(this.#roots, key(fileName));
    return root !== undefined && this.#projects.has(root);
  }

  ownsRoot(root: string): boolean {
    return this.#projects.has(key(root));
  }

  compileDocument(document: vscode.TextDocument): boolean {
    const root = nearestEditorProjectRoot(this.#roots, key(document.fileName));
    const record = root === undefined ? undefined : this.#projects.get(root);
    if (!record) return false;
    const project = record.project;
    if (
      !project ||
      document.languageId !== 'typescriptreact' ||
      !document.fileName.toLowerCase().endsWith(project.config.architecture.uiSuffix.toLowerCase())
    ) {
      this.#ui.delete(document.uri);
      return true;
    }
    const source = document.getText();
    const result = compileSrijikaNativeTsx(source, document.fileName);
    const diagnostics = result.diagnostics.map((native) => {
      const model = nativeDiagnosticToEditorDiagnostic(source, native, (offset) =>
        document.positionAt(offset),
      );
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          model.range.start.line,
          model.range.start.character,
          model.range.end.line,
          model.range.end.character,
        ),
        model.message,
        vscode.DiagnosticSeverity.Error,
      );
      diagnostic.code = model.code;
      diagnostic.source = 'Srijika Native';
      return diagnostic;
    });
    this.#ui.set(document.uri, diagnostics);
    return true;
  }

  checkCurrentFile(document: vscode.TextDocument): boolean {
    if (!this.ownsFile(document.fileName)) return false;
    this.compileDocument(document);
    const root = nearestEditorProjectRoot(this.#roots, key(document.fileName));
    const record = root === undefined ? undefined : this.#projects.get(root);
    if (!record?.project) {
      void vscode.window.showErrorMessage(
        `Srijika Native setup: ${record?.error ?? 'No validated Native project profile.'}`,
      );
      return true;
    }
    if (
      !document.fileName
        .toLowerCase()
        .endsWith(record.project.config.architecture.uiSuffix.toLowerCase())
    ) {
      void vscode.window.showInformationMessage(
        'Open a Native UI source to check its compiler contract.',
      );
      return true;
    }
    const issues = this.#ui.get(document.uri) ?? [];
    this.#output.appendLine(`Native ${document.fileName}: ${issues.length} compiler issue(s).`);
    if (issues.length === 0)
      void vscode.window.showInformationMessage('Srijika Native check passed: no issues found.');
    else this.#output.show(true);
    return true;
  }

  async checkArchitecture(
    isCurrent: () => boolean,
  ): Promise<{ projects: number; files: number; issues: number }> {
    const architecture = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
    const ui = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
    let checkedFiles = 0;
    let issues = 0;
    for (const record of this.#projects.values()) {
      if (!isCurrent()) return { projects: 0, files: 0, issues: 0 };
      const project = record.project;
      if (!project) {
        issues++;
        continue;
      }
      try {
        const fileSystem = await openSafeSrijikaWorkspace(record.root);
        const discovered = await discoverSafeSrijikaNativeSources(fileSystem);
        if (
          !discovered.some(
            (file) => key(file.absolutePath) === key(fileSystem.resolve(project.config.entry)),
          )
        )
          throw new Error('Native source scan omitted the authoritative entry.');
        const open = new Map(
          vscode.workspace.textDocuments
            .filter((document) => projectContainsFile(record.root, document.fileName))
            .map((document) => [
              key(fileSystem.resolve(relative(record.root, document.fileName))),
              document,
            ]),
        );
        const candidates = [];
        for (const file of discovered)
          candidates.push({
            value: file,
            byteLength: open.has(key(file.absolutePath))
              ? Buffer.byteLength(open.get(key(file.absolutePath))!.getText())
              : (await fileSystem.inspectRegularFile(file.absolutePath)).size,
          });
        const budget = selectArchitectureScanBudget(candidates);
        assertCompleteArchitectureScanBudget(budget);
        const files: { fileName: string; source: string }[] = [];
        let bytes = 0;
        for (const file of budget.accepted) {
          if (!isCurrent()) return { projects: 0, files: 0, issues: 0 };
          const source =
            open.get(key(file.value.absolutePath))?.getText() ??
            (
              await fileSystem.readText(
                file.value.relativePath,
                SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile,
              )
            ).source;
          bytes += Buffer.byteLength(source);
          if (bytes > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxTotalBytes)
            throw new Error('Native source scan exceeds the 24 MiB aggregate budget.');
          files.push({ fileName: file.value.absolutePath, source });
        }
        checkedFiles += files.length;
        if (isCurrent()) this.#config.delete(record.uri);
        const sourceByName = new Map(files.map((file) => [key(file.fileName), file.source]));
        for (const finding of nativeProjectDiagnostics(fileSystem.root, project, files)) {
          const source = sourceByName.get(key(finding.fileName));
          if (source === undefined) continue;
          const range = sourceSpanToRange(source, finding.span);
          const diagnostic = new vscode.Diagnostic(
            new vscode.Range(
              range.start.line,
              range.start.character,
              range.end.line,
              range.end.character,
            ),
            `${finding.message}\n${finding.guidance}`,
            finding.severity === 'error'
              ? vscode.DiagnosticSeverity.Error
              : vscode.DiagnosticSeverity.Warning,
          );
          diagnostic.code = finding.code;
          diagnostic.source = finding.code.startsWith('SRIJIKA-NATIVE1')
            ? 'Srijika Native'
            : 'Srijika Native Architecture';
          const uri = open.get(key(finding.fileName))?.uri ?? vscode.Uri.file(finding.fileName);
          const target = finding.code.startsWith('SRIJIKA-NATIVE1') ? ui : architecture;
          const entry = target.get(uri.toString()) ?? { uri, diagnostics: [] };
          entry.diagnostics.push(diagnostic);
          target.set(uri.toString(), entry);
          issues++;
        }
      } catch (error) {
        if (!isCurrent()) return { projects: 0, files: 0, issues: 0 };
        this.#reportSetup(record, error instanceof Error ? error.message : String(error));
        issues++;
      }
    }
    if (isCurrent()) {
      this.#architecture.clear();
      this.#ui.clear();
      for (const entry of architecture.values())
        this.#architecture.set(entry.uri, entry.diagnostics);
      for (const entry of ui.values()) this.#ui.set(entry.uri, entry.diagnostics);
      for (const document of vscode.workspace.textDocuments) this.compileDocument(document);
    }
    return { projects: this.#projects.size, files: checkedFiles, issues };
  }

  closeDocument(uri: vscode.Uri): void {
    this.#ui.delete(uri);
  }

  #reportSetup(record: NativeEditorProject, message: string): void {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      `Srijika Native check failed closed: ${message}`,
      vscode.DiagnosticSeverity.Error,
    );
    diagnostic.code = 'SRIJIKA-NATIVE0001';
    diagnostic.source = 'Srijika Native Setup';
    this.#config.set(record.uri, [diagnostic]);
    this.#output.appendLine(`[Native setup] ${record.root}: ${message}`);
  }

  dispose(): void {
    this.#revision++;
    for (const watcher of this.#watchers) watcher.dispose();
    this.#ui.dispose();
    this.#architecture.dispose();
    this.#config.dispose();
  }
}
