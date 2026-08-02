import * as z from 'zod/v4';

const nodeId = z.string().min(1).max(128);
const nodeReference = z.union([
  nodeId,
  z.object({ createdBy: z.string().min(1).max(128) }).strict(),
]);
const operationId = z.string().min(1).max(128).optional();
const pageId = z.string().min(1).max(128).optional();
const identifier = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .max(128);
const javascriptIdentifier = z
  .string()
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
  .max(128);

const valueExpression: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: z.json() }).strict(),
    z
      .object({
        kind: z.literal('reference'),
        symbolId: z.string().min(1).max(128),
        path: z.array(z.string()),
      })
      .strict(),
    z
      .object({
        kind: z.literal('unary'),
        operator: z.enum(['not', 'negate']),
        operand: valueExpression,
      })
      .strict(),
    z
      .object({
        kind: z.literal('binary'),
        operator: z.enum([
          'equals',
          'notEquals',
          'greaterThan',
          'greaterThanOrEqual',
          'lessThan',
          'lessThanOrEqual',
          'and',
          'or',
          'add',
          'subtract',
          'multiply',
          'divide',
        ]),
        left: valueExpression,
        right: valueExpression,
      })
      .strict(),
    z
      .object({
        kind: z.literal('conditional'),
        condition: valueExpression,
        whenTrue: valueExpression,
        whenFalse: valueExpression,
      })
      .strict(),
    z
      .object({
        kind: z.literal('template'),
        parts: z.array(z.union([z.string(), valueExpression])),
      })
      .strict(),
    z
      .object({
        kind: z.literal('customCodeReference'),
        moduleId: identifier,
        exportName: javascriptIdentifier,
        args: z.array(valueExpression),
      })
      .strict(),
  ]),
);

const length = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fixed'),
    value: z.number().nonnegative(),
    unit: z.enum(['px', 'rem']),
  }),
  z.object({ mode: z.literal('percent'), value: z.number().nonnegative() }),
  z.object({ mode: z.literal('fill') }),
  z.object({ mode: z.literal('hug') }),
  z.object({ mode: z.literal('auto') }),
]);
const spacing = z
  .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
  .strict();

const style = z
  .object({
    display: z.enum(['block', 'flex', 'grid', 'none']).optional(),
    flexDirection: z.enum(['row', 'column']).optional(),
    flexWrap: z.enum(['nowrap', 'wrap', 'wrap-reverse']).optional(),
    flexGrow: z.number().nonnegative().optional(),
    flexShrink: z.number().nonnegative().optional(),
    flexBasis: length.optional(),
    order: z.number().int().optional(),
    alignItems: z.enum(['stretch', 'start', 'center', 'end']).optional(),
    alignContent: z
      .enum(['stretch', 'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'])
      .optional(),
    justifyContent: z
      .enum(['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'])
      .optional(),
    alignSelf: z.enum(['auto', 'stretch', 'start', 'center', 'end']).optional(),
    justifySelf: z.enum(['auto', 'stretch', 'start', 'center', 'end']).optional(),
    placeItems: z.enum(['stretch', 'start', 'center', 'end']).optional(),
    gridTemplateColumns: z.string().optional(),
    gridTemplateRows: z.string().optional(),
    gridColumn: z.string().optional(),
    gridRow: z.string().optional(),
    width: length.optional(),
    height: length.optional(),
    minWidth: z.number().nonnegative().optional(),
    maxWidth: z.number().nonnegative().optional(),
    minHeight: z.number().nonnegative().optional(),
    maxHeight: z.number().nonnegative().optional(),
    gap: z.number().nonnegative().optional(),
    rowGap: z.number().nonnegative().optional(),
    columnGap: z.number().nonnegative().optional(),
    padding: spacing.optional(),
    margin: spacing.optional(),
    backgroundColor: z.string().optional(),
    backgroundImage: z.string().optional(),
    backgroundSize: z.string().optional(),
    backgroundPosition: z.string().optional(),
    backgroundRepeat: z
      .enum(['repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round'])
      .optional(),
    color: z.string().optional(),
    borderColor: z.string().optional(),
    borderWidth: z.number().nonnegative().optional(),
    borderStyle: z.enum(['none', 'solid', 'dashed', 'dotted', 'double']).optional(),
    borderRadius: z.number().nonnegative().optional(),
    boxShadow: z.string().optional(),
    opacity: z.number().min(0).max(1).optional(),
    cursor: z.enum(['auto', 'default', 'pointer', 'text', 'grab', 'not-allowed']).optional(),
    position: z.enum(['static', 'relative', 'absolute', 'sticky', 'fixed']).optional(),
    top: z.number().optional(),
    right: z.number().optional(),
    bottom: z.number().optional(),
    left: z.number().optional(),
    zIndex: z.number().int().optional(),
    aspectRatio: z.union([z.number().positive(), z.string()]).optional(),
    objectFit: z.enum(['fill', 'contain', 'cover', 'none', 'scale-down']).optional(),
    objectPosition: z.string().optional(),
    fontSize: z.number().min(1).optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    fontFamily: z.string().optional(),
    fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(),
    lineHeight: z.number().nonnegative().optional(),
    letterSpacing: z.number().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
    textDecoration: z.enum(['none', 'underline', 'line-through', 'overline']).optional(),
    whiteSpace: z.enum(['normal', 'nowrap', 'pre-wrap']).optional(),
    textOverflow: z.enum(['clip', 'ellipsis']).optional(),
    overflowWrap: z.enum(['normal', 'break-word', 'anywhere']).optional(),
    overflow: z.enum(['visible', 'hidden', 'auto']).optional(),
    overflowX: z.enum(['visible', 'hidden', 'auto']).optional(),
    overflowY: z.enum(['visible', 'hidden', 'auto']).optional(),
    transform: z.string().optional(),
    transformOrigin: z.string().optional(),
    filter: z.string().optional(),
    backdropFilter: z.string().optional(),
    pointerEvents: z.enum(['auto', 'none']).optional(),
    visibility: z.enum(['visible', 'hidden', 'collapse']).optional(),
  })
  .strict();

const valueShape: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('string') }).strict(),
    z.object({ kind: z.literal('number') }).strict(),
    z.object({ kind: z.literal('boolean') }).strict(),
    z.object({ kind: z.literal('color') }).strict(),
    z.object({ kind: z.literal('unknown') }).strict(),
    z.object({ kind: z.literal('array'), item: valueShape }).strict(),
    z
      .object({
        kind: z.literal('object'),
        fields: z.record(
          javascriptIdentifier,
          z.object({ required: z.boolean(), shape: valueShape }).strict(),
        ),
        additionalProperties: z.boolean(),
      })
      .strict(),
  ]),
);

const eventArgument = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('eventPayload') }).strict(),
  z.object({ kind: z.literal('expression'), expression: valueExpression }).strict(),
]);

const publicProp = z
  .object({
    symbolId: z.string().min(1).max(128),
    name: javascriptIdentifier,
    displayName: z.string().min(1),
    valueType: z.enum([
      'string',
      'number',
      'boolean',
      'color',
      'event',
      'array',
      'object',
      'unknown',
    ]),
    valueShape: valueShape.optional(),
    eventSignature: z
      .object({
        payload: z.object({ name: javascriptIdentifier, shape: valueShape }).strict().nullable(),
      })
      .strict()
      .optional(),
    required: z.boolean(),
    defaultValue: z.json().optional(),
  })
  .strict();

const location = {
  parentId: nodeReference,
  slot: z.string().min(1).max(128).optional(),
  index: z.number().int().nonnegative().optional(),
};

function requireViewportPair(
  width: number | undefined,
  height: number | undefined,
  context: { addIssue: (issue: { code: 'custom'; message: string }) => void },
): void {
  if ((width === undefined) !== (height === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Viewport width and height must be supplied together.',
    });
  }
}

const renderPreviewInput = z
  .object({
    pageId,
    viewport: z.enum(['desktop', 'tablet', 'mobile']).default('desktop'),
    selectedNodeId: nodeId.optional(),
    width: z.number().int().min(240).max(4_096).optional(),
    height: z.number().int().min(200).max(4_096).optional(),
  })
  .strict()
  .superRefine((value, context) => requireViewportPair(value.width, value.height, context));

const capturePreviewInput = z
  .object({
    pageId,
    viewport: z.enum(['desktop', 'tablet', 'mobile']).default('desktop'),
    width: z.number().int().min(240).max(4_096).optional(),
    height: z.number().int().min(200).max(4_096).optional(),
    pixelRatio: z.number().min(1).max(2).default(1),
  })
  .strict()
  .superRefine((value, context) => requireViewportPair(value.width, value.height, context));

export const sutraOperation = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('insertComponent'),
      operationId,
      ...location,
      id: nodeId.optional(),
      componentId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/),
      name: z.string().min(1).optional(),
      props: z.record(z.string(), valueExpression).optional(),
      style: style.optional(),
      classRefs: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('insertText'),
      operationId,
      ...location,
      id: nodeId.optional(),
      name: z.string().min(1).optional(),
      value: valueExpression,
    })
    .strict(),
  z
    .object({
      kind: z.literal('insertIf'),
      operationId,
      ...location,
      id: nodeId.optional(),
      name: z.string().min(1).optional(),
      condition: valueExpression,
    })
    .strict(),
  z
    .object({
      kind: z.literal('insertRepeat'),
      operationId,
      ...location,
      id: nodeId.optional(),
      name: z.string().min(1).optional(),
      source: valueExpression,
      item: z
        .object({
          id: z.string().min(1).max(128).optional(),
          name: javascriptIdentifier.optional(),
          displayName: z.string().min(1).optional(),
          valueType: z
            .enum(['string', 'number', 'boolean', 'color', 'event', 'array', 'object', 'unknown'])
            .optional(),
          valueShape: valueShape.optional(),
        })
        .strict()
        .optional(),
      indexSymbol: z
        .object({
          id: z.string().min(1).max(128).optional(),
          name: javascriptIdentifier.optional(),
          displayName: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('moveNode'), operationId, nodeId: nodeReference, ...location })
    .strict(),
  z.object({ kind: z.literal('removeNode'), operationId, nodeId: nodeReference }).strict(),
  z
    .object({
      kind: z.literal('renameNode'),
      operationId,
      nodeId: nodeReference,
      name: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('setProp'),
      operationId,
      nodeId: nodeReference,
      propName: javascriptIdentifier,
      value: valueExpression.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('setStyle'),
      operationId,
      nodeId: nodeReference,
      style,
      unset: z.array(z.string()).optional(),
      breakpoint: z.string().trim().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('setEventBinding'),
      operationId,
      nodeId: nodeReference,
      eventName: javascriptIdentifier,
      handler: valueExpression.nullable(),
      argument: eventArgument.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('addPublicProp'), operationId, prop: publicProp }).strict(),
  z
    .object({
      kind: z.literal('convertRepeatedSiblings'),
      operationId,
      candidateId: z.string().min(1).max(128),
      propName: javascriptIdentifier,
      propDisplayName: z.string().trim().min(1).max(255).optional(),
      repeatName: z.string().trim().min(1).max(255).optional(),
      repeatNodeId: nodeId.optional(),
      propSymbolId: z.string().min(1).max(128).optional(),
      itemSymbolId: z.string().min(1).max(128).optional(),
      indexSymbolId: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('replaceDocument'),
      operationId,
      document: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

export const toolInputs = {
  getCapabilities: {},
  getProjectSummary: {
    includePages: z.boolean().default(true).describe('Include compact page summaries.'),
  },
  getPageOutline: {
    pageId,
    maxDepth: z.number().int().min(0).max(64).default(12),
    maxNodes: z.number().int().min(1).max(2_000).default(300),
  },
  getNode: { pageId, nodeId },
  getComponentCatalog: {
    query: z.string().max(100).optional(),
    category: z.enum(['Layout', 'Typography', 'Inputs', 'Media', 'Structure']).optional(),
    ids: z.array(z.string().min(1).max(128)).max(100).optional(),
    detail: z.enum(['summary', 'manifest']).default('summary'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  analyzeRepetitions: {
    pageId,
    candidateId: z.string().min(1).max(128).optional(),
    minInstances: z.number().int().min(2).max(100).default(2),
    maxCandidates: z.number().int().min(1).max(500).default(50),
    includeValues: z.boolean().default(false),
  },
  getGeneratedCode: {
    pageId,
    detail: z
      .enum(['summary', 'full'])
      .default('summary')
      .describe('Return compact generated-code facts by default; request full for complete TSX.'),
  },
  applyOperations: {
    pageId,
    expectedRevision: z.number().int().nonnegative(),
    operations: z.array(sutraOperation).min(1).max(500),
  },
  validateDocument: { pageId },
  getDiagnostics: {
    pageId,
    nodeId: nodeId.optional(),
    severity: z.enum(['error', 'warning']).optional(),
    limit: z.number().int().min(1).max(1_000).default(200),
  },
  renderPreview: renderPreviewInput,
  getLayoutSnapshot: {
    pageId,
    nodeIds: z.array(nodeId).max(500).optional(),
    includeComputedStyles: z.boolean().default(true),
    maxInstances: z.number().int().min(1).max(5_000).default(1_000),
  },
  capturePreview: capturePreviewInput,
  history: {
    pageId,
    expectedRevision: z.number().int().nonnegative(),
  },
  importDesignPlan: {
    pageId,
    expectedRevision: z.number().int().nonnegative(),
    planId: z.string().min(1).max(128).optional(),
    phase: z.enum(['geometry', 'content', 'styling', 'correction', 'final']).default('geometry'),
    source: z
      .object({
        name: z.string().min(1).max(255),
        width: z.number().int().min(240).max(4_096).optional(),
        height: z.number().int().min(200).max(4_096).optional(),
        mimeType: z.string().max(100).optional(),
      })
      .superRefine((value, context) => {
        if ((value.width === undefined) !== (value.height === undefined)) {
          context.addIssue({
            code: 'custom',
            message: 'Source width and height must be supplied together.',
          });
        }
      })
      .strict(),
    requiredRegions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            label: z.string().min(1).max(255),
            expectedInstances: z.number().int().min(1).max(10_000).default(1),
            nodeIds: z.array(nodeId).max(500).default([]),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    acceptance: z
      .object({
        exactViewport: z.boolean().default(true),
        noHorizontalOverflow: z.boolean().default(true),
        allRegionsVisible: z.boolean().default(true),
      })
      .strict()
      .default({
        exactViewport: true,
        noHorizontalOverflow: true,
        allRegionsVisible: true,
      }),
    assumptions: z.array(z.string().max(500)).max(100).default([]),
    operations: z.array(sutraOperation).min(1).max(1_000),
  },
  importDesignImage: {
    pageId,
    expectedRevision: z.number().int().nonnegative(),
    source: z.record(z.string(), z.unknown()),
    assumptions: z.array(z.string().max(500)).max(100).default([]),
    operations: z.array(z.record(z.string(), z.unknown())).min(1).max(1_000),
  },
} as const;

export type ToolInputs = typeof toolInputs;
