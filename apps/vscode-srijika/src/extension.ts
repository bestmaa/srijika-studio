import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import {
  parseSrijikaTypeScriptPathAliases,
  resolveSrijikaArchitectureConfig,
  resolveSrijikaStructureOwner,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';
import type { SrijikaComponentContractEntry, SrijikaDiagnostic } from '@srijika/tsx-compiler';

import {
  architectureDiagnosticToEditorDiagnostic,
  parseSrijikaCodeProjectConfig,
  validateArchitectureWorkspace,
} from './architecture-adapter';
import { isSrijikaUiSourcePath, srijikaArchitectureWatchPatterns } from './architecture-discovery';
import {
  assertCompleteArchitectureScanBudget,
  selectArchitectureScanBudget,
  SRIJIKA_ARCHITECTURE_SCAN_LIMITS,
} from './architecture-scan-budget';
import { compileUiSource } from './compiler-adapter';
import { extractCssClassNames, srijikaJsxCompletions } from './completion-model';
import { SRIJIKA_CREATION_ACTION_LABELS } from './creation-presentation';
import {
  renderSrijikaCreationWebview,
  srijikaOwnershipPlanPreviewPaths,
  type SrijikaCreationMode,
  type SrijikaOwnerFilePresentation,
} from './creation-webview';
import { diagnosticToEditorDiagnostic, rangesEqual, type EditorRange } from './diagnostic-model';
import { persistSrijikaOwnershipFiles } from './durable-save';
import {
  availableSrijikaOwnershipCreationActions,
  buildSrijikaOwnershipCapabilityBatchPlan,
  buildSrijikaOwnershipCreationPlan,
  srijikaOwnershipFileStatuses,
  type SrijikaOptionalOwnerCapability,
  type SrijikaOwnershipCreationPlan,
} from './ownership-creation';
import { upgradedSrijikaPortableValidator } from './portable-validator-sync';
import { SrijikaStructureTreeItem, SrijikaStructureTreeProvider } from './structure-view';
import { SrijikaMigrationViewProvider } from './migration-view';
import { SrijikaRuntimeController } from './runtime-controller';
import { SrijikaTestingController } from './testing-controller';
import {
  discoverSafeSrijikaMigrationSources,
  discoverSafeSrijikaSources,
  openSafeSrijikaWorkspace,
} from './safe-workspace-files';

const DIAGNOSTIC_SOURCE = 'Srijika';
const ARCHITECTURE_DIAGNOSTIC_SOURCE = 'Srijika Architecture';
const UI_FILE_SUFFIX = '.ui.tsx';
const MAX_ARCHITECTURE_CONFIG_BYTES = 64 * 1024;
const MAX_TSCONFIG_BYTES = 1024 * 1024;

interface ArchitectureSourceCandidate {
  uri: vscode.Uri;
  document: vscode.TextDocument | undefined;
  source: string | undefined;
}

interface CachedCompilation {
  documentVersion: number;
  diagnostics: readonly SrijikaDiagnostic[];
  componentContract: readonly SrijikaComponentContractEntry[];
}

function isSrijikaUiDocument(document: vscode.TextDocument, uiSuffix = UI_FILE_SUFFIX): boolean {
  return (
    document.languageId === 'typescriptreact' && isSrijikaUiSourcePath(document.fileName, uiSuffix)
  );
}

function toVscodeRange(range: EditorRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

function toVscodeSeverity(severity: SrijikaDiagnostic['severity']): vscode.DiagnosticSeverity {
  return severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
}

function rangesMatch(left: vscode.Range, right: EditorRange): boolean {
  return rangesEqual(
    {
      start: {
        line: left.start.line,
        character: left.start.character,
      },
      end: { line: left.end.line, character: left.end.character },
    },
    right,
  );
}

function positionResolverFor(
  document: vscode.TextDocument,
): (offset: number) => { line: number; character: number } {
  return (offset) => {
    const position = document.positionAt(offset);
    return { line: position.line, character: position.character };
  };
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') ||
    (error instanceof Error && 'code' in error && error.code === 'ENOENT')
  );
}

async function assertNoWorkspaceSymlinkAncestors(
  workspaceFolder: vscode.WorkspaceFolder,
  relativePaths: readonly string[],
): Promise<void> {
  const checked = new Set<string>();
  for (const relativePath of relativePaths) {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\/+/, '');
    const segments = normalized.split('/');
    if (
      !normalized ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized) ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error('Srijika refused an unsafe workspace-relative creation path.');
    }
    for (let length = 1; length <= segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join('/');
      if (checked.has(ancestor)) continue;
      checked.add(ancestor);
      try {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(workspaceFolder.uri, ...segments.slice(0, length)),
        );
        if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
          throw new Error(
            'Srijika refused to read or write through a symbolic link inside the workspace.',
          );
        }
      } catch (error) {
        if (isFileNotFoundError(error)) break;
        throw error;
      }
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('srijika');
  const architectureCollection =
    vscode.languages.createDiagnosticCollection('srijika-architecture');
  const output = vscode.window.createOutputChannel('Srijika');
  const runtimeController = new SrijikaRuntimeController(output);
  const testingController = new SrijikaTestingController(output);
  const compilations = new Map<string, CachedCompilation>();
  let cssClassNamesPromise: Promise<readonly string[]> | null = null;
  let architectureTimer: NodeJS.Timeout | undefined;
  let architectureRun = 0;
  const uiSuffixByWorkspace = new Map<string, string>();
  const typesSuffixByWorkspace = new Map<string, string>();
  const sourceByFileNameByWorkspace = new Map<string, ReadonlyMap<string, string>>();
  const structureProvider = new SrijikaStructureTreeProvider();
  const structureView = vscode.window.createTreeView('srijika.structure', {
    treeDataProvider: structureProvider,
    showCollapseAll: true,
  });
  const migrationProvider = new SrijikaMigrationViewProvider(output);
  const migrationView = vscode.window.registerWebviewViewProvider(
    'srijika.migration',
    migrationProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  const isConfiguredSrijikaUiDocument = (document: vscode.TextDocument): boolean => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const uiSuffix = workspaceFolder
      ? (uiSuffixByWorkspace.get(workspaceFolder.uri.toString()) ?? UI_FILE_SUFFIX)
      : UI_FILE_SUFFIX;
    return isSrijikaUiDocument(document, uiSuffix);
  };

  const runArchitectureCheck = async (run: number, showSummary = false): Promise<void> => {
    if (run !== architectureRun) return;
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const nextDiagnostics = new Map<
      string,
      { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }
    >();
    const statusLines: string[] = [];
    const textEncoder = new TextEncoder();
    let checkedFiles = 0;
    let issueCount = 0;
    let configuredWorkspaces = 0;
    let skippedWorkspaces = 0;
    let skippedByFileLimit = 0;
    let skippedOversized = 0;
    let skippedByTotalLimit = 0;
    let skippedUnreadable = 0;

    for (const folder of workspaceFolders) {
      if (run !== architectureRun) return;
      let architecture;
      let authoritativeEntry: string | undefined;
      let aliases: Readonly<Record<string, string>> = {};
      let fileSystem: Awaited<ReturnType<typeof openSafeSrijikaWorkspace>>;
      try {
        fileSystem = await openSafeSrijikaWorkspace(folder.uri.fsPath);
        const config = await fileSystem.readText(
          'srijika.config.json',
          MAX_ARCHITECTURE_CONFIG_BYTES,
        );
        if (run !== architectureRun) return;
        const projectConfig = parseSrijikaCodeProjectConfig(config.source);
        architecture = projectConfig.architecture;
        authoritativeEntry = projectConfig.entry;
        await fileSystem.readText(
          authoritativeEntry,
          SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile,
        );
        if (await fileSystem.isRegularFile('tsconfig.json')) {
          aliases = parseSrijikaTypeScriptPathAliases(
            (await fileSystem.readText('tsconfig.json', MAX_TSCONFIG_BYTES)).source,
          );
        }
      } catch (error) {
        skippedWorkspaces += 1;
        statusLines.push(
          isFileNotFoundError(error)
            ? `${folder.name}: architecture check skipped; no readable srijika.config.json was found.`
            : `${folder.name}: architecture check failed closed; ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!architecture) {
        skippedWorkspaces += 1;
        statusLines.push(
          `${folder.name}: architecture check skipped; set architecture.profile to "feature-slot-part-v1" in srijika.config.json.`,
        );
        continue;
      }
      architecture = resolveSrijikaArchitectureConfig(architecture);
      uiSuffixByWorkspace.set(folder.uri.toString(), architecture.uiSuffix);
      typesSuffixByWorkspace.set(folder.uri.toString(), architecture.typesSuffix);
      configuredWorkspaces += 1;

      let uris: readonly vscode.Uri[];
      try {
        const discovered = await discoverSafeSrijikaSources(fileSystem, architecture);
        uris = discovered.map(({ relativePath }) =>
          vscode.Uri.joinPath(folder.uri, ...relativePath.split('/')),
        );
        if (authoritativeEntry) {
          const entryUri = vscode.Uri.joinPath(folder.uri, ...authoritativeEntry.split('/'));
          if (!uris.some((uri) => uri.toString() === entryUri.toString())) {
            uris = [...uris, entryUri];
          }
        }
      } catch (error) {
        skippedWorkspaces += 1;
        configuredWorkspaces -= 1;
        statusLines.push(
          `${folder.name}: architecture check failed closed; ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (run !== architectureRun) return;
      uris = [...uris].sort((left, right) => left.fsPath.localeCompare(right.fsPath));
      const openDocuments = new Map(
        vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
      );
      const candidates: Array<{
        value: ArchitectureSourceCandidate;
        byteLength: number;
      }> = [];
      let workspaceReadFailure: string | undefined;
      for (const uri of uris) {
        if (run !== architectureRun) return;
        const document = openDocuments.get(uri.toString());
        if (document) {
          const source = document.getText();
          candidates.push({
            value: { uri, document, source },
            byteLength: textEncoder.encode(source).byteLength,
          });
          continue;
        }
        try {
          const stat = await fileSystem.inspectRegularFile(uri.fsPath);
          if (run !== architectureRun) return;
          candidates.push({
            value: { uri, document: undefined, source: undefined },
            byteLength: stat.size,
          });
        } catch (error) {
          skippedUnreadable += 1;
          workspaceReadFailure = error instanceof Error ? error.message : String(error);
          break;
        }
      }
      if (workspaceReadFailure) {
        skippedWorkspaces += 1;
        configuredWorkspaces -= 1;
        statusLines.push(
          `${folder.name}: architecture check failed closed; ${workspaceReadFailure}`,
        );
        continue;
      }

      const budget = selectArchitectureScanBudget(candidates);
      skippedByFileLimit += budget.skippedByFileLimit;
      skippedOversized += budget.skippedOversized;
      skippedByTotalLimit += budget.skippedByTotalLimit;
      try {
        assertCompleteArchitectureScanBudget(budget);
      } catch (error) {
        skippedWorkspaces += 1;
        configuredWorkspaces -= 1;
        statusLines.push(
          `${folder.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      let actualWorkspaceBytes = 0;
      const files: Array<{
        fileName: string;
        source: string;
        uri: vscode.Uri;
        document: vscode.TextDocument | undefined;
      }> = [];
      for (const candidate of budget.accepted) {
        if (run !== architectureRun) return;
        try {
          let source: string;
          let byteLength: number;
          if (candidate.value.source !== undefined) {
            source = candidate.value.source;
            byteLength = textEncoder.encode(source).byteLength;
          } else {
            const read = await fileSystem.readText(
              candidate.value.uri.fsPath,
              SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile,
            );
            if (run !== architectureRun) return;
            byteLength = read.size;
            source = read.source;
          }
          if (byteLength > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile) {
            skippedOversized += 1;
            workspaceReadFailure = `${candidate.value.uri.fsPath} exceeds the 4 MiB source limit.`;
            break;
          }
          if (actualWorkspaceBytes + byteLength > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxTotalBytes) {
            skippedByTotalLimit += 1;
            workspaceReadFailure = 'The source corpus exceeds the 24 MiB aggregate limit.';
            break;
          }
          actualWorkspaceBytes += byteLength;
          files.push({
            fileName: candidate.value.uri.fsPath,
            source,
            uri: candidate.value.uri,
            document: candidate.value.document,
          });
        } catch (error) {
          skippedUnreadable += 1;
          workspaceReadFailure = error instanceof Error ? error.message : String(error);
          break;
        }
      }
      if (workspaceReadFailure) {
        skippedWorkspaces += 1;
        configuredWorkspaces -= 1;
        statusLines.push(
          `${folder.name}: architecture check failed closed; ${workspaceReadFailure}`,
        );
        continue;
      }
      checkedFiles += files.length;
      const sourceByFileName = new Map(files.map((file) => [file.fileName, file.source]));
      sourceByFileNameByWorkspace.set(folder.uri.toString(), sourceByFileName);
      for (const document of vscode.workspace.textDocuments) {
        if (
          vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ===
          folder.uri.toString()
        ) {
          compilations.delete(document.uri.toString());
        }
      }

      const diagnostics = validateArchitectureWorkspace({
        projectRoot: folder.uri.fsPath,
        files,
        architecture,
        aliases,
      });
      issueCount += diagnostics.length;
      const filesByName = new Map(files.map((file) => [file.fileName.replaceAll('\\', '/'), file]));
      for (const architectureDiagnostic of diagnostics) {
        const normalizedName = architectureDiagnostic.fileName.replaceAll('\\', '/');
        const sourceFile = filesByName.get(normalizedName);
        if (!sourceFile) continue;
        const model = architectureDiagnosticToEditorDiagnostic(
          sourceFile.source,
          architectureDiagnostic,
          sourceFile.document ? positionResolverFor(sourceFile.document) : undefined,
        );
        const diagnostic = new vscode.Diagnostic(
          toVscodeRange(model.range),
          `${model.message}\n${model.guidance}${model.ruleId ? `\nRule: ${model.ruleId}` : ''}`,
          model.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.code = model.code;
        diagnostic.source = ARCHITECTURE_DIAGNOSTIC_SOURCE;
        const key = sourceFile.uri.toString();
        const entry = nextDiagnostics.get(key) ?? { uri: sourceFile.uri, diagnostics: [] };
        entry.diagnostics.push(diagnostic);
        nextDiagnostics.set(key, entry);
      }
      for (const sourceFile of files) {
        if (!isSrijikaUiSourcePath(sourceFile.fileName, architecture.uiSuffix)) continue;
        const compiled = compileUiSource(
          { fileName: sourceFile.fileName, source: sourceFile.source },
          {
            uiSuffix: architecture.uiSuffix,
            typesSuffix: architecture.typesSuffix,
            sourceByFileName,
          },
        );
        issueCount += compiled.diagnostics.length;
        for (const compilerDiagnostic of compiled.diagnostics) {
          const model = diagnosticToEditorDiagnostic(
            sourceFile.source,
            compilerDiagnostic,
            sourceFile.document ? positionResolverFor(sourceFile.document) : undefined,
          );
          const diagnostic = new vscode.Diagnostic(
            toVscodeRange(model.range),
            model.message,
            toVscodeSeverity(model.severity),
          );
          diagnostic.code = model.code;
          diagnostic.source = DIAGNOSTIC_SOURCE;
          const key = sourceFile.uri.toString();
          const entry = nextDiagnostics.get(key) ?? { uri: sourceFile.uri, diagnostics: [] };
          entry.diagnostics.push(diagnostic);
          nextDiagnostics.set(key, entry);
        }
      }
    }

    if (run !== architectureRun) return;
    architectureCollection.clear();
    for (const { uri, diagnostics } of nextDiagnostics.values()) {
      architectureCollection.set(uri, diagnostics);
    }
    for (const document of vscode.workspace.textDocuments) compileDocument(document);
    for (const line of statusLines) output.appendLine(`Architecture setup: ${line}`);
    const coverageNotes = [
      skippedByFileLimit > 0
        ? `at least ${skippedByFileLimit} source file(s) omitted by the ${SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxFiles}-file cap`
        : undefined,
      skippedOversized > 0
        ? `${skippedOversized} source file(s) omitted for exceeding 4 MiB`
        : undefined,
      skippedByTotalLimit > 0
        ? `${skippedByTotalLimit} source file(s) omitted by the 24 MiB workspace cap`
        : undefined,
      skippedUnreadable > 0 ? `${skippedUnreadable} unreadable source file(s) omitted` : undefined,
    ].filter((note): note is string => Boolean(note));
    output.appendLine(
      `Architecture: ${issueCount} issue(s) across ${checkedFiles} source file(s) in ${configuredWorkspaces} configured workspace(s); ${skippedWorkspaces} workspace(s) skipped.${coverageNotes.length > 0 ? ` Limited coverage: ${coverageNotes.join('; ')}.` : ''}`,
    );
    if (showSummary) {
      if (skippedWorkspaces > 0) {
        output.show(true);
        void vscode.window.showWarningMessage(
          'Srijika architecture check failed closed for one or more workspaces. See Srijika output.',
        );
      } else if (configuredWorkspaces === 0) {
        output.show(true);
        void vscode.window.showInformationMessage(
          'Srijika architecture check skipped. Add a supported architecture block to srijika.config.json.',
        );
      } else if (issueCount === 0) {
        void vscode.window.showInformationMessage('Srijika architecture check passed.');
      } else {
        output.show(true);
      }
    }
  };

  const scheduleArchitectureCheck = (delay = 180): void => {
    if (architectureTimer) clearTimeout(architectureTimer);
    const run = ++architectureRun;
    architectureTimer = setTimeout(() => {
      architectureTimer = undefined;
      void runArchitectureCheck(run);
    }, delay);
  };

  const startArchitectureCheck = async (showSummary = false): Promise<void> => {
    if (architectureTimer) {
      clearTimeout(architectureTimer);
      architectureTimer = undefined;
    }
    const run = ++architectureRun;
    await runArchitectureCheck(run, showSummary);
  };

  const workspaceCssClassNames = (): Promise<readonly string[]> => {
    cssClassNamesPromise ??= (async () => {
      const uris = await vscode.workspace.findFiles(
        '**/*.css',
        '**/{node_modules,dist,build,.git}/**',
        200,
      );
      const names = new Set<string>();
      await Promise.all(
        uris.map(async (uri) => {
          const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          for (const name of extractCssClassNames(source)) names.add(name);
        }),
      );
      return [...names].sort((left, right) => left.localeCompare(right));
    })();
    return cssClassNamesPromise;
  };

  const compileDocument = (document: vscode.TextDocument): CachedCompilation | undefined => {
    if (!isConfiguredSrijikaUiDocument(document)) {
      collection.delete(document.uri);
      compilations.delete(document.uri.toString());
      return undefined;
    }

    try {
      const source = document.getText();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const workspaceKey = workspaceFolder?.uri.toString();
      const result = compileUiSource(
        { fileName: document.fileName, source },
        workspaceKey
          ? {
              ...(uiSuffixByWorkspace.get(workspaceKey)
                ? { uiSuffix: uiSuffixByWorkspace.get(workspaceKey)! }
                : {}),
              ...(typesSuffixByWorkspace.get(workspaceKey)
                ? { typesSuffix: typesSuffixByWorkspace.get(workspaceKey)! }
                : {}),
              ...(sourceByFileNameByWorkspace.get(workspaceKey)
                ? { sourceByFileName: sourceByFileNameByWorkspace.get(workspaceKey)! }
                : {}),
            }
          : {},
      );
      const resolvePosition = positionResolverFor(document);
      const diagnostics = result.diagnostics.map((compilerDiagnostic) => {
        const model = diagnosticToEditorDiagnostic(source, compilerDiagnostic, resolvePosition);
        const diagnostic = new vscode.Diagnostic(
          toVscodeRange(model.range),
          model.message,
          toVscodeSeverity(model.severity),
        );
        diagnostic.code = model.code;
        diagnostic.source = DIAGNOSTIC_SOURCE;
        return diagnostic;
      });

      collection.set(document.uri, diagnostics);
      const compilation = {
        documentVersion: document.version,
        diagnostics: result.diagnostics,
        componentContract: result.componentContract,
      };
      compilations.set(document.uri.toString(), compilation);
      return compilation;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        `Srijika compiler failed: ${message}`,
        vscode.DiagnosticSeverity.Error,
      );
      diagnostic.code = 'SRIJIKA0001';
      diagnostic.source = DIAGNOSTIC_SOURCE;
      collection.set(document.uri, [diagnostic]);
      compilations.delete(document.uri.toString());
      output.appendLine(`[compiler error] ${document.fileName}: ${message}`);
      return undefined;
    }
  };

  const compilationFor = (document: vscode.TextDocument): CachedCompilation | undefined => {
    const cached = compilations.get(document.uri.toString());
    return cached?.documentVersion === document.version ? cached : compileDocument(document);
  };

  const checkCurrentFile = vscode.commands.registerCommand('srijika.checkCurrentFile', () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isConfiguredSrijikaUiDocument(document)) {
      void vscode.window.showWarningMessage(
        'Open the configured Srijika UI source file to run validation.',
      );
      return;
    }

    const result = compileDocument(document);
    if (!result) {
      output.show(true);
      return;
    }

    const errorCount = result.diagnostics.filter(({ severity }) => severity === 'error').length;
    const warningCount = result.diagnostics.length - errorCount;
    output.appendLine(`${document.fileName}: ${errorCount} error(s), ${warningCount} warning(s)`);

    if (result.diagnostics.length === 0) {
      void vscode.window.showInformationMessage('Srijika check passed: no issues found.');
    } else {
      output.show(true);
    }
  });

  const checkArchitecture = vscode.commands.registerCommand('srijika.checkArchitecture', async () =>
    startArchitectureCheck(true),
  );

  const showSetup = vscode.commands.registerCommand('srijika.showSetup', async () => {
    const readme = vscode.Uri.joinPath(context.extensionUri, 'README.md');
    await vscode.commands.executeCommand('markdown.showPreview', readme);
  });

  const importExistingReactProject = vscode.commands.registerCommand(
    'srijika.importReactProject',
    () => migrationProvider.reveal(),
  );

  const architectureForCreation = async (workspaceFolder: vscode.WorkspaceFolder) => {
    uiSuffixByWorkspace.delete(workspaceFolder.uri.toString());
    let architecture = resolveSrijikaArchitectureConfig();
    try {
      const fileSystem = await openSafeSrijikaWorkspace(workspaceFolder.uri.fsPath);
      const config = await fileSystem.readText(
        'srijika.config.json',
        MAX_ARCHITECTURE_CONFIG_BYTES,
      );
      const parsed = parseSrijikaCodeProjectConfig(config.source);
      await fileSystem.readText(parsed.entry, SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile);
      architecture = resolveSrijikaArchitectureConfig(parsed.architecture);
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
    }
    uiSuffixByWorkspace.set(workspaceFolder.uri.toString(), architecture.uiSuffix);
    return architecture;
  };

  const resolveCreationTarget = async (
    target: vscode.Uri | SrijikaStructureTreeItem,
  ): Promise<{
    resource: vscode.Uri;
    workspaceFolder: vscode.WorkspaceFolder;
    owner: SrijikaStructureOwnerContext;
    architecture: ReturnType<typeof resolveSrijikaArchitectureConfig>;
  }> => {
    if (target instanceof SrijikaStructureTreeItem) {
      const architecture = await architectureForCreation(target.workspaceFolder);
      const owner = resolveSrijikaStructureOwner(
        target.structureOwner.relativeFolder,
        architecture,
      );
      if (!owner) {
        throw new Error('The selected Srijika owner is stale or no longer canonical.');
      }
      return {
        resource: vscode.Uri.joinPath(
          target.workspaceFolder.uri,
          ...target.structureOwner.relativeFolder.split('/'),
        ),
        workspaceFolder: target.workspaceFolder,
        owner,
        architecture,
      };
    }
    const resource = target;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
    if (!workspaceFolder) throw new Error('Select a folder inside an open workspace.');
    const relativeFolder = vscode.workspace
      .asRelativePath(resource, false)
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '');
    const architecture = await architectureForCreation(workspaceFolder);
    const owner = resolveSrijikaStructureOwner(relativeFolder, architecture);
    if (!owner) {
      throw new Error(
        `Creation is strict: select ${architecture.featuresRoot}, a Feature/Slot/Part owner, ${architecture.sharedRoot}, or a canonical Shared owner.`,
      );
    }
    return { resource, workspaceFolder, owner, architecture };
  };

  interface ExistingOwnershipState {
    paths: readonly string[];
    sources: Readonly<Record<string, string>>;
    aliases: Readonly<Record<string, string>>;
  }

  const existingOwnershipState = async (
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<ExistingOwnershipState> => {
    const fileSystem = await openSafeSrijikaWorkspace(workspaceFolder.uri.fsPath);
    const discovered = await discoverSafeSrijikaMigrationSources(fileSystem);
    const sourceUris = discovered.map(({ relativePath }) =>
      vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split('/')),
    );
    const paths = discovered.map(({ relativePath }) => relativePath);
    const projectFiles = sourceUris.map((uri, index) => ({
      uri,
      relativePath: paths[index] ?? '',
    }));
    await assertNoWorkspaceSymlinkAncestors(
      workspaceFolder,
      projectFiles.map(({ relativePath }) => relativePath),
    );
    const openDocuments = new Map(
      vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
    );
    const sources: Record<string, string> = {};
    let totalBytes = 0;
    for (const { uri, relativePath } of projectFiles) {
      const openSource = openDocuments.get(uri.toString())?.getText();
      if (openSource !== undefined) {
        const byteLength = Buffer.byteLength(openSource, 'utf8');
        if (byteLength > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile) {
          throw new Error(`${relativePath} exceeds the 4 MiB source limit.`);
        }
        totalBytes += byteLength;
        sources[relativePath] = openSource;
      } else {
        const read = await fileSystem.readText(
          uri.fsPath,
          SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile,
        );
        totalBytes += read.size;
        sources[relativePath] = read.source;
      }
      if (totalBytes > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxTotalBytes) {
        throw new Error('Ownership inventory exceeds the 24 MiB aggregate source limit.');
      }
    }
    const aliases = (await fileSystem.isRegularFile('tsconfig.json'))
      ? parseSrijikaTypeScriptPathAliases(
          (await fileSystem.readText('tsconfig.json', MAX_TSCONFIG_BYTES)).source,
        )
      : {};
    return { paths, sources, aliases };
  };

  const commitOwnershipPlan = async (
    workspaceFolder: vscode.WorkspaceFolder,
    plan: SrijikaOwnershipCreationPlan,
  ): Promise<void> => {
    await assertNoWorkspaceSymlinkAncestors(workspaceFolder, [
      plan.ownerFolder,
      ...plan.files.map(({ relativePath }) => relativePath),
      ...plan.updates.map(({ relativePath }) => relativePath),
      ...(plan.moves ?? []).flatMap(({ fromRelativePath, toRelativePath }) => [
        fromRelativePath,
        toRelativePath,
      ]),
      'scripts/srijika-validate.mjs',
    ]);
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(workspaceFolder.uri, ...plan.ownerFolder.split('/')),
    );
    for (const relativePath of [
      ...plan.files.map(({ relativePath }) => relativePath),
      ...(plan.moves ?? []).map(({ toRelativePath }) => toRelativePath),
    ]) {
      const segments = relativePath.split('/');
      segments.pop();
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(workspaceFolder.uri, ...segments),
      );
    }
    const edit = new vscode.WorkspaceEdit();
    const updateDocuments = new Map<string, vscode.TextDocument>();
    const managedToolingUpdates: string[] = [];
    try {
      const fileSystem = await openSafeSrijikaWorkspace(workspaceFolder.uri.fsPath);
      const configUri = vscode.Uri.joinPath(workspaceFolder.uri, 'srijika.config.json');
      const validatorRelativePath = 'scripts/srijika-validate.mjs';
      const validatorUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ...validatorRelativePath.split('/'),
      );
      const [config, validatorDocument] = await Promise.all([
        fileSystem.readText(configUri.fsPath, MAX_ARCHITECTURE_CONFIG_BYTES),
        vscode.workspace.openTextDocument(validatorUri),
      ]);
      const validatorMetadata = await fileSystem.inspectRegularFile(validatorUri.fsPath);
      if (validatorMetadata.size > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile) {
        throw new Error('scripts/srijika-validate.mjs exceeds the 4 MiB tooling limit.');
      }
      if (!validatorDocument.isDirty) {
        const upgradedSource = upgradedSrijikaPortableValidator(
          config.source,
          validatorDocument.getText(),
        );
        if (upgradedSource) {
          updateDocuments.set(validatorRelativePath, validatorDocument);
          managedToolingUpdates.push(validatorRelativePath);
          edit.replace(
            validatorUri,
            new vscode.Range(
              new vscode.Position(0, 0),
              validatorDocument.positionAt(validatorDocument.getText().length),
            ),
            upgradedSource,
          );
        }
      }
    } catch {
      // Older or custom projects may omit the generated portable validator. Ownership creation
      // remains valid, and no unknown tooling file is ever created or overwritten here.
    }
    for (const file of plan.files) {
      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, ...file.relativePath.split('/'));
      edit.createFile(fileUri, { overwrite: false, ignoreIfExists: false });
      edit.insert(fileUri, new vscode.Position(0, 0), file.source);
    }
    for (const move of plan.moves ?? []) {
      const sourceUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ...move.fromRelativePath.split('/'),
      );
      const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, ...move.toRelativePath.split('/'));
      edit.createFile(targetUri, { overwrite: false, ignoreIfExists: false });
      edit.insert(targetUri, new vscode.Position(0, 0), move.source);
      edit.deleteFile(sourceUri, { recursive: false, ignoreIfNotExists: false });
    }
    for (const update of plan.updates) {
      const updateUri = vscode.Uri.joinPath(workspaceFolder.uri, ...update.relativePath.split('/'));
      const document = await vscode.workspace.openTextDocument(updateUri);
      updateDocuments.set(update.relativePath, document);
      edit.replace(
        updateUri,
        new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)),
        update.source,
      );
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error('VS Code rejected the ownership scaffold. No existing file was overwritten.');
    }
    await persistSrijikaOwnershipFiles(
      [
        ...plan.files.map(({ relativePath }) => relativePath),
        ...plan.updates.map(({ relativePath }) => relativePath),
        ...(plan.moves ?? []).map(({ toRelativePath }) => toRelativePath),
        ...managedToolingUpdates,
      ],
      async (relativePath) =>
        updateDocuments.get(relativePath) ??
        (await vscode.workspace.openTextDocument(
          vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split('/')),
        )),
    );
    structureProvider.refresh();
    scheduleArchitectureCheck(0);
    const firstFile = plan.files[0];
    if (firstFile) {
      const firstUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ...firstFile.relativePath.split('/'),
      );
      await vscode.window.showTextDocument(firstUri, { preview: true });
    }
  };

  const ownerDisplayName = (owner: SrijikaStructureOwnerContext): string => {
    switch (owner.level) {
      case 'featuresRoot':
        return 'Features';
      case 'feature':
        return owner.featureName;
      case 'slot':
        return owner.slotName;
      case 'part':
        return owner.partName;
      case 'sharedRoot':
        return 'Shared';
      case 'sharedUi':
      case 'sharedWidget':
      case 'sharedCapability':
        return owner.sharedName;
    }
  };

  const openOwnershipCreator = async (
    target: vscode.Uri | SrijikaStructureTreeItem,
  ): Promise<void> => {
    const { workspaceFolder, owner, architecture } = await resolveCreationTarget(target);
    const existingAtOpen = await existingOwnershipState(workspaceFolder);
    const allowedActions = availableSrijikaOwnershipCreationActions(
      owner,
      existingAtOpen.paths,
      existingAtOpen.sources,
      architecture,
    );
    const isChildAction = (
      action: SrijikaStructureCreationAction,
    ): action is 'feature' | 'slot' | 'part' | 'sharedUi' | 'sharedWidget' | 'sharedCapability' =>
      action === 'feature' ||
      action === 'slot' ||
      action === 'part' ||
      action === 'sharedUi' ||
      action === 'sharedWidget' ||
      action === 'sharedCapability';
    const isExpansionAction = (
      action: SrijikaStructureCreationAction,
    ): action is
      | 'featureBehaviorHook'
      | 'featureStoreSlice'
      | 'slotBehaviorHook'
      | 'slotStoreSlice'
      | 'partBehaviorHook'
      | 'partStoreSlice'
      | 'sharedWidgetBehaviorHook'
      | 'sharedWidgetStoreSlice'
      | 'sharedCapabilityBehaviorHook'
      | 'sharedCapabilityStoreSlice' =>
      action.endsWith('BehaviorHook') || action.endsWith('StoreSlice');
    const missingOwnerActions = allowedActions.filter(
      (action) => !isChildAction(action) && !isExpansionAction(action),
    );
    const childActions = allowedActions.filter(isChildAction).map((action) => ({
      action,
      ...SRIJIKA_CREATION_ACTION_LABELS[action],
    }));
    const expansionActions = allowedActions.filter(isExpansionAction).map((action) => ({
      action,
      ...SRIJIKA_CREATION_ACTION_LABELS[action],
    }));
    const ownerFilesFor = (existing: ExistingOwnershipState): SrijikaOwnerFilePresentation[] =>
      owner.level === 'featuresRoot' || owner.level === 'sharedRoot'
        ? []
        : srijikaOwnershipFileStatuses(owner, existing.paths, architecture).map((status) => ({
            ...status,
            label:
              status.role === 'ui'
                ? `${ownerDisplayName(owner)} UI`
                : status.action
                  ? SRIJIKA_CREATION_ACTION_LABELS[status.action].label
                  : status.role,
            description:
              status.role === 'ui'
                ? 'Pure React UI source for this owner'
                : status.action
                  ? SRIJIKA_CREATION_ACTION_LABELS[status.action].description
                  : 'Owner file',
          }));
    const panel = vscode.window.createWebviewPanel(
      'srijikaOwnershipCreation',
      `Srijika: Add to ${ownerDisplayName(owner)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    let selectedChildAction = childActions[0]?.action;
    let selectedExpansionAction = expansionActions[0]?.action;
    let selectedMode: SrijikaCreationMode =
      owner.level === 'featuresRoot' || owner.level === 'sharedRoot'
        ? 'childOwner'
        : missingOwnerActions.length > 0
          ? 'ownerFiles'
          : selectedExpansionAction
            ? 'ownerExpansion'
            : selectedChildAction
              ? 'childOwner'
              : 'ownerFiles';
    let selectedOwnerActions: readonly SrijikaStructureCreationAction[] = [];
    let name = '';
    let optionalCapabilities: readonly SrijikaOptionalOwnerCapability[] = [];
    let creating = false;

    const buildSelectedPlan = (existing: ExistingOwnershipState): SrijikaOwnershipCreationPlan => {
      if (selectedMode === 'ownerFiles') {
        if (owner.level === 'featuresRoot' || owner.level === 'sharedRoot') {
          throw new Error('A structure root does not own runtime capability files.');
        }
        return buildSrijikaOwnershipCapabilityBatchPlan({
          owner,
          actions: selectedOwnerActions,
          existingRelativePaths: existing.paths,
          existingSources: existing.sources,
          aliases: existing.aliases,
          architecture,
        });
      }
      if (selectedMode === 'ownerExpansion') {
        if (!selectedExpansionAction) {
          throw new Error('No private Hook or Store action is available.');
        }
        return buildSrijikaOwnershipCreationPlan({
          owner,
          action: selectedExpansionAction,
          name,
          existingRelativePaths: existing.paths,
          existingSources: existing.sources,
          aliases: existing.aliases,
          architecture,
        });
      }
      if (!selectedChildAction) {
        throw new Error('No child owner is valid at this boundary.');
      }
      return buildSrijikaOwnershipCreationPlan({
        owner,
        action: selectedChildAction,
        ...(name ? { name } : {}),
        optionalCapabilities,
        existingRelativePaths: existing.paths,
        existingSources: existing.sources,
        aliases: existing.aliases,
        architecture,
      });
    };

    const render = async (error?: string): Promise<void> => {
      let plan: SrijikaOwnershipCreationPlan | undefined;
      const existing = await existingOwnershipState(workspaceFolder);
      const hasPreviewableSelection =
        (selectedMode === 'ownerFiles' && selectedOwnerActions.length > 0) ||
        ((selectedMode === 'ownerExpansion' || selectedMode === 'childOwner') && Boolean(name));
      if (error === undefined && hasPreviewableSelection) {
        try {
          plan = buildSelectedPlan(existing);
        } catch (planError) {
          error = planError instanceof Error ? planError.message : String(planError);
        }
      }
      panel.webview.html = renderSrijikaCreationWebview({
        owner,
        ownerLabel: ownerDisplayName(owner),
        ownerFiles: ownerFilesFor(existing),
        childActions,
        expansionActions,
        selectedMode,
        selectedOwnerActions,
        ...(selectedChildAction ? { selectedChildAction } : {}),
        ...(selectedExpansionAction ? { selectedExpansionAction } : {}),
        name,
        optionalCapabilities,
        ...(plan ? { plan } : {}),
        ...(error ? { error } : {}),
        nonce: randomBytes(16).toString('base64url'),
      });
    };

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      const candidate = message as Record<string, unknown>;
      if (candidate['type'] === 'cancel') {
        panel.dispose();
        return;
      }
      if (
        candidate['type'] !== 'changeMode' &&
        candidate['type'] !== 'changeOwnerSelection' &&
        candidate['type'] !== 'preview' &&
        candidate['type'] !== 'create'
      )
        return;
      if (
        candidate['mode'] !== 'ownerFiles' &&
        candidate['mode'] !== 'ownerExpansion' &&
        candidate['mode'] !== 'childOwner'
      ) {
        await render('Choose owner files, a private behavior, or a new child owner.');
        return;
      }
      selectedMode = candidate['mode'];
      const expansionActionSet = new Set<SrijikaStructureCreationAction>(
        expansionActions.map(({ action }) => action),
      );
      if (
        typeof candidate['action'] === 'string' &&
        expansionActionSet.has(candidate['action'] as SrijikaStructureCreationAction)
      ) {
        selectedExpansionAction = candidate['action'] as typeof selectedExpansionAction;
      }
      const childActionSet = new Set<SrijikaStructureCreationAction>(
        childActions.map(({ action }) => action),
      );
      if (
        typeof candidate['action'] === 'string' &&
        childActionSet.has(candidate['action'] as SrijikaStructureCreationAction)
      ) {
        selectedChildAction = candidate['action'] as typeof selectedChildAction;
      }
      const missingOwnerActionSet = new Set<SrijikaStructureCreationAction>(missingOwnerActions);
      selectedOwnerActions = Array.isArray(candidate['ownerActions'])
        ? candidate['ownerActions'].filter(
            (value): value is SrijikaStructureCreationAction =>
              typeof value === 'string' &&
              missingOwnerActionSet.has(value as SrijikaStructureCreationAction),
          )
        : [];
      name = typeof candidate['name'] === 'string' ? candidate['name'].trim() : '';
      const allowedCapabilities = new Set<SrijikaOptionalOwnerCapability>([
        'hook',
        'store',
        'logic',
        'api',
        'types',
      ]);
      optionalCapabilities = Array.isArray(candidate['optionalCapabilities'])
        ? candidate['optionalCapabilities'].filter(
            (value): value is SrijikaOptionalOwnerCapability =>
              typeof value === 'string' &&
              allowedCapabilities.has(value as SrijikaOptionalOwnerCapability),
          )
        : [];
      if (candidate['type'] === 'preview') {
        const requestId = candidate['requestId'];
        if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 1) {
          return;
        }
        try {
          const existing = await existingOwnershipState(workspaceFolder);
          const plan = buildSelectedPlan(existing);
          await panel.webview.postMessage({
            type: 'previewResult',
            requestId,
            previewFiles: srijikaOwnershipPlanPreviewPaths(plan),
          });
        } catch (previewError) {
          await panel.webview.postMessage({
            type: 'previewResult',
            requestId,
            previewFiles: [],
            error: previewError instanceof Error ? previewError.message : String(previewError),
          });
        }
        return;
      }
      if (candidate['type'] === 'changeMode' || candidate['type'] === 'changeOwnerSelection') {
        await render();
        return;
      }
      if (creating) return;
      creating = true;

      try {
        const existing = await existingOwnershipState(workspaceFolder);
        const plan = buildSelectedPlan(existing);
        await commitOwnershipPlan(workspaceFolder, plan);
        panel.dispose();
        void vscode.window.showInformationMessage(
          `Srijika created ${plan.files.length} validated file${plan.files.length === 1 ? '' : 's'}${(plan.moves?.length ?? 0) > 0 ? `, organized ${plan.moves?.length ?? 0} gateway` : ''}${plan.updates.length > 0 ? `, and safely rewired ${plan.updates.length} senior file${plan.updates.length === 1 ? '' : 's'}` : ''} for ${plan.ownerName}.`,
        );
      } catch (creationError) {
        creating = false;
        await render(
          creationError instanceof Error ? creationError.message : String(creationError),
        );
      }
    });
    await render();
  };

  const addOwnershipCapability = vscode.commands.registerCommand(
    'srijika.addOwnershipCapability',
    async (target?: vscode.Uri | SrijikaStructureTreeItem) => {
      if (!target) {
        void vscode.window.showInformationMessage(
          'Use the + button in the Srijika Structure sidebar or right-click an ownership folder in Explorer.',
        );
        return;
      }
      try {
        await openOwnershipCreator(target);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika did not create files: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  const refreshStructure = vscode.commands.registerCommand('srijika.refreshStructure', () => {
    structureProvider.refresh();
  });
  const runApp = vscode.commands.registerCommand(
    'srijika.runApp',
    async (resource?: vscode.Uri) => {
      try {
        await runtimeController.execute('dev', resource);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika could not start the app: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
  const stopApp = vscode.commands.registerCommand('srijika.stopApp', async () => {
    await runtimeController.stop();
  });
  const installDependencies = vscode.commands.registerCommand(
    'srijika.installDependencies',
    async (resource?: vscode.Uri) => {
      try {
        await runtimeController.execute('install', resource);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika install failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
  const runDoctor = vscode.commands.registerCommand(
    'srijika.doctor',
    async (resource?: vscode.Uri) => {
      try {
        await runtimeController.doctor(resource);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika Doctor failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
  const syncOwnerTests = vscode.commands.registerCommand(
    'srijika.syncOwnerTests',
    async (resource?: vscode.Uri) => {
      try {
        const summary = await testingController.synchronize(resource);
        structureProvider.refresh();
        void vscode.window.showInformationMessage(
          `Srijika synchronized ${summary.artifacts} owner-test artifact(s): ${summary.created} created, ${summary.updated} updated.`,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika could not synchronize owner tests: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
  const showTestEvidence = vscode.commands.registerCommand(
    'srijika.showTestEvidence',
    async (resource?: vscode.Uri) => {
      try {
        const result = await testingController.showEvidence(resource);
        const message = `Srijika test evidence: ${result.manifest.status} (${result.manifest.owners.length} owner(s)).`;
        if (result.manifest.status === 'passed') void vscode.window.showInformationMessage(message);
        else void vscode.window.showWarningMessage(message);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika could not collect test evidence: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
  const verifyOwnerTests = vscode.commands.registerCommand(
    'srijika.verifyOwnerTests',
    async (resource?: vscode.Uri) => {
      try {
        const result = await testingController.verify(resource);
        const message = `Srijika owner verification: ${result.status} (${result.evidence.manifest.owners.length} owner(s)).`;
        if (result.status === 'passed') void vscode.window.showInformationMessage(message);
        else void vscode.window.showWarningMessage(message);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Srijika owner verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  const completions = vscode.languages.registerCompletionItemProvider(
    { language: 'typescriptreact', pattern: '**/*.tsx' },
    {
      async provideCompletionItems(document, position) {
        if (!isConfiguredSrijikaUiDocument(document)) return [];
        const source = document.getText();
        const compilation = compilationFor(document);
        const cssClassNames = await workspaceCssClassNames();
        const models = srijikaJsxCompletions(
          source,
          document.offsetAt(position),
          compilation?.componentContract ?? [],
          cssClassNames,
        );
        return models.map((model) => {
          const item = new vscode.CompletionItem(
            model.label,
            model.kind === 'event'
              ? vscode.CompletionItemKind.Event
              : model.kind === 'tag'
                ? vscode.CompletionItemKind.Class
                : model.kind === 'css-class'
                  ? vscode.CompletionItemKind.Color
                  : vscode.CompletionItemKind.Property,
          );
          item.filterText = model.filterText;
          item.insertText = new vscode.SnippetString(model.insertText);
          item.detail = model.detail;
          item.documentation = new vscode.MarkdownString(model.documentation);
          if (model.replacementStart !== undefined) {
            item.range = new vscode.Range(document.positionAt(model.replacementStart), position);
          }
          item.sortText =
            model.kind === 'event'
              ? `0-${model.filterText}`
              : model.kind === 'tag'
                ? `0-${model.filterText}`
                : `1-${model.filterText}`;
          return item;
        });
      },
    },
    ' ',
    '<',
    '=',
    '"',
    "'",
  );

  const codeActions = vscode.languages.registerCodeActionsProvider(
    { language: 'typescriptreact', pattern: '**/*.tsx' },
    {
      provideCodeActions(document, _range, actionContext) {
        if (!isConfiguredSrijikaUiDocument(document)) return [];
        const compilation = compilationFor(document);
        if (!compilation) return [];

        const source = document.getText();
        const resolvePosition = positionResolverFor(document);
        const actions: vscode.CodeAction[] = [];

        for (const compilerDiagnostic of compilation.diagnostics) {
          if (!compilerDiagnostic.quickFixes?.length) continue;
          const diagnosticModel = diagnosticToEditorDiagnostic(
            source,
            compilerDiagnostic,
            resolvePosition,
          );
          const matchingDiagnostic = actionContext.diagnostics.find(
            (diagnostic) =>
              diagnostic.source === DIAGNOSTIC_SOURCE &&
              diagnostic.code === compilerDiagnostic.code &&
              rangesMatch(diagnostic.range, diagnosticModel.range),
          );
          if (!matchingDiagnostic) continue;

          for (const quickFix of diagnosticModel.quickFixes) {
            if (quickFix.edits.length === 0) continue;
            const action = new vscode.CodeAction(quickFix.title, vscode.CodeActionKind.QuickFix);
            const edit = new vscode.WorkspaceEdit();
            for (const textEdit of quickFix.edits) {
              edit.replace(document.uri, toVscodeRange(textEdit.range), textEdit.newText);
            }
            action.edit = edit;
            action.diagnostics = [matchingDiagnostic];
            action.isPreferred = quickFix.kind === 'add-missing-prop';
            actions.push(action);
          }
        }

        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );

  const architectureCodeActions = vscode.languages.registerCodeActionsProvider(
    [
      { language: 'typescript', pattern: '**/*.{ts,mts,cts}' },
      { language: 'typescriptreact', pattern: '**/*.tsx' },
      { language: 'javascript', pattern: '**/*.{js,mjs,cjs}' },
      { language: 'javascriptreact', pattern: '**/*.jsx' },
    ],
    {
      provideCodeActions(_document, _range, actionContext) {
        return actionContext.diagnostics
          .filter(
            (diagnostic) =>
              diagnostic.source === ARCHITECTURE_DIAGNOSTIC_SOURCE &&
              typeof diagnostic.code === 'string' &&
              diagnostic.code.startsWith('SRIJIKA4'),
          )
          .map((diagnostic) => {
            const action = new vscode.CodeAction(
              'Open the Srijika ownership and promotion guide',
              vscode.CodeActionKind.QuickFix,
            );
            action.command = {
              command: 'srijika.showSetup',
              title: 'Open Srijika guide',
            };
            action.diagnostics = [diagnostic];
            return action;
          });
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );

  const architectureConfigWatcher =
    vscode.workspace.createFileSystemWatcher('**/srijika.config.json');
  const typeScriptConfigWatcher = vscode.workspace.createFileSystemWatcher('**/tsconfig.json');
  let architectureSourceWatcherSubscriptions: vscode.Disposable[] = [];
  let architectureWatcherRefreshRun = 0;
  const disposeArchitectureSourceWatchers = (): void => {
    for (const disposable of architectureSourceWatcherSubscriptions) disposable.dispose();
    architectureSourceWatcherSubscriptions = [];
  };
  const refreshArchitectureSourceWatchers = async (): Promise<void> => {
    const run = ++architectureWatcherRefreshRun;
    const next: vscode.Disposable[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      let projectConfig;
      try {
        const fileSystem = await openSafeSrijikaWorkspace(folder.uri.fsPath);
        const config = await fileSystem.readText(
          'srijika.config.json',
          MAX_ARCHITECTURE_CONFIG_BYTES,
        );
        projectConfig = parseSrijikaCodeProjectConfig(config.source);
      } catch {
        continue;
      }
      for (const pattern of srijikaArchitectureWatchPatterns(
        projectConfig.architecture,
        projectConfig.entry,
      )) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, pattern),
        );
        next.push(
          watcher,
          watcher.onDidCreate(() => {
            structureProvider.refresh();
            scheduleArchitectureCheck(0);
          }),
          watcher.onDidChange(() => scheduleArchitectureCheck()),
          watcher.onDidDelete(() => {
            structureProvider.refresh();
            scheduleArchitectureCheck(0);
          }),
        );
      }
    }
    if (run !== architectureWatcherRefreshRun) {
      for (const disposable of next) disposable.dispose();
      return;
    }
    disposeArchitectureSourceWatchers();
    architectureSourceWatcherSubscriptions = next;
    for (const document of vscode.workspace.textDocuments) compileDocument(document);
  };
  const onArchitectureConfigChanged = (): void => {
    structureProvider.refresh();
    scheduleArchitectureCheck(0);
    void refreshArchitectureSourceWatchers();
  };
  const watcherSubscriptions = [
    architectureConfigWatcher.onDidCreate(onArchitectureConfigChanged),
    architectureConfigWatcher.onDidChange(onArchitectureConfigChanged),
    architectureConfigWatcher.onDidDelete(onArchitectureConfigChanged),
    typeScriptConfigWatcher.onDidCreate(onArchitectureConfigChanged),
    typeScriptConfigWatcher.onDidChange(onArchitectureConfigChanged),
    typeScriptConfigWatcher.onDidDelete(onArchitectureConfigChanged),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      structureProvider.refresh();
      scheduleArchitectureCheck(0);
      void refreshArchitectureSourceWatchers();
    }),
  ];
  void refreshArchitectureSourceWatchers();

  const openSubscription = vscode.workspace.onDidOpenTextDocument(compileDocument);
  const changeSubscription = vscode.workspace.onDidChangeTextDocument(({ document }) => {
    if (document.fileName.toLowerCase().endsWith('.css')) cssClassNamesPromise = null;
    compileDocument(document);
    if (
      /\.(?:[cm]?[jt]s|[jt]sx)$/.test(document.fileName) ||
      document.fileName.endsWith('srijika.config.json') ||
      document.fileName.endsWith('tsconfig.json')
    ) {
      scheduleArchitectureCheck();
    }
  });
  const saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.toLowerCase().endsWith('.css')) cssClassNamesPromise = null;
    compileDocument(document);
    if (
      /\.(?:[cm]?[jt]s|[jt]sx)$/.test(document.fileName) ||
      document.fileName.endsWith('srijika.config.json') ||
      document.fileName.endsWith('tsconfig.json')
    ) {
      scheduleArchitectureCheck(0);
    }
  });
  const closeSubscription = vscode.workspace.onDidCloseTextDocument((document) => {
    collection.delete(document.uri);
    compilations.delete(document.uri.toString());
  });

  for (const document of vscode.workspace.textDocuments) compileDocument(document);
  scheduleArchitectureCheck(0);

  context.subscriptions.push(
    collection,
    architectureCollection,
    output,
    structureProvider,
    structureView,
    migrationView,
    checkCurrentFile,
    checkArchitecture,
    showSetup,
    importExistingReactProject,
    addOwnershipCapability,
    refreshStructure,
    runApp,
    stopApp,
    installDependencies,
    runDoctor,
    syncOwnerTests,
    showTestEvidence,
    verifyOwnerTests,
    runtimeController,
    completions,
    codeActions,
    architectureCodeActions,
    architectureConfigWatcher,
    typeScriptConfigWatcher,
    ...watcherSubscriptions,
    openSubscription,
    changeSubscription,
    saveSubscription,
    closeSubscription,
    {
      dispose() {
        architectureRun += 1;
        architectureWatcherRefreshRun += 1;
        disposeArchitectureSourceWatchers();
        if (architectureTimer) clearTimeout(architectureTimer);
      },
    },
  );
}

export function deactivate(): void {}
