import type { SrijikaArchitectureSourceFile } from '@srijika/architecture-rules';
import {
  compileSrijikaNativeTsx,
  nativeRuntimeDiagnostics,
  type NativeDiagnostic,
} from '@srijika/native/editor';

import { checkArchitectureWorkspace } from './architecture-adapter';
import { sourceSpanToRange, type EditorRange, type PositionResolver } from './diagnostic-model';
import type { SrijikaProjectGraphDiagnostic } from './project-architecture-graph';
import type { SrijikaEditorProject } from './project-profile';

export function nativeDiagnosticToEditorDiagnostic(
  source: string,
  diagnostic: NativeDiagnostic,
  resolvePosition?: PositionResolver,
): { code: string; message: string; severity: 'error'; range: EditorRange } {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    range: sourceSpanToRange(source, diagnostic, resolvePosition),
  };
}

export function nativeProjectDiagnostics(
  projectRoot: string,
  project: SrijikaEditorProject,
  files: readonly SrijikaArchitectureSourceFile[],
): readonly SrijikaProjectGraphDiagnostic[] {
  if (project.kind !== 'native')
    throw new Error('Native diagnostics require an explicit Native project profile.');
  const architecture = checkArchitectureWorkspace({
    projectRoot,
    files,
    architecture: project.config.architecture,
    aliases: project.aliases,
    entry: project.config.entry,
  });
  const native = [
    ...nativeRuntimeDiagnostics(files, project.config.architecture),
    ...files
      .filter((file) =>
        file.fileName.toLowerCase().endsWith(project.config.architecture.uiSuffix.toLowerCase()),
      )
      .flatMap((file) => compileSrijikaNativeTsx(file.source, file.fileName).diagnostics),
  ];
  return [
    ...architecture.diagnostics,
    ...native.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      fileName: diagnostic.fileName,
      message: diagnostic.message,
      guidance:
        'Use the independent Native compiler profile; UI stays pure and device behavior belongs in the Connector chain.',
      span: {
        start: diagnostic.start,
        end: diagnostic.end,
        line: diagnostic.line,
        column: diagnostic.column,
      },
    })),
  ];
}
