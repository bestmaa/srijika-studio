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
  ResolvedSrijikaArchitectureConfig,
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
export { SRIJIKA_ARCHITECTURE_PROFILE } from './types';
