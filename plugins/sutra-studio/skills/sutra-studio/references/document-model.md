# Sutra document model

## Contents

- Source of truth
- Nodes and hierarchy
- Values and bindings
- Public props and events
- Styles
- Responsive and repeated structure
- Validation invariants

## Source of truth

Each page owns one canonical `UiDocument`. Generated TSX, the design canvas, hierarchy, inspector, preview, and MCP tools all derive from that document. Do not maintain parallel JSX or editor-only component trees.

The initial document format is `formatVersion: 1`. A document has `id`, `kind`, `name`, `rootNodeId`, `revision`, `nodes`, `symbols`, and `publicProps`.

## Nodes and hierarchy

Node kinds are `element`, `text`, `expression`, `fragment`, `if`, `repeat`, and `slot`.

- Element nodes reference a registered `componentId` and contain typed props, events, slots, class references, styles, visibility, and optional instance port definitions.
- Text and expression nodes render values.
- If nodes own `whenTrue` and `whenFalse` branches.
- Repeat nodes own an item symbol, index symbol, source expression, and children.
- A node has exactly one parent location unless it is the root.

Use stable IDs returned by write tools. Names are human labels and are not identifiers.

## Values and bindings

Values are structured expressions, not arbitrary code strings. Common forms are:

- `literal`: JSON-compatible static value.
- `reference`: a symbol plus a required `path` array; use `[]` for the symbol itself and ordered string segments for nested object fields.
- `unary`, `binary`, and `conditional`: safe expression composition.
- `template`: interpolated text parts.
- `customCodeReference`: an explicit connector reference with typed arguments when the schema permits it.

Do not create a global `runtimeFunctions` map. Application logic lives in user code and enters the UI through declared props/events or an explicit connector contract.

## Public props and events

Define a public prop before any node references its symbol. Keep its `valueType`, optional object/array shape, required flag, and default value consistent.

An event prop is a typed callback. Prefer a normalized payload such as a number, string, selected item, or input value instead of forwarding a native mouse event object. Bind component event ports to declared event symbols and map the expected argument explicitly.

## Styles

Static visual values belong in an element node's `style.base`. Breakpoints and states extend the same style declaration. Dynamic style input uses the validated Sutra style binding; the runtime accepts only a non-array object as React `CSSProperties`.

Keep the exact source-frame geometry in `style.base`, then add the smallest responsive overrides needed for other widths. Canonical named breakpoints are desktop-first:

- `mobile`: max width 639px
- `tablet`: max width 1023px
- `desktop`: min width 1024px
- `wide`: min width 1440px

`tablet` applies before `mobile` at a mobile width, and `desktop` applies before `wide` at a wide width. Numeric max-width keys plus explicit `min:*`, `max:*`, and CSS-style min/max-width keys are accepted for imported plans. Dynamic Sutra style props are applied after resolved document styles.

Do not show or emit fallback inspector values as applied styles. A style property is active only when it exists in the document.

## Responsive and repeated structure

A responsive page keeps one canonical component tree. Do not clone a desktop subtree for tablet or mobile; use breakpoint style overrides on the same stable node IDs.

Repeated siblings that share structure but differ only in literal content should become one `repeat` template backed by a typed array public prop. Store the current rows as that prop's default/design value, bind differing fields through the repeat item symbol, and verify that conversion preserves instance count, order, and bounds at the source viewport.

## Validation invariants

- The root exists, is locked for page identity, and fills the design surface.
- Every child ID exists and no child has two parents.
- The graph is acyclic and every node is reachable from the root.
- Component IDs, props, events, and slots match the registry or approved instance ports.
- References resolve to symbols visible in the current scope.
- Public prop types, shapes, defaults, and event signatures agree.
- Every accepted write passes schema, graph, and semantic validation before commit.
