export const SRIJIKA_ARCHITECTURE_PROFILE = 'feature-slot-part-v1' as const;

export interface SrijikaArchitectureConfig {
  profile: typeof SRIJIKA_ARCHITECTURE_PROFILE;
  /** Project-root-relative directory containing feature folders. */
  featuresRoot?: string;
  slotsDirectory?: string;
  partsDirectory?: string;
  hooksDirectory?: string;
  uiSuffix?: string;
  connectorSuffix?: string;
  storeSuffix?: string;
  logicSuffix?: string;
  apiSuffix?: string;
  typesSuffix?: string;
}

export interface ResolvedSrijikaArchitectureConfig {
  profile: typeof SRIJIKA_ARCHITECTURE_PROFILE;
  featuresRoot: string;
  slotsDirectory: string;
  partsDirectory: string;
  hooksDirectory: string;
  uiSuffix: string;
  connectorSuffix: string;
  storeSuffix: string;
  logicSuffix: string;
  apiSuffix: string;
  typesSuffix: string;
}

export interface SrijikaArchitectureSourceFile {
  fileName: string;
  source: string;
}

export interface SrijikaArchitectureSourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

export type SrijikaArchitectureDiagnosticCode =
  | 'SRIJIKA4101'
  | 'SRIJIKA4102'
  | 'SRIJIKA4103'
  | 'SRIJIKA4104'
  | 'SRIJIKA4105'
  | 'SRIJIKA4106'
  | 'SRIJIKA4107'
  | 'SRIJIKA4108'
  | 'SRIJIKA4109'
  | 'SRIJIKA4201'
  | 'SRIJIKA4202'
  | 'SRIJIKA4203';

export type SrijikaArchitectureRuleId =
  | 'SRIJIKA-ARCH-MISSING-UI'
  | 'SRIJIKA-ARCH-MISSING-CONNECTOR'
  | 'SRIJIKA-ARCH-LAYER-JUMP'
  | 'SRIJIKA-ARCH-UI-RUNTIME-IMPORT'
  | 'SRIJIKA-ARCH-PRIVATE-IMPORT'
  | 'SRIJIKA-ARCH-DIRECT-CHILD-UI'
  | 'SRIJIKA-ARCH-REVERSE-DEPENDENCY'
  | 'SRIJIKA-ARCH-MAINTAINABILITY';

export type SrijikaArchitectureCapability =
  'connector' | 'hook' | 'store' | 'logic' | 'api' | 'types';

export interface SrijikaArchitectureRecommendation {
  id:
    | 'SRIJIKA-ARCH-RECOMMEND-LOGIC'
    | 'SRIJIKA-ARCH-RECOMMEND-HOOK'
    | 'SRIJIKA-ARCH-RECOMMEND-STORE'
    | 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE'
    | 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER'
    | 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER';
  kind: 'required-fix' | 'maintainability';
  owner: string;
  ownerKind: Exclude<SrijikaArchitectureScopeKind, 'outside'>;
  from: SrijikaArchitectureCapability;
  currentTarget: SrijikaArchitectureCapability;
  recommendedTarget: SrijikaArchitectureCapability;
  message: string;
  suggestedFileName?: string;
  evidence?: {
    metric:
      | 'endpoint-calls'
      | 'branch-validation-transform'
      | 'lifecycle-cache'
      | 'async-handlers'
      | 'react-hooks'
      | 'local-state-fields'
      | 'store-members'
      | 'store-async-cache';
    value: number;
    threshold: number;
  };
}

export interface SrijikaArchitectureDiagnostic {
  code: SrijikaArchitectureDiagnosticCode;
  /** Stable semantic rule identifier; numeric `code` remains for compatibility. */
  ruleId?: SrijikaArchitectureRuleId;
  severity: 'error' | 'warning';
  fileName: string;
  span: SrijikaArchitectureSourceSpan;
  message: string;
  /** Human guidance shown by Studio, CLI, and editor code actions. */
  guidance: string;
  targetFileName?: string;
  recommendation?: SrijikaArchitectureRecommendation;
}

export interface SrijikaArchitectureValidationResult {
  diagnostics: readonly SrijikaArchitectureDiagnostic[];
  recommendations: readonly SrijikaArchitectureRecommendation[];
}

export type SrijikaArchitectureScopeKind = 'outside' | 'feature' | 'slot' | 'part';

export interface SrijikaArchitectureOwnership {
  kind: SrijikaArchitectureScopeKind;
  fileName: string;
  feature?: string;
  slot?: string;
  part?: string;
  relativeToFeature?: string;
  relativeToSlot?: string;
  relativeToPart?: string;
}

export interface ValidateSrijikaArchitectureOptions {
  projectRoot?: string;
  architecture?: Partial<SrijikaArchitectureConfig>;
  /** Import prefix to a project-root-relative directory, for example `@/` -> `src/`. */
  aliases?: Readonly<Record<string, string>>;
}
