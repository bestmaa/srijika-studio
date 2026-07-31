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
          kind: Type.Literal('registeredCall'),
          functionId: IdentifierSchema,
          args: Type.Array(Self),
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
  Type.Object({
    display: Type.Union([
      Type.Literal('block'),
      Type.Literal('flex'),
      Type.Literal('grid'),
      Type.Literal('none'),
    ]),
    flexDirection: Type.Union([Type.Literal('row'), Type.Literal('column')]),
    alignItems: Type.Union([
      Type.Literal('stretch'),
      Type.Literal('start'),
      Type.Literal('center'),
      Type.Literal('end'),
    ]),
    justifyContent: Type.Union([
      Type.Literal('start'),
      Type.Literal('center'),
      Type.Literal('end'),
      Type.Literal('space-between'),
    ]),
    width: LengthSchema,
    height: LengthSchema,
    minWidth: Type.Number({ minimum: 0 }),
    maxWidth: Type.Number({ minimum: 0 }),
    minHeight: Type.Number({ minimum: 0 }),
    maxHeight: Type.Number({ minimum: 0 }),
    gap: Type.Number({ minimum: 0 }),
    padding: SpacingSchema,
    margin: SpacingSchema,
    backgroundColor: Type.String(),
    color: Type.String(),
    borderColor: Type.String(),
    borderWidth: Type.Number({ minimum: 0 }),
    borderRadius: Type.Number({ minimum: 0 }),
    fontSize: Type.Number({ minimum: 1 }),
    fontWeight: Type.Number({ minimum: 100, maximum: 900 }),
    textAlign: Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')]),
    overflowWrap: Type.Union([
      Type.Literal('normal'),
      Type.Literal('break-word'),
      Type.Literal('anywhere'),
    ]),
    overflow: Type.Union([Type.Literal('visible'), Type.Literal('hidden'), Type.Literal('auto')]),
  }),
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
export type ComponentId = Static<typeof ComponentIdSchema>;
export type JavaScriptIdentifier = Static<typeof JavaScriptIdentifierSchema>;
export type LiteralValue = Static<typeof LiteralValueSchema>;
export type ValueExpression = Static<typeof ValueExpressionSchema>;
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
