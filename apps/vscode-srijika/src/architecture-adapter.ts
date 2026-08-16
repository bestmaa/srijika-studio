import {
  parseSrijikaProjectConfig,
  validateSrijikaArchitecture,
  type SrijikaArchitectureConfig,
  type SrijikaArchitectureDiagnostic,
  type SrijikaArchitectureSourceFile,
  type SrijikaProjectConfig,
} from '@srijika/architecture-rules';

import { sourceSpanToRange, type EditorRange, type PositionResolver } from './diagnostic-model';

export interface ArchitectureWorkspaceInput {
  projectRoot: string;
  files: readonly SrijikaArchitectureSourceFile[];
  architecture?: Partial<SrijikaArchitectureConfig>;
  aliases?: Readonly<Record<string, string>>;
}

export interface EditorArchitectureDiagnostic {
  code: SrijikaArchitectureDiagnostic['code'];
  ruleId?: SrijikaArchitectureDiagnostic['ruleId'];
  severity: SrijikaArchitectureDiagnostic['severity'];
  message: string;
  guidance: string;
  fileName: string;
  range: EditorRange;
}

export function validateArchitectureWorkspace({
  projectRoot,
  files,
  architecture,
  aliases,
}: ArchitectureWorkspaceInput): readonly SrijikaArchitectureDiagnostic[] {
  return validateSrijikaArchitecture(files, {
    projectRoot,
    ...(architecture ? { architecture } : {}),
    ...(aliases ? { aliases } : {}),
  }).diagnostics;
}

export function architectureDiagnosticToEditorDiagnostic(
  source: string,
  diagnostic: SrijikaArchitectureDiagnostic,
  resolvePosition?: PositionResolver,
): EditorArchitectureDiagnostic {
  return {
    code: diagnostic.code,
    ...(diagnostic.ruleId ? { ruleId: diagnostic.ruleId } : {}),
    severity: diagnostic.severity,
    message: diagnostic.message,
    guidance: diagnostic.guidance,
    fileName: diagnostic.fileName,
    range: sourceSpanToRange(source, diagnostic.span, resolvePosition),
  };
}

export function parseSrijikaArchitectureConfig(
  source: string,
): Partial<SrijikaArchitectureConfig> | undefined {
  return parseSrijikaCodeProjectConfig(source).architecture;
}

export function parseSrijikaCodeProjectConfig(source: string): SrijikaProjectConfig {
  return parseSrijikaProjectConfig(source);
}
