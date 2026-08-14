export { DEFAULT_SRIJIKA_ARCHITECTURE, resolveSrijikaArchitectureConfig } from './config';
export {
  canonicalSrijikaOwnerName,
  normalizeSrijikaRelativePath,
  resolveSrijikaStructureOwner,
  srijikaFolderName,
  srijikaPascalName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_FILE_CONTRACT,
  SRIJIKA_OWNER_NAME_PATTERN,
  SRIJIKA_STRUCTURE_CREATION_MATRIX,
} from './creation';
export {
  classifySrijikaArchitectureCapability,
  classifySrijikaArchitecturePath,
  validateSrijikaArchitecture,
} from './validator';
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
  ValidateSrijikaArchitectureOptions,
} from './types';
export type { SrijikaStructureCreationAction, SrijikaStructureOwnerContext } from './creation';
export { SRIJIKA_ARCHITECTURE_PROFILE } from './types';
