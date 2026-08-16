export const SRIJIKA_REACT_MIGRATION_TOOL_NAMES = {
  create: 'srijika_create_react_migration',
  scanSource: 'srijika_scan_react_migration_source',
  getPlan: 'srijika_get_react_migration_plan',
  getStatus: 'srijika_get_react_migration_status',
  applySlice: 'srijika_apply_react_migration_slice',
  verifySlice: 'srijika_verify_react_migration_slice',
  verify: 'srijika_verify_react_migration',
  finalize: 'srijika_finalize_react_migration',
} as const;

export type SrijikaReactMigrationToolName =
  (typeof SRIJIKA_REACT_MIGRATION_TOOL_NAMES)[keyof typeof SRIJIKA_REACT_MIGRATION_TOOL_NAMES];

export const SRIJIKA_REACT_MIGRATION_TOOL_LIST = Object.values(
  SRIJIKA_REACT_MIGRATION_TOOL_NAMES,
) as readonly SrijikaReactMigrationToolName[];
