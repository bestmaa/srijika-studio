# UI document format

`UiDocument` is Srijika's normalized, versioned renderer IR. In the code-first architecture it is compiled from the file ending in the resolved UI suffix (canonical default `.ui.tsx`) and is **not** the persisted authoring source. Source offsets live in the compiler's separate `SrijikaSourceMap`; Studio keeps the last valid document only as a derived preview/read model. Legacy engine and migration tests may still serialize this schema.

Child relationships live only in element slots or structural-node child arrays; `parentId` is derived so the graph cannot contain two competing parent relationships.

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
- equality, comparison, boolean, nullish-coalescing, and arithmetic binary operations;
- conditional expression;
- interpolated template; or
- custom module/export reference for a future connector extension.

Runtime values and application logic enter generated components through declared page props and are consumed through stable symbol references. The runtime evaluator does not use `eval`. Custom module/export references remain intentionally inert until a connector implementation is available; a custom code reference is not arbitrary JavaScript embedded in the JSON.

Current inference deliberately uses coarse array/object/unknown types. Public object and array props, including event payloads, may define recursive JSON-shaped fields. Generics, multiple positional function arguments, callback return values, and API payload schemas belong to later type-system work.

## Symbols and public props

Bindings point to stable symbol IDs instead of display-name strings. Renaming display metadata therefore does not rewrite every expression. Version 1 declares providers for props, events, repeat items/indexes, state, routes, resources, and action outputs; the UI MVP creates and edits public-prop/event and repeater symbols. The remaining providers are reserved for later state, API, and business-logic phases.

A public prop and its canonical symbol must agree on name, type, requiredness, and symbol ID. Removing a public prop is rejected while an expression still references it.

### Event signatures

An `event` public prop is a callback boundary, not a data-format conversion. Its version 1 signature has either no payload or one normalized, typed payload:

- Button `onClick` emits no payload and binds to `() => void`.
- Input `onChange` emits its current text value and binds to `(value: string) => void`.
- Object and array payloads use the same recursive value-shape model as data props.

The return type is intentionally `void` because UI rendering does not consume a handler's return value. A handler may still perform asynchronous work; future result-bearing workflows belong to action-output or resource symbols instead of an event callback return value. Browser-specific React event objects are not exposed through the connector boundary.

The Studio may convert an unbound public prop between `event` and a data type. A conversion or payload edit that would invalidate an existing component binding is rejected atomically, so the current type, signature, and binding remain unchanged.

### Event actions and argument mapping

An element keeps its callback target in `events[eventName]`. When that callback accepts a payload, the optional `eventArguments[eventName]` selects the actual value passed to it:

- `{ "kind": "eventPayload" }` forwards the component's normalized emitted value, such as an Input's current string value.
- `{ "kind": "expression", "expression": ... }` passes a literal or document expression, such as the number `5` or a compatible page prop.

This allows a no-payload Button click to invoke `(count: number) => void` with a mapped literal while keeping the Button's browser mouse event private. New bindings persist their argument mode explicitly. For backward compatibility, a format-1 binding with no `eventArguments` entry retains the earlier automatic behavior: callbacks with no payload receive no arguments, while compatible payload callbacks receive the component's normalized value.

The handler and its argument mapping are one atomic document change. Removing the handler also removes its mapping, and incompatible literals, page props, emitted payloads, or orphan mappings fail validation without partially changing the document.

## Styles and classes

An element stores instance styles as structured values. Lengths retain intent (`fixed`, `percent`, `fill`, `hug`, or `auto`) instead of being inferred from design-surface pixels. The schema represents base styles, responsive breakpoints, and hover/focus/disabled states. Exact source-frame geometry belongs in `base`; named `mobile` (≤639px), `tablet` (≤1023px), `desktop` (≥1024px), and `wide` (≥1440px) entries hold only overrides. At mobile widths the tablet rule is applied before mobile, and at wide widths desktop is applied before wide, so the narrower/more-specific rule wins without cloning the component tree.

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
