import {
  parseSrijikaProjectConfig,
  planSrijikaBrownfieldAdoption,
  validateSrijikaArchitecture,
  type ResolvedSrijikaBrownfieldAdoptionConfig,
  type SrijikaArchitectureConfig,
  type SrijikaArchitectureDiagnostic,
  type SrijikaArchitectureSourceFile,
  type SrijikaProjectConfig,
  type SrijikaBrownfieldAdoptionPlan,
} from '@srijika/architecture-rules';

import { sourceSpanToRange, type EditorRange, type PositionResolver } from './diagnostic-model';

export interface ArchitectureWorkspaceInput {
  projectRoot: string;
  files: readonly SrijikaArchitectureSourceFile[];
  architecture?: Partial<SrijikaArchitectureConfig>;
  aliases?: Readonly<Record<string, string>>;
  entry?: string;
  adoption?: ResolvedSrijikaBrownfieldAdoptionConfig;
}

export interface ArchitectureWorkspaceResult {
  diagnostics: readonly SrijikaArchitectureDiagnostic[];
  adoption?: SrijikaBrownfieldAdoptionPlan;
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
  entry,
  adoption,
}: ArchitectureWorkspaceInput): readonly SrijikaArchitectureDiagnostic[] {
  return checkArchitectureWorkspace({
    projectRoot,
    files,
    ...(architecture ? { architecture } : {}),
    ...(aliases ? { aliases } : {}),
    ...(entry ? { entry } : {}),
    ...(adoption ? { adoption } : {}),
  }).diagnostics;
}

export function checkArchitectureWorkspace({
  projectRoot,
  files,
  architecture,
  aliases,
  entry,
  adoption,
}: ArchitectureWorkspaceInput): ArchitectureWorkspaceResult {
  const validation = validateSrijikaArchitecture(files, {
    projectRoot,
    ...(architecture ? { architecture } : {}),
    ...(aliases ? { aliases } : {}),
  });
  if (!adoption) return { diagnostics: validation.diagnostics };
  const plan = planSrijikaBrownfieldAdoption(files, adoption, {
    projectRoot,
    ...(architecture ? { architecture } : {}),
    ...(aliases ? { aliases } : {}),
  });
  const normalizedRoot = projectRoot.replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase();
  const strict = new Set(plan.strictFiles.map((fileName) => fileName.toLowerCase()));
  if (entry) strict.add(entry.toLowerCase());
  const diagnostics = validation.diagnostics.filter(({ fileName }) => {
    const normalized = fileName.replaceAll('\\', '/');
    const relative = normalized.toLowerCase().startsWith(`${normalizedRoot}/`)
      ? normalized.slice(normalizedRoot.length + 1)
      : normalized;
    return strict.has(relative.toLowerCase());
  });
  return { diagnostics: Object.freeze(diagnostics), adoption: plan };
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
