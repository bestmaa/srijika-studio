import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const FORMAT_VERSION = 1 as const;

export const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z][A-Za-z0-9_-]*$',
});

export const JavaScriptIdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$',
});

// Component identifiers are namespaced registry keys (for example `sutra.button`).
// They intentionally have a different grammar from JavaScript/public identifiers.
export const ComponentIdSchema = Type.String({
  minLength: 1,
  maxLength: 192,
  pattern: '^[A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z][A-Za-z0-9_-]*)+$',
});

export const NodeIdSchema = Type.String({ minLength: 1, maxLength: 128 });
export const SymbolIdSchema = Type.String({ minLength: 1, maxLength: 128 });

export const ValueTypeSchema = Type.Union([
  Type.Literal('string'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('color'),
  Type.Literal('event'),
  Type.Literal('array'),
  Type.Literal('object'),
  Type.Literal('unknown'),
]);

/**
 * Optional structural information for values whose top-level ValueType is not
 * precise enough on its own (notably object and array page props). Documents
 * created before this descriptor existed remain valid because declarations
 * reference it through an optional field.
 */
export const ValueShapeSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Object({ kind: Type.Literal('string') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('number') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('boolean') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('color') }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal('unknown') }, { additionalProperties: false }),
      Type.Object(
        {
          kind: Type.Literal('array'),
          item: Self,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('object'),
          fields: Type.Record(
            JavaScriptIdentifierSchema,
            Type.Object(
              {
                required: Type.Boolean(),
                shape: Self,
              },
              { additionalProperties: false },
            ),
          ),
          additionalProperties: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ]),
  { $id: 'ValueShape' },
);

export const EventSignatureSchema = Type.Object(
  {
    payload: Type.Union([
      Type.Null(),
      Type.Object(
        {
          name: JavaScriptIdentifierSchema,
          shape: Type.Ref(ValueShapeSchema),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);

/**
 * Data-only prop metadata owned by one element instance. These declarations
 * let the editor safely persist additional React/DOM props without changing a
 * component's registry manifest. Event callbacks deliberately cannot be
 * represented here; addable callbacks use InstanceEventSpec instead.
 */
export const InstancePropValueTypeSchema = Type.Union([
  Type.Literal('string'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('color'),
  Type.Literal('array'),
  Type.Literal('object'),
  Type.Literal('unknown'),
]);

export const InstancePropSpecSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1 }),
    type: InstancePropValueTypeSchema,
    required: Type.Boolean(),
    valueShape: Type.Optional(Type.Ref(ValueShapeSchema)),
  },
  { additionalProperties: false },
);

/**
 * A finite adapter catalog keeps native browser event objects out of the
 * canonical document. Renderers normalize an approved source to the payload
 * declared by its canonical signature.
 */
export const NormalizedEventSourceSchema = Type.Union([
  Type.Literal('click'),
  Type.Literal('doubleClick'),
  Type.Literal('mouseEnter'),
  Type.Literal('mouseLeave'),
  Type.Literal('focus'),
  Type.Literal('blur'),
  Type.Literal('keyDown'),
  Type.Literal('valueChange'),
  Type.Literal('valueInput'),
  Type.Literal('submit'),
]);

export const InstanceEventSpecSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1 }),
    source: NormalizedEventSourceSchema,
    signature: EventSignatureSchema,
  },
  { additionalProperties: false },
);

export const LiteralValueSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.String(),
      Type.Number(),
      Type.Boolean(),
      Type.Null(),
      Type.Array(Self),
      Type.Record(Type.String(), Self),
    ]),
  { $id: 'LiteralValue' },
);

export const ValueExpressionSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Object(
        {
          kind: Type.Literal('literal'),
          value: Type.Ref(LiteralValueSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('reference'),
          symbolId: SymbolIdSchema,
          path: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('unary'),
          operator: Type.Union([Type.Literal('not'), Type.Literal('negate')]),
          operand: Self,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('binary'),
          operator: Type.Union([
            Type.Literal('equals'),
            Type.Literal('notEquals'),
            Type.Literal('greaterThan'),
            Type.Literal('greaterThanOrEqual'),
            Type.Literal('lessThan'),
            Type.Literal('lessThanOrEqual'),
            Type.Literal('and'),
            Type.Literal('or'),
            Type.Literal('add'),
            Type.Literal('subtract'),
            Type.Literal('multiply'),
            Type.Literal('divide'),
          ]),
          left: Self,
          right: Self,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('conditional'),
          condition: Self,
          whenTrue: Self,
          whenFalse: Self,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('template'),
          parts: Type.Array(Type.Union([Type.String(), Self])),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('customCodeReference'),
          moduleId: IdentifierSchema,
          exportName: JavaScriptIdentifierSchema,
          args: Type.Array(Self),
        },
        { additionalProperties: false },
      ),
    ]),
  { $id: 'ValueExpression' },
);

/**
 * Maps the optional, single payload accepted by a bound page event.
 *
 * `eventPayload` forwards the normalized payload emitted by the component.
 * `expression` supplies a document value expression, including literals and
 * references to public page props.
 */
export const EventArgumentMappingSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('eventPayload'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('expression'),
      expression: Type.Ref(ValueExpressionSchema),
    },
    { additionalProperties: false },
  ),
]);

export const LengthSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal('fixed'),
      value: Type.Number({ minimum: 0 }),
      unit: Type.Union([Type.Literal('px'), Type.Literal('rem')]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal('percent'),
      value: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ mode: Type.Literal('fill') }, { additionalProperties: false }),
  Type.Object({ mode: Type.Literal('hug') }, { additionalProperties: false }),
  Type.Object({ mode: Type.Literal('auto') }, { additionalProperties: false }),
]);

export const SpacingSchema = Type.Object(
  {
    top: Type.Number(),
    right: Type.Number(),
    bottom: Type.Number(),
    left: Type.Number(),
  },
  { additionalProperties: false },
);

export const StylePropertiesSchema = Type.Partial(
  Type.Object(
    {
      display: Type.Union([
        Type.Literal('block'),
        Type.Literal('flex'),
        Type.Literal('grid'),
        Type.Literal('none'),
      ]),
      flexDirection: Type.Union([Type.Literal('row'), Type.Literal('column')]),
      flexWrap: Type.Union([
        Type.Literal('nowrap'),
        Type.Literal('wrap'),
        Type.Literal('wrap-reverse'),
      ]),
      flexGrow: Type.Number({ minimum: 0 }),
      flexShrink: Type.Number({ minimum: 0 }),
      flexBasis: LengthSchema,
      order: Type.Integer(),
      alignItems: Type.Union([
        Type.Literal('stretch'),
        Type.Literal('start'),
        Type.Literal('center'),
        Type.Literal('end'),
      ]),
      alignContent: Type.Union([
        Type.Literal('stretch'),
        Type.Literal('start'),
        Type.Literal('center'),
        Type.Literal('end'),
        Type.Literal('space-between'),
        Type.Literal('space-around'),
        Type.Literal('space-evenly'),
      ]),
      justifyContent: Type.Union([
        Type.Literal('start'),
        Type.Literal('center'),
        Type.Literal('end'),
        Type.Literal('space-between'),
        Type.Literal('space-around'),
        Type.Literal('space-evenly'),
      ]),
      alignSelf: Type.Union([
        Type.Literal('auto'),
        Type.Literal('stretch'),
        Type.Literal('start'),
        Type.Literal('center'),
        Type.Literal('end'),
      ]),
      justifySelf: Type.Union([
        Type.Literal('auto'),
        Type.Literal('stretch'),
        Type.Literal('start'),
        Type.Literal('center'),
        Type.Literal('end'),
      ]),
      placeItems: Type.Union([
        Type.Literal('stretch'),
        Type.Literal('start'),
        Type.Literal('center'),
        Type.Literal('end'),
      ]),
      gridTemplateColumns: Type.String(),
      gridTemplateRows: Type.String(),
      gridColumn: Type.String(),
      gridRow: Type.String(),
      width: LengthSchema,
      height: LengthSchema,
      minWidth: Type.Number({ minimum: 0 }),
      maxWidth: Type.Number({ minimum: 0 }),
      minHeight: Type.Number({ minimum: 0 }),
      maxHeight: Type.Number({ minimum: 0 }),
      gap: Type.Number({ minimum: 0 }),
      rowGap: Type.Number({ minimum: 0 }),
      columnGap: Type.Number({ minimum: 0 }),
      padding: SpacingSchema,
      margin: SpacingSchema,
      backgroundColor: Type.String(),
      backgroundImage: Type.String(),
      backgroundSize: Type.String(),
      backgroundPosition: Type.String(),
      backgroundRepeat: Type.Union([
        Type.Literal('repeat'),
        Type.Literal('repeat-x'),
        Type.Literal('repeat-y'),
        Type.Literal('no-repeat'),
        Type.Literal('space'),
        Type.Literal('round'),
      ]),
      color: Type.String(),
      borderColor: Type.String(),
      borderWidth: Type.Number({ minimum: 0 }),
      borderStyle: Type.Union([
        Type.Literal('none'),
        Type.Literal('solid'),
        Type.Literal('dashed'),
        Type.Literal('dotted'),
        Type.Literal('double'),
      ]),
      borderRadius: Type.Number({ minimum: 0 }),
      boxShadow: Type.String(),
      opacity: Type.Number({ minimum: 0, maximum: 1 }),
      cursor: Type.Union([
        Type.Literal('auto'),
        Type.Literal('default'),
        Type.Literal('pointer'),
        Type.Literal('text'),
        Type.Literal('grab'),
        Type.Literal('not-allowed'),
      ]),
      position: Type.Union([
        Type.Literal('static'),
        Type.Literal('relative'),
        Type.Literal('absolute'),
        Type.Literal('sticky'),
        Type.Literal('fixed'),
      ]),
      top: Type.Number(),
      right: Type.Number(),
      bottom: Type.Number(),
      left: Type.Number(),
      zIndex: Type.Integer(),
      aspectRatio: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.String()]),
      objectFit: Type.Union([
        Type.Literal('fill'),
        Type.Literal('contain'),
        Type.Literal('cover'),
        Type.Literal('none'),
        Type.Literal('scale-down'),
      ]),
      objectPosition: Type.String(),
      fontSize: Type.Number({ minimum: 1 }),
      fontWeight: Type.Number({ minimum: 100, maximum: 900 }),
      fontFamily: Type.String(),
      fontStyle: Type.Union([
        Type.Literal('normal'),
        Type.Literal('italic'),
        Type.Literal('oblique'),
      ]),
      lineHeight: Type.Number({ minimum: 0 }),
      letterSpacing: Type.Number(),
      textAlign: Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')]),
      textTransform: Type.Union([
        Type.Literal('none'),
        Type.Literal('uppercase'),
        Type.Literal('lowercase'),
        Type.Literal('capitalize'),
      ]),
      textDecoration: Type.Union([
        Type.Literal('none'),
        Type.Literal('underline'),
        Type.Literal('line-through'),
        Type.Literal('overline'),
      ]),
      whiteSpace: Type.Union([
        Type.Literal('normal'),
        Type.Literal('nowrap'),
        Type.Literal('pre-wrap'),
      ]),
      textOverflow: Type.Union([Type.Literal('clip'), Type.Literal('ellipsis')]),
      overflowWrap: Type.Union([
        Type.Literal('normal'),
        Type.Literal('break-word'),
        Type.Literal('anywhere'),
      ]),
      overflow: Type.Union([Type.Literal('visible'), Type.Literal('hidden'), Type.Literal('auto')]),
      overflowX: Type.Union([
        Type.Literal('visible'),
        Type.Literal('hidden'),
        Type.Literal('auto'),
      ]),
      overflowY: Type.Union([
        Type.Literal('visible'),
        Type.Literal('hidden'),
        Type.Literal('auto'),
      ]),
      transform: Type.String(),
      transformOrigin: Type.String(),
      filter: Type.String(),
      backdropFilter: Type.String(),
      pointerEvents: Type.Union([Type.Literal('auto'), Type.Literal('none')]),
      visibility: Type.Union([
        Type.Literal('visible'),
        Type.Literal('hidden'),
        Type.Literal('collapse'),
      ]),
    },
    { additionalProperties: false },
  ),
);

export const StyleDeclarationSchema = Type.Object(
  {
    base: StylePropertiesSchema,
    breakpoints: Type.Optional(Type.Record(Type.String(), StylePropertiesSchema)),
    states: Type.Optional(
      Type.Partial(
        Type.Object({
          hover: StylePropertiesSchema,
          focus: StylePropertiesSchema,
          disabled: StylePropertiesSchema,
        }),
      ),
    ),
  },
  { additionalProperties: false },
);

export const ElementNodeSchema = Type.Object(
  {
    kind: Type.Literal('element'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    componentId: ComponentIdSchema,
    componentVersion: Type.Integer({ minimum: 1 }),
    props: Type.Record(Type.String(), Type.Ref(ValueExpressionSchema)),
    events: Type.Record(Type.String(), Type.Ref(ValueExpressionSchema)),
    eventArguments: Type.Optional(Type.Record(Type.String(), EventArgumentMappingSchema)),
    instanceProps: Type.Optional(Type.Record(Type.String(), InstancePropSpecSchema)),
    instanceEvents: Type.Optional(Type.Record(Type.String(), InstanceEventSpecSchema)),
    slots: Type.Record(Type.String(), Type.Array(NodeIdSchema)),
    classRefs: Type.Array(Type.String()),
    style: StyleDeclarationSchema,
    visible: Type.Ref(ValueExpressionSchema),
    locked: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const TextNodeSchema = Type.Object(
  {
    kind: Type.Literal('text'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    value: Type.Ref(ValueExpressionSchema),
  },
  { additionalProperties: false },
);

export const ExpressionNodeSchema = Type.Object(
  {
    kind: Type.Literal('expression'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    expression: Type.Ref(ValueExpressionSchema),
  },
  { additionalProperties: false },
);

export const FragmentNodeSchema = Type.Object(
  {
    kind: Type.Literal('fragment'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    children: Type.Array(NodeIdSchema),
  },
  { additionalProperties: false },
);

export const IfNodeSchema = Type.Object(
  {
    kind: Type.Literal('if'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    condition: Type.Ref(ValueExpressionSchema),
    whenTrue: Type.Array(NodeIdSchema),
    whenFalse: Type.Array(NodeIdSchema),
  },
  { additionalProperties: false },
);

export const RepeatNodeSchema = Type.Object(
  {
    kind: Type.Literal('repeat'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    source: Type.Ref(ValueExpressionSchema),
    itemSymbolId: SymbolIdSchema,
    indexSymbolId: SymbolIdSchema,
    children: Type.Array(NodeIdSchema),
  },
  { additionalProperties: false },
);

export const SlotNodeSchema = Type.Object(
  {
    kind: Type.Literal('slot'),
    id: NodeIdSchema,
    name: Type.String({ minLength: 1 }),
    slotName: IdentifierSchema,
    fallback: Type.Array(NodeIdSchema),
  },
  { additionalProperties: false },
);

export const UiNodeSchema = Type.Union([
  ElementNodeSchema,
  TextNodeSchema,
  ExpressionNodeSchema,
  FragmentNodeSchema,
  IfNodeSchema,
  RepeatNodeSchema,
  SlotNodeSchema,
]);

export const SymbolDeclarationSchema = Type.Object(
  {
    id: SymbolIdSchema,
    name: JavaScriptIdentifierSchema,
    displayName: Type.String(),
    provider: Type.Union([
      Type.Literal('prop'),
      Type.Literal('event'),
      Type.Literal('repeatItem'),
      Type.Literal('repeatIndex'),
      Type.Literal('state'),
      Type.Literal('route'),
      Type.Literal('resource'),
      Type.Literal('actionOutput'),
    ]),
    valueType: ValueTypeSchema,
    valueShape: Type.Optional(Type.Ref(ValueShapeSchema)),
    eventSignature: Type.Optional(EventSignatureSchema),
    required: Type.Boolean(),
    defaultValue: Type.Optional(Type.Ref(LiteralValueSchema)),
  },
  { additionalProperties: false },
);

export const PublicPropSchema = Type.Object(
  {
    symbolId: SymbolIdSchema,
    name: JavaScriptIdentifierSchema,
    displayName: Type.String(),
    valueType: ValueTypeSchema,
    valueShape: Type.Optional(Type.Ref(ValueShapeSchema)),
    eventSignature: Type.Optional(EventSignatureSchema),
    required: Type.Boolean(),
    defaultValue: Type.Optional(Type.Ref(LiteralValueSchema)),
  },
  { additionalProperties: false },
);

export const UiDocumentSchema = Type.Object(
  {
    formatVersion: Type.Literal(FORMAT_VERSION),
    id: IdentifierSchema,
    kind: Type.Union([Type.Literal('page'), Type.Literal('component')]),
    name: Type.String({ minLength: 1 }),
    rootNodeId: NodeIdSchema,
    revision: Type.Integer({ minimum: 0 }),
    nodes: Type.Record(Type.String(), UiNodeSchema),
    symbols: Type.Record(Type.String(), SymbolDeclarationSchema),
    publicProps: Type.Record(Type.String(), PublicPropSchema),
  },
  { additionalProperties: false },
);

export const SutraProjectSchema = Type.Object(
  {
    formatVersion: Type.Literal(1),
    id: IdentifierSchema,
    name: Type.String({ minLength: 1 }),
    entryPageId: IdentifierSchema,
    pages: Type.Array(IdentifierSchema),
    components: Type.Array(IdentifierSchema),
    toolchain: Type.Object(
      {
        node: Type.String(),
        packageManager: Type.Literal('pnpm'),
        packageManagerVersion: Type.String(),
        vite: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type ValueType = Static<typeof ValueTypeSchema>;
export type ValueShape = Static<typeof ValueShapeSchema>;
export type EventSignature = Static<typeof EventSignatureSchema>;
export type InstancePropValueType = Static<typeof InstancePropValueTypeSchema>;
export type InstancePropSpec = Static<typeof InstancePropSpecSchema>;
export type NormalizedEventSource = Static<typeof NormalizedEventSourceSchema>;
export type InstanceEventSpec = Static<typeof InstanceEventSpecSchema>;
export type ComponentId = Static<typeof ComponentIdSchema>;
export type JavaScriptIdentifier = Static<typeof JavaScriptIdentifierSchema>;
export type LiteralValue = Static<typeof LiteralValueSchema>;
export type ValueExpression = Static<typeof ValueExpressionSchema>;
export type EventArgumentMapping = Static<typeof EventArgumentMappingSchema>;
export type LengthValue = Static<typeof LengthSchema>;
export type Spacing = Static<typeof SpacingSchema>;
export type StyleProperties = Static<typeof StylePropertiesSchema>;
export type StyleDeclaration = Static<typeof StyleDeclarationSchema>;
export type ElementNode = Static<typeof ElementNodeSchema>;
export type TextNode = Static<typeof TextNodeSchema>;
export type ExpressionNode = Static<typeof ExpressionNodeSchema>;
export type FragmentNode = Static<typeof FragmentNodeSchema>;
export type IfNode = Static<typeof IfNodeSchema>;
export type RepeatNode = Static<typeof RepeatNodeSchema>;
export type SlotNode = Static<typeof SlotNodeSchema>;
export type UiNode = Static<typeof UiNodeSchema>;
export type SymbolDeclaration = Static<typeof SymbolDeclarationSchema>;
export type PublicProp = Static<typeof PublicPropSchema>;
export type UiDocument = Static<typeof UiDocumentSchema>;
export type SutraProject = Static<typeof SutraProjectSchema>;

export type SchemaType<T extends TSchema> = Static<T>;
