/** Minimal editor API double for Native language-controller lifecycle tests. */
export class Uri {
  constructor(readonly fsPath: string) {}
  static file(path: string): Uri {
    return new Uri(path);
  }
  toString(): string {
    return `file://${this.fsPath}`;
  }
}
export class Range {
  readonly start: { line: number; character: number };
  readonly end: { line: number; character: number };
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}
export class Diagnostic {
  code?: string;
  source?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number,
  ) {}
}
export const DiagnosticSeverity = { Error: 0, Warning: 1 };
export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string,
  ) {}
}
export const editorState = {
  folders: [] as { name: string; uri: Uri; index: number }[],
  documents: [] as {
    fileName: string;
    uri: Uri;
    languageId: string;
    getText: () => string;
    positionAt: (offset: number) => { line: number; character: number };
  }[],
  configUris: [] as Uri[],
  markerUris: [] as Uri[],
  collections: new Map<string, Map<string, readonly Diagnostic[]>>(),
  messages: [] as string[],
};
export const workspace = {
  get workspaceFolders() {
    return editorState.folders;
  },
  get textDocuments() {
    return editorState.documents;
  },
  findFiles(pattern: RelativePattern): Promise<Uri[]> {
    return Promise.resolve(
      pattern.pattern.includes('srijika.native') ? editorState.markerUris : editorState.configUris,
    );
  },
  createFileSystemWatcher() {
    return {
      dispose() {},
      onDidCreate() {
        return { dispose() {} };
      },
      onDidChange() {
        return { dispose() {} };
      },
      onDidDelete() {
        return { dispose() {} };
      },
    };
  },
};
export const languages = {
  createDiagnosticCollection(name: string) {
    const entries = new Map<string, readonly Diagnostic[]>();
    editorState.collections.set(name, entries);
    return {
      set(uri: Uri, diagnostics: readonly Diagnostic[]) {
        entries.set(uri.toString(), diagnostics);
      },
      get(uri: Uri) {
        return entries.get(uri.toString());
      },
      delete(uri: Uri) {
        entries.delete(uri.toString());
      },
      clear() {
        entries.clear();
      },
      dispose() {
        entries.clear();
      },
    };
  },
};
export const window = {
  showErrorMessage(message: string): Promise<void> {
    editorState.messages.push(message);
    return Promise.resolve();
  },
  showInformationMessage(message: string): Promise<void> {
    editorState.messages.push(message);
    return Promise.resolve();
  },
};
