import {
  validateSrijikaArchitecture,
  type SrijikaArchitectureConfig,
  type SrijikaArchitectureDiagnostic,
  type SrijikaArchitectureSourceFile,
} from '@srijika/architecture-rules';

import { sourceSpanToRange, type EditorRange, type PositionResolver } from './diagnostic-model';

export interface ArchitectureWorkspaceInput {
  projectRoot: string;
  files: readonly SrijikaArchitectureSourceFile[];
  architecture?: Partial<SrijikaArchitectureConfig>;
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
}: ArchitectureWorkspaceInput): readonly SrijikaArchitectureDiagnostic[] {
  return validateSrijikaArchitecture(files, {
    projectRoot,
    ...(architecture ? { architecture } : {}),
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

function stringValue(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function parseSrijikaArchitectureConfig(
  source: string,
): Partial<SrijikaArchitectureConfig> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const architecture = (parsed as Readonly<Record<string, unknown>>)['architecture'];
  if (!architecture || typeof architecture !== 'object' || Array.isArray(architecture)) {
    return undefined;
  }
  const record = architecture as Readonly<Record<string, unknown>>;
  const profile = stringValue(record, 'profile');
  if (profile !== 'feature-slot-part-v1') return undefined;
  const result: Partial<SrijikaArchitectureConfig> = {};
  result.profile = 'feature-slot-part-v1';
  const featuresRoot = stringValue(record, 'featuresRoot');
  const slotsDirectory = stringValue(record, 'slotsDirectory');
  const partsDirectory = stringValue(record, 'partsDirectory');
  const hooksDirectory = stringValue(record, 'hooksDirectory');
  const uiSuffix = stringValue(record, 'uiSuffix');
  const connectorSuffix = stringValue(record, 'connectorSuffix');
  const storeSuffix = stringValue(record, 'storeSuffix');
  const logicSuffix = stringValue(record, 'logicSuffix');
  const apiSuffix = stringValue(record, 'apiSuffix');
  const typesSuffix = stringValue(record, 'typesSuffix');
  if (featuresRoot) result.featuresRoot = featuresRoot;
  if (slotsDirectory) result.slotsDirectory = slotsDirectory;
  if (partsDirectory) result.partsDirectory = partsDirectory;
  if (hooksDirectory) result.hooksDirectory = hooksDirectory;
  if (uiSuffix) result.uiSuffix = uiSuffix;
  if (connectorSuffix) result.connectorSuffix = connectorSuffix;
  if (storeSuffix) result.storeSuffix = storeSuffix;
  if (logicSuffix) result.logicSuffix = logicSuffix;
  if (apiSuffix) result.apiSuffix = apiSuffix;
  if (typesSuffix) result.typesSuffix = typesSuffix;
  return result;
}
