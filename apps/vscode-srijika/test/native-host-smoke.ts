import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as vscode from 'vscode';

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function findings(uri: vscode.Uri): readonly vscode.Diagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source?.startsWith('Srijika'));
}

/** Runs in the real VS Code Extension Development Host, not under Vitest. */
export async function run(): Promise<void> {
  const folder = (name: string): vscode.WorkspaceFolder => {
    const selected = vscode.workspace.workspaceFolders?.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(selected, `Missing ${name} fixture workspace`);
    return selected;
  };
  const extension = vscode.extensions.getExtension('srijika.srijika-language-support');
  assert.ok(extension, 'Srijika extension is not installed in the development host');
  await extension.activate();
  const nativeRoot = folder('native').uri;
  const uiUri = vscode.Uri.joinPath(nativeRoot, 'src/features/home/Home.ui.tsx');
  const document = await vscode.workspace.openTextDocument(uiUri);
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('srijika.checkArchitecture');
  await vscode.commands.executeCommand('srijika.checkCurrentFile');
  assert.equal(findings(uiUri).length, 0, 'Valid Native source has Srijika errors');
  const original = document.getText();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uiUri,
    new vscode.Range(document.positionAt(0), document.positionAt(original.length)),
    original.replace('onChangeText=', 'onClick='),
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await waitFor(
    () =>
      findings(uiUri).some(
        (diagnostic) =>
          diagnostic.source === 'Srijika Native' && diagnostic.code === 'SRIJIKA-NATIVE1002',
      ),
    'unsaved Native diagnostic',
  );
  assert.equal(
    findings(uiUri).some((diagnostic) => diagnostic.source === 'Srijika'),
    false,
    'Web compiler diagnosed Native source',
  );
  const restore = new vscode.WorkspaceEdit();
  restore.replace(
    uiUri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    original,
  );
  assert.equal(await vscode.workspace.applyEdit(restore), true);
  await waitFor(() => findings(uiUri).length === 0, 'Native diagnostics recovery');
  await vscode.commands.executeCommand('srijika.openProjectArchitecture');
  await waitFor(
    () =>
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.some(
          (tab) => tab.label.includes('Structure Graph') && tab.label.includes('host-native'),
        ),
      ),
    'Native Structure Graph tab',
  );

  const logicUri = vscode.Uri.joinPath(nativeRoot, 'src/features/home/home.logic.ts');
  const pureLogic = 'export function greeting() { return "hello"; }\n';
  await vscode.workspace.fs.writeFile(logicUri, Buffer.from(pureLogic));
  const logic = await vscode.workspace.openTextDocument(logicUri);
  const logicEdit = new vscode.WorkspaceEdit();
  logicEdit.replace(
    logicUri,
    new vscode.Range(logic.positionAt(0), logic.positionAt(logic.getText().length)),
    "import { Platform } from 'react-native'; export function greeting() { return Platform.OS; }\n",
  );
  assert.equal(await vscode.workspace.applyEdit(logicEdit), true);
  await vscode.commands.executeCommand('srijika.checkArchitecture');
  await waitFor(
    () => findings(logicUri).some((diagnostic) => diagnostic.code === 'SRIJIKA-NATIVE2001'),
    'unsaved Native Logic diagnostic',
  );
  const restoreLogic = new vscode.WorkspaceEdit();
  restoreLogic.replace(
    logicUri,
    new vscode.Range(logic.positionAt(0), logic.positionAt(logic.getText().length)),
    pureLogic,
  );
  assert.equal(await vscode.workspace.applyEdit(restoreLogic), true);
  await vscode.commands.executeCommand('srijika.checkArchitecture');
  await waitFor(() => findings(logicUri).length === 0, 'Native Logic recovery');

  const marker = vscode.Uri.joinPath(nativeRoot, 'srijika.native.json');
  const markerBytes = await vscode.workspace.fs.readFile(marker);
  await vscode.workspace.fs.writeFile(marker, Buffer.from('{"version":2}'));
  await vscode.commands.executeCommand('srijika.refreshStructure');
  await vscode.commands.executeCommand('srijika.checkArchitecture');
  await waitFor(
    () => findings(marker).some((diagnostic) => diagnostic.code === 'SRIJIKA-NATIVE0001'),
    'Native profile failure',
  );
  assert.equal(
    findings(uiUri).some((diagnostic) => diagnostic.source === 'Srijika'),
    false,
    'Invalid Native profile fell back to web compiler',
  );
  await vscode.workspace.fs.writeFile(marker, markerBytes);
  await vscode.commands.executeCommand('srijika.refreshStructure');
  await vscode.commands.executeCommand('srijika.checkArchitecture');

  const webUri = vscode.Uri.joinPath(folder('web').uri, 'src/features/home/Home.ui.tsx');
  const webDocument = await vscode.workspace.openTextDocument(webUri);
  await vscode.window.showTextDocument(webDocument);
  await vscode.commands.executeCommand('srijika.checkCurrentFile');
  assert.equal(findings(webUri).length, 0, 'React source regressed');
  const nextUri = vscode.Uri.joinPath(folder('next').uri, 'app/page.tsx');
  const nextDocument = await vscode.workspace.openTextDocument(nextUri);
  await vscode.window.showTextDocument(nextDocument);
  await vscode.commands.executeCommand('srijika.checkCurrentFile');
  assert.ok(
    findings(nextUri).some((diagnostic) => diagnostic.code === 'SRIJIKA5004'),
    'Next server/client boundary diagnostics regressed',
  );
  assert.equal(
    findings(nextUri).some((diagnostic) => diagnostic.source === 'Srijika Native'),
    false,
  );

  const report = {
    status: 'passed',
    checks: [
      'Native detection',
      'unsaved Native diagnostics',
      'Native recovery',
      'Native graph command',
      'unsaved Native Logic diagnostics',
      'invalid Native profile isolation',
      'React compiler',
      'Next server boundary',
    ],
  };
  const reportPath =
    process.env['SRIJIKA_NATIVE_HOST_REPORT'] ?? join(nativeRoot.fsPath, '..', 'host-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
