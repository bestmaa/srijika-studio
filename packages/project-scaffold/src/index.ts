export { createSrijikaProjectFileMap, createSrijikaUiSourcePair } from './templates.js';
export type {
  SrijikaProjectFileMap,
  SrijikaProjectScaffoldOptions,
  SrijikaUiSourceKind,
  SrijikaUiSourcePair,
  SrijikaUiSourcePairOptions,
  WriteSrijikaProjectResult,
} from './types.js';
export { writeSrijikaProject } from './writer.js';
export {
  availableSrijikaOwnershipCreationActions,
  buildSrijikaOwnershipCapabilityBatchPlan,
  buildSrijikaOwnershipCreationPlan,
  srijikaOwnershipFileStatuses,
} from './ownership.js';
export { applySrijikaOwnershipCreationPlan } from './ownership-writer.js';
export {
  applySrijikaNextAppRouterPlan,
  applySrijikaNextTestAdapterPlan,
  applySrijikaViteTestAdapterPlan,
} from './test-writer.js';
export { applySrijikaTestPackagePlan } from './test-package-writer.js';
export {
  buildSrijikaViteTestAdapterPlan,
  SRIJIKA_GENERATED_TEST_HEADER,
  SRIJIKA_VITE_TEST_ADAPTER_VERSION,
} from './testing.js';
export {
  buildSrijikaNextTestAdapterPlan,
  SRIJIKA_NEXT_TEST_ADAPTER_VERSION,
} from './next-testing.js';
export {
  buildSrijikaNextAppRouterPlan,
  SRIJIKA_GENERATED_NEXT_ROUTE_HEADER,
  SRIJIKA_NEXT_APP_ADAPTER_VERSION,
} from './next-app.js';
export { buildSrijikaTestEvidenceManifest, SRIJIKA_TEST_EVIDENCE_VERSION } from './evidence.js';
export type {
  ApplySrijikaOwnershipPlanOptions,
  ApplySrijikaOwnershipPlanResult,
} from './ownership-writer.js';
export type {
  ApplySrijikaNextAppRouterResult,
  ApplySrijikaNextTestAdapterResult,
  ApplySrijikaTestAdapterResult,
  ApplySrijikaViteTestAdapterResult,
} from './test-writer.js';
export type { ApplySrijikaTestPackageResult } from './test-package-writer.js';
export type {
  BuildSrijikaViteTestAdapterOptions,
  SrijikaGeneratedTestArtifact,
  SrijikaGeneratedTestFile,
  SrijikaTestEvidenceFiles,
  SrijikaTestPackageRequirement,
  SrijikaViteTestAdapterPlan,
} from './testing.js';
export type {
  BuildSrijikaNextTestAdapterOptions,
  SrijikaNextTestAdapterPlan,
} from './next-testing.js';
export type {
  BuildSrijikaNextAppRouterOptions,
  SrijikaNextAppFile,
  SrijikaNextAppRouterPlan,
  SrijikaNextBoundaryDiagnostic,
  SrijikaNextOwnerBoundary,
  SrijikaNextRouteMapping,
} from './next-app.js';
export type {
  BuildSrijikaTestEvidenceOptions,
  SrijikaEvidenceStatus,
  SrijikaOwnerRepairScope,
  SrijikaOwnerTestEvidence,
  SrijikaRequirementEvidence,
  SrijikaTestEvidenceManifest,
} from './evidence.js';
export type {
  SrijikaOptionalOwnerCapability,
  SrijikaOwnerFileRole,
  SrijikaOwnershipCapabilityBatchInput,
  SrijikaOwnershipCreationFile,
  SrijikaOwnershipCreationInput,
  SrijikaOwnershipCreationPlan,
  SrijikaOwnershipFileStatus,
} from './ownership.js';
