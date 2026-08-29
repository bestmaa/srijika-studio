export const SRIJIKA_ARCHITECTURE_PROFILE = 'feature-slot-part-v1' as const;
export const SRIJIKA_BROWNFIELD_ADOPTION_PROFILE = 'brownfield-ownership-v1' as const;
export const SRIJIKA_NEXT_FRAMEWORK_PROFILE = 'next-app-router-v1' as const;

export type SrijikaFrameworkComponentPropType =
  'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface SrijikaFrameworkComponentPropConfig {
  type: SrijikaFrameworkComponentPropType;
  required: boolean;
  previewProp?: string;
}

export type SrijikaFrameworkComponentPreviewConfig =
  { kind: 'container'; element: 'a' | 'div' | 'section' } | { kind: 'image' } | { kind: 'text' };

export interface SrijikaProjectFrameworkComponentConfig {
  id: string;
  version: number;
  moduleSpecifier: string;
  exportName: string;
  displayName: string;
  props: Readonly<Record<string, SrijikaFrameworkComponentPropConfig>>;
  children: 'required' | 'optional' | 'forbidden';
  preview: SrijikaFrameworkComponentPreviewConfig;
  source: 'project';
}

export interface ResolvedSrijikaFrameworkConfig {
  version: 1;
  profile: typeof SRIJIKA_NEXT_FRAMEWORK_PROFILE;
  components: readonly SrijikaProjectFrameworkComponentConfig[];
}

export type SrijikaBrownfieldExclusionCategory = 'server' | 'service' | 'domain' | 'test';

export interface SrijikaBrownfieldExclusionConfig {
  path: string;
  category: SrijikaBrownfieldExclusionCategory;
}

export interface SrijikaBrownfieldDirectoryConfig {
  ui?: readonly string[];
  connectors?: readonly string[];
  hooks?: readonly string[];
}

export interface SrijikaBrownfieldAdoptionConfig {
  version: 1;
  profile: typeof SRIJIKA_BROWNFIELD_ADOPTION_PROFILE;
  managedRoots: readonly string[];
  include: readonly string[];
  exclude?: readonly SrijikaBrownfieldExclusionConfig[];
  adoptedOwners: readonly string[];
  directories?: SrijikaBrownfieldDirectoryConfig;
}

export interface ResolvedSrijikaBrownfieldAdoptionConfig {
  version: 1;
  profile: typeof SRIJIKA_BROWNFIELD_ADOPTION_PROFILE;
  managedRoots: readonly string[];
  include: readonly string[];
  exclude: readonly SrijikaBrownfieldExclusionConfig[];
  adoptedOwners: readonly string[];
  directories: {
    ui: readonly string[];
    connectors: readonly string[];
    hooks: readonly string[];
  };
}

export interface SrijikaArchitectureConfig {
  profile: typeof SRIJIKA_ARCHITECTURE_PROFILE;
  /** Project-root-relative directory containing feature folders. */
  featuresRoot?: string;
  /** Project-root-relative directory containing canonical cross-feature owners. */
  sharedRoot?: string;
  slotsDirectory?: string;
  partsDirectory?: string;
  hooksDirectory?: string;
  storesDirectory?: string;
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
  sharedRoot: string;
  slotsDirectory: string;
  partsDirectory: string;
  hooksDirectory: string;
  storesDirectory: string;
  uiSuffix: string;
  connectorSuffix: string;
  storeSuffix: string;
  logicSuffix: string;
  apiSuffix: string;
  typesSuffix: string;
}

export interface SrijikaProjectConfig {
  sourceOfTruth: 'tsx';
  entry: string;
  architecture: ResolvedSrijikaArchitectureConfig;
  adoption?: ResolvedSrijikaBrownfieldAdoptionConfig;
  framework?: ResolvedSrijikaFrameworkConfig;
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
  | 'SRIJIKA4110'
  | 'SRIJIKA4111'
  | 'SRIJIKA4112'
  | 'SRIJIKA4113'
  | 'SRIJIKA4114'
  | 'SRIJIKA4115'
  | 'SRIJIKA4116'
  | 'SRIJIKA4117'
  | 'SRIJIKA4118'
  | 'SRIJIKA4119'
  | 'SRIJIKA4120'
  | 'SRIJIKA4121'
  | 'SRIJIKA4201'
  | 'SRIJIKA4202'
  | 'SRIJIKA4203';

export type SrijikaArchitectureRuleId =
  | 'SRIJIKA-ARCH-MISSING-UI'
  | 'SRIJIKA-ARCH-MISSING-CONNECTOR'
  | 'SRIJIKA-ARCH-STRICT-OWNER-SHAPE'
  | 'SRIJIKA-ARCH-MIXED-CAPABILITY-LAYOUT'
  | 'SRIJIKA-ARCH-MISSING-CAPABILITY-GATEWAY'
  | 'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY'
  | 'SRIJIKA-ARCH-SHARED-PRIVATE-IMPORT'
  | 'SRIJIKA-ARCH-SHARED-MISSING-RUNTIME-GATEWAY'
  | 'SRIJIKA-ARCH-PASSIVE-TYPES'
  | 'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN'
  | 'SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT'
  | 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS'
  | 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT'
  | 'SRIJIKA-ARCH-LAYER-JUMP'
  | 'SRIJIKA-ARCH-UI-RUNTIME-IMPORT'
  | 'SRIJIKA-ARCH-PRIVATE-IMPORT'
  | 'SRIJIKA-ARCH-DIRECT-CHILD-UI'
  | 'SRIJIKA-ARCH-REVERSE-DEPENDENCY'
  | 'SRIJIKA-ARCH-MAINTAINABILITY';

export type SrijikaArchitectureCapability =
  'ui' | 'connector' | 'hook' | 'store' | 'logic' | 'api' | 'types';

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
      | 'store-async-cache'
      | 'owner-consumers'
      | 'ui-function-lines'
      | 'ui-file-lines'
      | 'ui-contract-members';
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

export type SrijikaArchitectureScopeKind =
  'outside' | 'feature' | 'slot' | 'part' | 'shared-ui' | 'shared-widget' | 'shared-capability';

export interface SrijikaArchitectureOwnership {
  kind: SrijikaArchitectureScopeKind;
  fileName: string;
  feature?: string;
  slot?: string;
  part?: string;
  shared?: string;
  relativeToFeature?: string;
  relativeToSlot?: string;
  relativeToPart?: string;
  relativeToShared?: string;
}

export interface ValidateSrijikaArchitectureOptions {
  projectRoot?: string;
  architecture?: Partial<SrijikaArchitectureConfig>;
  /** Import prefix to a project-root-relative directory, for example `@/` -> `src/`. */
  aliases?: Readonly<Record<string, string>>;
}
