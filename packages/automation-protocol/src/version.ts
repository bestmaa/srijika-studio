import { FORMAT_VERSION } from '@srijika/contracts';

/** Wire protocol spoken between Srijika Studio and automation clients. */
export const PROTOCOL_VERSION = '1.0' as const;

/** Version of the first-party MCP/automation tool surface. */
export const TOOL_VERSION = '0.3.1' as const;

/** Canonical Srijika document format understood by this protocol package. */
export const DOCUMENT_FORMAT_VERSION = FORMAT_VERSION;

export const SRIJIKA_RPC_METHODS = {
  getCapabilities: 'srijika.getCapabilities',
  getProjectSummary: 'srijika.getProjectSummary',
  getPageOutline: 'srijika.getPageOutline',
  getNode: 'srijika.getNode',
  getComponentCatalog: 'srijika.getComponentCatalog',
  analyzeRepetitions: 'srijika.analyzeRepetitions',
  getGeneratedCode: 'srijika.getGeneratedCode',
  applyOperations: 'srijika.applyOperations',
  validateDocument: 'srijika.validateDocument',
  getDiagnostics: 'srijika.getDiagnostics',
  renderPreview: 'srijika.renderPreview',
  getLayoutSnapshot: 'srijika.getLayoutSnapshot',
  capturePreview: 'srijika.capturePreview',
  undo: 'srijika.undo',
  redo: 'srijika.redo',
  importDesignPlan: 'srijika.importDesignPlan',
  /** @deprecated Send the Codex-produced structured design plan instead. */
  importDesignImage: 'srijika.importDesignImage',
} as const;

export const SRIJIKA_TOOL_NAMES = {
  getCapabilities: 'srijika_get_capabilities',
  getProjectSummary: 'srijika_get_project_summary',
  getPageOutline: 'srijika_get_page_outline',
  getNode: 'srijika_get_node',
  getComponentCatalog: 'srijika_get_component_catalog',
  analyzeRepetitions: 'srijika_analyze_repetitions',
  getGeneratedCode: 'srijika_get_generated_code',
  applyOperations: 'srijika_apply_operations',
  validateDocument: 'srijika_validate_document',
  getDiagnostics: 'srijika_get_diagnostics',
  renderPreview: 'srijika_render_preview',
  getLayoutSnapshot: 'srijika_get_layout_snapshot',
  capturePreview: 'srijika_capture_preview',
  undo: 'srijika_undo',
  redo: 'srijika_redo',
  importDesignPlan: 'srijika_import_design_plan',
  /** @deprecated Send the Codex-produced structured design plan instead. */
  importDesignImage: 'srijika_import_design_image',
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
    rpcMethods: [SRIJIKA_RPC_METHODS.importDesignImage],
    toolNames: [SRIJIKA_TOOL_NAMES.importDesignImage],
  },
} as const;

export type SrijikaRpcMethod = (typeof SRIJIKA_RPC_METHODS)[keyof typeof SRIJIKA_RPC_METHODS];
export type SrijikaToolName = (typeof SRIJIKA_TOOL_NAMES)[keyof typeof SRIJIKA_TOOL_NAMES];
export type SrijikaCapabilities = typeof CAPABILITIES;
