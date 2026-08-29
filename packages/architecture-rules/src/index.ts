export {
  DEFAULT_SRIJIKA_ARCHITECTURE,
  parseSrijikaProjectArchitectureConfig,
  parseSrijikaProjectConfig,
  parseSrijikaTypeScriptPathAliases,
  resolveSrijikaArchitectureConfig,
} from './config';
export {
  canonicalSrijikaOwnerName,
  normalizeSrijikaRelativePath,
  resolveSrijikaStructureOwner,
  srijikaFolderName,
  srijikaPascalName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_FILE_CONTRACT,
  SRIJIKA_OWNER_NAME_PATTERN,
  SRIJIKA_SHARED_FILE_CONTRACT,
  SRIJIKA_STRUCTURE_CREATION_MATRIX,
} from './creation';
export {
  classifySrijikaArchitectureCapability,
  classifySrijikaArchitecturePath,
  validateSrijikaArchitecture,
} from './validator';
export {
  affectedSrijikaTestPlan,
  buildSrijikaTestContract,
  SRIJIKA_TEST_CONTRACT_VERSION,
} from './testing';
export type {
  PlanSrijikaBrownfieldAdoptionOptions,
  SrijikaBrownfieldAdoptionPlan,
  SrijikaBrownfieldCoverageEntry,
  SrijikaBrownfieldCoverageStatus,
  SrijikaBrownfieldCoverageSummary,
  SrijikaBrownfieldFileCategory,
  SrijikaBrownfieldMove,
  SrijikaBrownfieldRewire,
} from './adoption';
export type {
  ResolvedSrijikaBrownfieldAdoptionConfig,
  ResolvedSrijikaArchitectureConfig,
  ResolvedSrijikaFrameworkConfig,
  SrijikaBrownfieldAdoptionConfig,
  SrijikaBrownfieldDirectoryConfig,
  SrijikaBrownfieldExclusionCategory,
  SrijikaBrownfieldExclusionConfig,
  SrijikaArchitectureConfig,
  SrijikaArchitectureCapability,
  SrijikaArchitectureDiagnostic,
  SrijikaArchitectureDiagnosticCode,
  SrijikaArchitectureOwnership,
  SrijikaArchitectureRecommendation,
  SrijikaArchitectureRuleId,
  SrijikaArchitectureSourceFile,
  SrijikaArchitectureSourceSpan,
  SrijikaArchitectureValidationResult,
  SrijikaProjectConfig,
  SrijikaFrameworkComponentPreviewConfig,
  SrijikaFrameworkComponentPropConfig,
  SrijikaFrameworkComponentPropType,
  SrijikaProjectFrameworkComponentConfig,
  ValidateSrijikaArchitectureOptions,
} from './types';
export type {
  SrijikaAffectedTestPlan,
  SrijikaTestContract,
  SrijikaTestFileDependency,
  SrijikaTestFileRole,
  SrijikaTestLayer,
  SrijikaTestOwner,
  SrijikaTestOwnerFile,
  SrijikaTestOwnerKind,
  SrijikaTestRequirement,
  SrijikaTestRuntime,
} from './testing';
export type { SrijikaStructureCreationAction, SrijikaStructureOwnerContext } from './creation';
export {
  SRIJIKA_ARCHITECTURE_PROFILE,
  SRIJIKA_BROWNFIELD_ADOPTION_PROFILE,
  SRIJIKA_NEXT_FRAMEWORK_PROFILE,
} from './types';
export { planSrijikaBrownfieldAdoption, SRIJIKA_BROWNFIELD_PLAN_VERSION } from './adoption';
export {
  analyzeSrijikaPayloadNextProfile,
  classifySrijikaPayloadServerModule,
  srijikaRuntimeServerImports,
  SRIJIKA_PAYLOAD_NEXT_PROFILE_VERSION,
} from './payload-next';
export type {
  AnalyzeSrijikaPayloadNextProfileOptions,
  SrijikaPayloadNextProfile,
  SrijikaPayloadNextSourceFile,
  SrijikaPayloadServerModuleKind,
} from './payload-next';
