# UI document format

`UiDocument` is a normalized, versioned, JSON-serializable graph designed to preserve JSX semantics without storing source-code offsets. Child relationships live only in element slots or structural-node child arrays; `parentId` is derived so the document cannot contain two competing parent relationships.

## Version 1 envelope

```json
{
  "formatVersion": 1,
  "id": "page_home",
  "kind": "page",
  "name": "Home",
  "rootNodeId": "root",
  "revision": 0,
  "nodes": {},
  "symbols": {},
  "publicProps": {}
}
```

`kind` is `page` or `component`. Node IDs are stable graph keys. A node's embedded `id` must match its key, every reachable child must exist exactly once, and every document must have a valid root.

## Node kinds

- `element`: registered React component, including component/version IDs, expressions for props/events/visibility, named slots, class references, and styles;
- `text`: static or bound text expression;
- `expression`: a dynamic value rendered as content;
- `fragment`: JSX fragment with children;
- `if`: typed condition with separate `whenTrue` and `whenFalse` child arrays;
- `repeat`: typed collection template with item/index scope symbol IDs and children; and
- `slot`: reusable-component outlet with fallback children.

Core visual components currently registered are Page, Container, Stack, Grid, Text, Heading, Button, and Input. `fragment`, `if`, `repeat`, and `slot` are structural AST nodes rather than component manifests.

## Values and expressions

Literal values support JSON strings, numbers, booleans, `null`, arrays, and objects. The coarse value-type vocabulary is `string`, `number`, `boolean`, `color`, `event`, `array`, `object`, and `unknown`.

Expressions are tagged data:

- literal;
- stable symbol reference plus safe path segments;
- unary `not` or numeric negation;
- equality, comparison, boolean, and arithmetic binary operations;
- conditional expression;
- interpolated template;
- registered typed function call; or
- custom module/export reference for an advanced extension.

The runtime evaluator does not use `eval`. Registered and custom calls whose implementations are unavailable remain unresolved; a custom code reference is not arbitrary JavaScript embedded in the JSON.

Current inference deliberately uses coarse array/object/unknown types. Nested structural types, generics, function argument signatures, and API payload schemas belong to later type-system work.

## Symbols and public props

Bindings point to stable symbol IDs instead of display-name strings. Renaming display metadata therefore does not rewrite every expression. Version 1 declares providers for props, events, repeat items/indexes, state, routes, resources, and action outputs; the UI MVP creates and edits public-prop/event and repeater symbols. The remaining providers are reserved for later state, API, and business-logic phases.

A public prop and its canonical symbol must agree on name, type, requiredness, and symbol ID. Removing a public prop is rejected while an expression still references it.

## Styles and classes

An element stores instance styles as structured values. Lengths retain intent (`fixed`, `percent`, `fill`, `hug`, or `auto`) instead of being inferred from design-surface pixels. The schema can represent base styles, responsive breakpoints, and hover/focus/disabled states; the MVP Inspector edits the supported base-style subset.

`classRefs` are persisted and emitted into runtime/generated markup. A project-wide registry that defines reusable classes, variants, and design tokens does not yet exist. Until that registry is implemented, class names must refer to CSS supplied by the generated project or built-in component styles.

Studio selection outlines, drop targets, panel layout, viewport, and active `If` branch are never persisted into generated UI JSON.

## Validation layers

1. TypeBox/Ajv validates the JSON shape and forbids unknown fields where the schema is closed.
2. The document engine validates graph reachability, ownership, and structural invariants.
3. The component semantic analyzer validates registry versions, props, events, slots, symbol references, conditions, repeat sources, and public-prop synchronization.
4. The Rust persistence boundary independently validates the stable envelope, absolute `.json` path, node identity, root presence, and size before file I/O.

Rust does not duplicate every TypeScript AST field; a loaded document still passes the full TypeScript and semantic validation before entering the editor.

## Canonical output, code generation, and migration

The JSON panel serializes the current canonical document. The TSX generator produces deterministic React/TypeScript for the core component set and structural nodes. It fails explicitly if an unknown component lacks a code-generation adapter; it does not silently replace that component with a `div`.

Only format version 1 is accepted today. Before a version 2 format is introduced, an explicit, tested `v1 → v2` migration must be added. Readers must not silently discard unknown data.
