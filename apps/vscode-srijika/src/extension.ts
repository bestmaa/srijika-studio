import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import {
  resolveSrijikaStructureOwner,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';
import type { SrijikaComponentContractEntry, SrijikaDiagnostic } from '@srijika/tsx-compiler';

import {
  architectureDiagnosticToEditorDiagnostic,
  parseSrijikaArchitectureConfig,
  validateArchitectureWorkspace,
} from './architecture-adapter';
import {
  selectArchitectureScanBudget,
  SRIJIKA_ARCHITECTURE_SCAN_LIMITS,
} from './architecture-scan-budget';
import { compileUiSource } from './compiler-adapter';
import { extractCssClassNames, srijikaJsxCompletions } from './completion-model';
import { SRIJIKA_CREATION_ACTION_LABELS } from './creation-presentation';
import {
  renderSrijikaCreationWebview,
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
import { SrijikaStructureTreeItem, SrijikaStructureTreeProvider } from './structure-view';
import { SrijikaRuntimeController } from './runtime-controller';

const DIAGNOSTIC_SOURCE = 'Srijika';
const ARCHITECTURE_DIAGNOSTIC_SOURCE = 'Srijika Architecture';
const UI_FILE_SUFFIX = '.ui.tsx';
const MAX_ARCHITECTURE_CONFIG_BYTES = 64 * 1024;

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

function isSrijikaUiDocument(document: vscode.TextDocument): boolean {
  return (
    document.languageId === 'typescriptreact' &&
    document.fileName.toLowerCase().endsWith(UI_FILE_SUFFIX)
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

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('srijika');
  const architectureCollection =
    vscode.languages.createDiagnosticCollection('srijika-architecture');
  const output = vscode.window.createOutputChannel('Srijika');
  const runtimeController = new SrijikaRuntimeController(output);
  const compilations = new Map<string, CachedCompilation>();
  let cssClassNamesPromise: Promise<readonly string[]> | null = null;
  let architectureTimer: NodeJS.Timeout | undefined;
  let architectureRun = 0;
  const structureProvider = new SrijikaStructureTreeProvider();
  const structureView = vscode.window.createTreeView('srijika.structure', {
    treeDataProvider: structureProvider,
    showCollapseAll: true,
  });

  const runArchitectureCheck = async (run: number, showSummary = false): Promise<void> => {
    if (run !== architectureRun) return;
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const nextDiagnostics = new Map<
      string,
      { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }
    >();
    const statusLines: string[] = [];
    const textDecoder = new TextDecoder();
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
      const configUri = vscode.Uri.joinPath(folder.uri, 'srijika.config.json');
      let architecture;
      try {
        const configStat = await vscode.workspace.fs.stat(configUri);
        if (run !== architectureRun) return;
        if (configStat.size > MAX_ARCHITECTURE_CONFIG_BYTES) {
          skippedWorkspaces += 1;
          statusLines.push(
            `${folder.name}: architecture check skipped because srijika.config.json exceeds 64 KiB.`,
          );
          continue;
        }
        const configBytes = await vscode.workspace.fs.readFile(configUri);
        if (run !== architectureRun) return;
        if (configBytes.byteLength > MAX_ARCHITECTURE_CONFIG_BYTES) {
          skippedWorkspaces += 1;
          statusLines.push(
            `${folder.name}: architecture check skipped because srijika.config.json exceeds 64 KiB.`,
          );
          continue;
        }
        architecture = parseSrijikaArchitectureConfig(textDecoder.decode(configBytes));
      } catch {
        skippedWorkspaces += 1;
        statusLines.push(
          `${folder.name}: architecture check skipped; no readable srijika.config.json was found.`,
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
      configuredWorkspaces += 1;

      let uris: readonly vscode.Uri[];
      try {
        uris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, 'src/**/*.{ts,tsx,mts,cts}'),
          new vscode.RelativePattern(folder, '**/{node_modules,dist,build,.git,.srijika}/**'),
          SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxFiles + 1,
        );
      } catch {
        skippedWorkspaces += 1;
        configuredWorkspaces -= 1;
        statusLines.push(
          `${folder.name}: architecture check skipped; source files could not be listed.`,
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
          const stat = await vscode.workspace.fs.stat(uri);
          if (run !== architectureRun) return;
          candidates.push({
            value: { uri, document: undefined, source: undefined },
            byteLength: stat.size,
          });
        } catch {
          skippedUnreadable += 1;
        }
      }

      const budget = selectArchitectureScanBudget(candidates);
      skippedByFileLimit += budget.skippedByFileLimit;
      skippedOversized += budget.skippedOversized;
      skippedByTotalLimit += budget.skippedByTotalLimit;
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
            const bytes = await vscode.workspace.fs.readFile(candidate.value.uri);
            if (run !== architectureRun) return;
            byteLength = bytes.byteLength;
            source = textDecoder.decode(bytes);
          }
          if (byteLength > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxBytesPerFile) {
            skippedOversized += 1;
            continue;
          }
          if (actualWorkspaceBytes + byteLength > SRIJIKA_ARCHITECTURE_SCAN_LIMITS.maxTotalBytes) {
            skippedByTotalLimit += 1;
            continue;
          }
          actualWorkspaceBytes += byteLength;
          files.push({
            fileName: candidate.value.uri.fsPath,
            source,
            uri: candidate.value.uri,
            document: candidate.value.document,
          });
        } catch {
          skippedUnreadable += 1;
        }
      }
      checkedFiles += files.length;

      const diagnostics = validateArchitectureWorkspace({
        projectRoot: folder.uri.fsPath,
        files,
        architecture,
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
    }

    if (run !== architectureRun) return;
    architectureCollection.clear();
    for (const { uri, diagnostics } of nextDiagnostics.values()) {
      architectureCollection.set(uri, diagnostics);
    }
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
      if (configuredWorkspaces === 0) {
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
    if (!isSrijikaUiDocument(document)) return undefined;

    try {
      const source = document.getText();
      const result = compileUiSource({ fileName: document.fileName, source });
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
    if (!document || !isSrijikaUiDocument(document)) {
      void vscode.window.showWarningMessage('Open a *.ui.tsx file to run Srijika validation.');
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

  const resolveCreationTarget = (
    target: vscode.Uri | SrijikaStructureTreeItem,
  ): {
    resource: vscode.Uri;
    workspaceFolder: vscode.WorkspaceFolder;
    owner: SrijikaStructureOwnerContext;
  } => {
    const resource =
      target instanceof SrijikaStructureTreeItem
        ? vscode.Uri.joinPath(
            target.workspaceFolder.uri,
            ...target.structureOwner.relativeFolder.split('/'),
          )
        : target;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
    if (!workspaceFolder) throw new Error('Select a folder inside an open workspace.');
    const relativeFolder = vscode.workspace
      .asRelativePath(resource, false)
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '');
    const owner = resolveSrijikaStructureOwner(relativeFolder);
    if (!owner) {
      throw new Error(
        'Creation is allowed only at src/features, a Feature root, a Slot root, or a Part root.',
      );
    }
    return { resource, workspaceFolder, owner };
  };

  interface ExistingOwnershipState {
    paths: readonly string[];
    sources: Readonly<Record<string, string>>;
  }

  const existingOwnershipState = async (
    workspaceFolder: vscode.WorkspaceFolder,
    owner: SrijikaStructureOwnerContext,
  ): Promise<ExistingOwnershipState> => {
    const sourceUris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, '**/*.{ts,tsx,mts,cts}'),
      '**/{node_modules,dist,build,target,.git}/**',
      20_000,
    );
    const paths = sourceUris.map((uri) =>
      vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/'),
    );
    const ownerPrefix = `${owner.folder}/`;
    const directOwnerFiles = sourceUris
      .map((uri, index) => ({ uri, relativePath: paths[index] ?? '' }))
      .filter(
        ({ relativePath }) =>
          relativePath.startsWith(ownerPrefix) &&
          !relativePath.slice(ownerPrefix.length).includes('/'),
      );
    const sources: Record<string, string> = {};
    for (const { uri, relativePath } of directOwnerFiles) {
      sources[relativePath] = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    }
    return { paths, sources };
  };

  const commitOwnershipPlan = async (
    workspaceFolder: vscode.WorkspaceFolder,
    plan: SrijikaOwnershipCreationPlan,
  ): Promise<void> => {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(workspaceFolder.uri, ...plan.ownerFolder.split('/')),
    );
    const edit = new vscode.WorkspaceEdit();
    const updateDocuments = new Map<string, vscode.TextDocument>();
    for (const file of plan.files) {
      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, ...file.relativePath.split('/'));
      edit.createFile(fileUri, { overwrite: false, ignoreIfExists: false });
      edit.insert(fileUri, new vscode.Position(0, 0), file.source);
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
      [...plan.files, ...plan.updates].map(({ relativePath }) => relativePath),
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
    }
  };

  const openOwnershipCreator = async (
    target: vscode.Uri | SrijikaStructureTreeItem,
  ): Promise<void> => {
    const { workspaceFolder, owner } = resolveCreationTarget(target);
    const existingAtOpen = await existingOwnershipState(workspaceFolder, owner);
    const allowedActions = availableSrijikaOwnershipCreationActions(
      owner,
      existingAtOpen.paths,
      existingAtOpen.sources,
    );
    const isChildAction = (
      action: SrijikaStructureCreationAction,
    ): action is 'feature' | 'slot' | 'part' =>
      action === 'feature' || action === 'slot' || action === 'part';
    const missingOwnerActions = allowedActions.filter((action) => !isChildAction(action));
    const childActions = allowedActions.filter(isChildAction).map((action) => ({
      action,
      ...SRIJIKA_CREATION_ACTION_LABELS[action],
    }));
    const ownerFilesFor = (existing: ExistingOwnershipState): SrijikaOwnerFilePresentation[] =>
      owner.level === 'featuresRoot'
        ? []
        : srijikaOwnershipFileStatuses(owner, existing.paths).map((status) => ({
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
    const selectedChildAction = childActions[0]?.action;
    let selectedMode: SrijikaCreationMode =
      owner.level === 'featuresRoot'
        ? 'childOwner'
        : missingOwnerActions.length > 0
          ? 'ownerFiles'
          : selectedChildAction
            ? 'childOwner'
            : 'ownerFiles';
    let selectedOwnerActions: readonly SrijikaStructureCreationAction[] = [];
    let name = '';
    let optionalCapabilities: readonly SrijikaOptionalOwnerCapability[] = [];
    let creating = false;

    const render = async (error?: string): Promise<void> => {
      let plan: SrijikaOwnershipCreationPlan | undefined;
      const existing = await existingOwnershipState(workspaceFolder, owner);
      if (error === undefined && selectedMode === 'ownerFiles' && selectedOwnerActions.length > 0) {
        try {
          if (owner.level === 'featuresRoot') {
            throw new Error('Features root does not own runtime capability files.');
          }
          plan = buildSrijikaOwnershipCapabilityBatchPlan({
            owner,
            actions: selectedOwnerActions,
            existingRelativePaths: existing.paths,
            existingSources: existing.sources,
          });
        } catch (planError) {
          error = planError instanceof Error ? planError.message : String(planError);
        }
      }
      panel.webview.html = renderSrijikaCreationWebview({
        owner,
        ownerLabel: ownerDisplayName(owner),
        ownerFiles: ownerFilesFor(existing),
        childActions,
        selectedMode,
        selectedOwnerActions,
        ...(selectedChildAction ? { selectedChildAction } : {}),
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
        candidate['type'] !== 'create'
      )
        return;
      if (candidate['mode'] !== 'ownerFiles' && candidate['mode'] !== 'childOwner') {
        await render('Choose either this owner files or its new child owner.');
        return;
      }
      selectedMode = candidate['mode'];
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
      if (candidate['type'] === 'changeMode' || candidate['type'] === 'changeOwnerSelection') {
        await render();
        return;
      }
      if (creating) return;
      creating = true;

      try {
        const existing = await existingOwnershipState(workspaceFolder, owner);
        const plan =
          selectedMode === 'ownerFiles'
            ? owner.level === 'featuresRoot'
              ? (() => {
                  throw new Error('Features root does not own runtime capability files.');
                })()
              : buildSrijikaOwnershipCapabilityBatchPlan({
                  owner,
                  actions: selectedOwnerActions,
                  existingRelativePaths: existing.paths,
                  existingSources: existing.sources,
                })
            : selectedChildAction
              ? buildSrijikaOwnershipCreationPlan({
                  owner,
                  action: selectedChildAction,
                  ...(name ? { name } : {}),
                  optionalCapabilities,
                  existingRelativePaths: existing.paths,
                  existingSources: existing.sources,
                })
              : (() => {
                  throw new Error('No child owner is valid at this boundary.');
                })();
        await commitOwnershipPlan(workspaceFolder, plan);
        panel.dispose();
        void vscode.window.showInformationMessage(
          `Srijika created ${plan.files.length} validated file${plan.files.length === 1 ? '' : 's'}${plan.updates.length > 0 ? ` and safely rewired ${plan.updates.length} senior file${plan.updates.length === 1 ? '' : 's'}` : ''} for ${plan.ownerName}.`,
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

  const completions = vscode.languages.registerCompletionItemProvider(
    { language: 'typescriptreact', pattern: `**/*${UI_FILE_SUFFIX}` },
    {
      async provideCompletionItems(document, position) {
        if (!isSrijikaUiDocument(document)) return [];
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
    { language: 'typescriptreact', pattern: `**/*${UI_FILE_SUFFIX}` },
    {
      provideCodeActions(document, _range, actionContext) {
        if (!isSrijikaUiDocument(document)) return [];
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

  const architectureSourceWatcher = vscode.workspace.createFileSystemWatcher(
    '**/src/**/*.{ts,tsx,mts,cts}',
  );
  const architectureConfigWatcher =
    vscode.workspace.createFileSystemWatcher('**/srijika.config.json');
  const watcherSubscriptions = [
    architectureSourceWatcher.onDidCreate(() => {
      structureProvider.refresh();
      scheduleArchitectureCheck(0);
    }),
    architectureSourceWatcher.onDidChange(() => scheduleArchitectureCheck()),
    architectureSourceWatcher.onDidDelete(() => {
      structureProvider.refresh();
      scheduleArchitectureCheck(0);
    }),
    architectureConfigWatcher.onDidCreate(() => scheduleArchitectureCheck(0)),
    architectureConfigWatcher.onDidChange(() => scheduleArchitectureCheck(0)),
    architectureConfigWatcher.onDidDelete(() => scheduleArchitectureCheck(0)),
  ];

  const openSubscription = vscode.workspace.onDidOpenTextDocument(compileDocument);
  const changeSubscription = vscode.workspace.onDidChangeTextDocument(({ document }) => {
    if (document.fileName.toLowerCase().endsWith('.css')) cssClassNamesPromise = null;
    compileDocument(document);
    if (
      /\.(?:ts|tsx|mts|cts)$/.test(document.fileName) ||
      document.fileName.endsWith('srijika.config.json')
    ) {
      scheduleArchitectureCheck();
    }
  });
  const saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.toLowerCase().endsWith('.css')) cssClassNamesPromise = null;
    compileDocument(document);
    if (
      /\.(?:ts|tsx|mts|cts)$/.test(document.fileName) ||
      document.fileName.endsWith('srijika.config.json')
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
    checkCurrentFile,
    checkArchitecture,
    showSetup,
    addOwnershipCapability,
    refreshStructure,
    runApp,
    stopApp,
    installDependencies,
    runDoctor,
    runtimeController,
    completions,
    codeActions,
    architectureCodeActions,
    architectureSourceWatcher,
    architectureConfigWatcher,
    ...watcherSubscriptions,
    openSubscription,
    changeSubscription,
    saveSubscription,
    closeSubscription,
    {
      dispose() {
        architectureRun += 1;
        if (architectureTimer) clearTimeout(architectureTimer);
      },
    },
  );
}

export function deactivate(): void {}
