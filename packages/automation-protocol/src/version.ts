import { FORMAT_VERSION } from '@sutra/contracts';

/** Wire protocol spoken between Sutra Studio and automation clients. */
export const PROTOCOL_VERSION = '1.0' as const;

/** Version of the first-party MCP/automation tool surface. */
export const TOOL_VERSION = '0.3.1' as const;

/** Canonical Sutra document format understood by this protocol package. */
export const DOCUMENT_FORMAT_VERSION = FORMAT_VERSION;

export const SUTRA_RPC_METHODS = {
  getCapabilities: 'sutra.getCapabilities',
  getProjectSummary: 'sutra.getProjectSummary',
  getPageOutline: 'sutra.getPageOutline',
  getNode: 'sutra.getNode',
  getComponentCatalog: 'sutra.getComponentCatalog',
  analyzeRepetitions: 'sutra.analyzeRepetitions',
  getGeneratedCode: 'sutra.getGeneratedCode',
  applyOperations: 'sutra.applyOperations',
  validateDocument: 'sutra.validateDocument',
  getDiagnostics: 'sutra.getDiagnostics',
  renderPreview: 'sutra.renderPreview',
  getLayoutSnapshot: 'sutra.getLayoutSnapshot',
  capturePreview: 'sutra.capturePreview',
  undo: 'sutra.undo',
  redo: 'sutra.redo',
  importDesignPlan: 'sutra.importDesignPlan',
  /** @deprecated Send the Codex-produced structured design plan instead. */
  importDesignImage: 'sutra.importDesignImage',
} as const;

export const SUTRA_TOOL_NAMES = {
  getCapabilities: 'sutra_get_capabilities',
  getProjectSummary: 'sutra_get_project_summary',
  getPageOutline: 'sutra_get_page_outline',
  getNode: 'sutra_get_node',
  getComponentCatalog: 'sutra_get_component_catalog',
  analyzeRepetitions: 'sutra_analyze_repetitions',
  getGeneratedCode: 'sutra_get_generated_code',
  applyOperations: 'sutra_apply_operations',
  validateDocument: 'sutra_validate_document',
  getDiagnostics: 'sutra_get_diagnostics',
  renderPreview: 'sutra_render_preview',
  getLayoutSnapshot: 'sutra_get_layout_snapshot',
  capturePreview: 'sutra_capture_preview',
  undo: 'sutra_undo',
  redo: 'sutra_redo',
  importDesignPlan: 'sutra_import_design_plan',
  /** @deprecated Send the Codex-produced structured design plan instead. */
  importDesignImage: 'sutra_import_design_image',
} as const;

export const CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  toolVersion: TOOL_VERSION,
  documentFormatVersions: [DOCUMENT_FORMAT_VERSION],
  reads: [
    'projectSummary',
    'pageOutline',
    'nodeDetail',
    'componentCatalog',
    'repetitionAnalysis',
    'generatedCode',
    'renderedLayout',
    'previewCapture',
  ],
  operations: [
    'insertComponent',
    'insertText',
    'insertIf',
    'insertRepeat',
    'moveNode',
    'removeNode',
    'renameNode',
    'setProp',
    'setStyle',
    'setEventBinding',
    'addPublicProp',
    'convertRepeatedSiblings',
    'replaceDocument',
  ],
  features: {
    atomicBatches: true,
    optimisticConcurrency: true,
    generatedIdMapping: true,
    localBatchNodeReferences: true,
    graphValidation: true,
    semanticValidation: true,
    protocolAdapters: true,
    structuredDesignPlans: true,
    exactViewport: true,
    computedLayoutInspection: true,
    cleanPngCapture: true,
    detailedComponentManifests: true,
    typedRepeatConversion: true,
    responsiveStyleWrites: true,
    generatedTsxInspection: true,
    schemaValidation: true,
  },
  limits: {
    customViewport: {
      minWidth: 240,
      maxWidth: 4_096,
      minHeight: 200,
      maxHeight: 4_096,
    },
    operations: {
      maxBatch: 500,
      maxDesignPlanBatch: 1_000,
    },
    outline: {
      maxDepth: 64,
      maxNodes: 2_000,
    },
    layout: {
      maxNodeIds: 500,
      maxInstances: 5_000,
    },
    capture: {
      minPixelRatio: 1,
      maxPixelRatio: 2,
    },
    repetitions: {
      minInstances: 2,
      maxInstances: 100,
      maxCandidates: 500,
    },
  },
  deprecated: {
    rpcMethods: [SUTRA_RPC_METHODS.importDesignImage],
    toolNames: [SUTRA_TOOL_NAMES.importDesignImage],
  },
} as const;

export type SutraRpcMethod = (typeof SUTRA_RPC_METHODS)[keyof typeof SUTRA_RPC_METHODS];
export type SutraToolName = (typeof SUTRA_TOOL_NAMES)[keyof typeof SUTRA_TOOL_NAMES];
export type SutraCapabilities = typeof CAPABILITIES;
