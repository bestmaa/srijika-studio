# Protocol and tools

## Contents

- Connection contract
- Read tools
- Write tools
- Responsive and Repeat examples
- Batch example
- Structured failures

## Connection contract

Start with `sutra_get_capabilities`. Protocol `1.0` is the initial contract. Every response includes enough version and revision information to reject stale writes. Tool schemas are additive within a minor tool release; breaking payload changes require an adapter or a new protocol version.

The Studio desktop process owns the canonical document. The MCP server is a thin authenticated client and does not keep a second mutable copy.

## Read tools

| Tool                          | Use                                                                        |
| ----------------------------- | -------------------------------------------------------------------------- |
| `sutra_get_capabilities`      | Negotiate versions, operations, limits, and deprecated aliases.            |
| `sutra_get_project_summary`   | Read pages, active IDs, counts, and revisions.                             |
| `sutra_get_page_outline`      | Read a compact hierarchy with stable node IDs.                             |
| `sutra_get_node`              | Read one node, parent location, bindings, style keys, and children.        |
| `sutra_get_component_catalog` | Discover registered components, props, events, slots, and editor behavior. |
| `sutra_analyze_repetitions`   | Find deterministic contiguous repeated-sibling candidates without writing. |
| `sutra_get_generated_code`    | Inspect compact typed-prop/Repeat codegen evidence or explicit full TSX.   |
| `sutra_validate_document`     | Run schema, graph, registry, and semantic validation.                      |
| `sutra_get_diagnostics`       | Filter actionable errors and warnings.                                     |
| `sutra_render_preview`        | Focus the requested page/viewport and report a render-ready snapshot.      |
| `sutra_get_layout_snapshot`   | Measure rendered node instances, computed layout, clipping, and overflow.  |
| `sutra_capture_preview`       | Return a clean PNG at a preset or exact custom viewport.                   |

Use component catalog `summary` mode for discovery. Use `detail: "manifest"` with a short `ids` list to obtain prop types, defaults, options, event signatures, slot constraints, and editor behavior without spending tokens on unrelated components.

## Write tools

`sutra_apply_operations` applies a batch atomically. Supply the exact `expectedRevision`; the batch either produces one new revision or leaves the document unchanged.

Supported operation kinds:

- `insertComponent`
- `insertText`
- `insertIf`
- `insertRepeat`
- `moveNode`
- `removeNode`
- `renameNode`
- `setProp`
- `setStyle`
- `setEventBinding`
- `addPublicProp`
- `convertRepeatedSiblings`
- `replaceDocument`

`sutra_import_design_plan` uses the same atomic executor and adds source/plan context. When source width and height are supplied, Studio adopts that exact custom viewport. `sutra_undo` and `sutra_redo` operate on Studio history.

## Responsive and Repeat examples

Write source-frame styles to `style.base` by omitting `breakpoint`. Supply a canonical breakpoint key to update the same node without cloning its tree:

```json
{
  "kind": "setStyle",
  "operationId": "cards-mobile",
  "nodeId": "cards-grid",
  "breakpoint": "mobile",
  "style": {
    "gridTemplateColumns": "1fr",
    "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 }
  }
}
```

Canonical named keys are `mobile`, `tablet`, `desktop`, and `wide`. The renderer cascades matching rules from broad to specific, then applies dynamic style bindings last. Use `min:<width>` or `max:<width>` only when the named matrix cannot express the design.

For existing duplicate siblings, first call `sutra_analyze_repetitions` with the current page ID and `includeValues: false`. Review the returned parent, ordered sibling IDs, confidence, template kind/depth, and differing literal field locators/shapes. Request values only for the reviewed `candidateId`, then convert that exact candidate at the same revision:

```json
{
  "kind": "convertRepeatedSiblings",
  "operationId": "normalize-message-rows",
  "candidateId": "candidate-returned-by-analysis",
  "propName": "messages",
  "propDisplayName": "Messages",
  "repeatName": "Message rows"
}
```

The conversion creates a typed array page prop whose default value contains the current rows, keeps one template subtree, and replaces the siblings with one Repeat node. Re-run validation and compare rendered instance count/order before accepting it. If the page revision changed after analysis, fetch a fresh candidate instead of retrying the stale ID.

Use `sutra_get_generated_code` with `{ "pageId": "...", "detail": "summary" }` after conversion. The compact result reports the public-prop interface, prop type/default metadata, structure counts, and Repeat `.map(...)` signatures without returning the entire file. Use `detail: "full"` only when exact emitted TSX must be inspected.

`sutra_render_preview` and `sutra_capture_preview` expose `desktop` (1180 × 820), `tablet` (768 × 1024), and `mobile` (390 × 844) presets. For a wide check, use `viewport: "desktop"` and provide both `width` and `height` (for example 1440 × 1000). Always provide custom width and height together. In layout results, document overflow passes when `viewport.scrollWidth <= viewport.actual.width + 1`; do not compare against a nonexistent top-level `clientWidth`.

## Batch example

Use the component catalog to confirm IDs and slot names before adapting this shape:

```json
{
  "expectedRevision": 7,
  "operations": [
    {
      "kind": "insertComponent",
      "operationId": "hero-shell",
      "parentId": "root",
      "slot": "children",
      "componentId": "sutra.container",
      "name": "Hero",
      "style": {
        "display": "flex",
        "flexDirection": "column",
        "gap": 16
      }
    },
    {
      "kind": "insertText",
      "operationId": "hero-title",
      "parentId": { "createdBy": "hero-shell" },
      "slot": "children",
      "name": "Hero title",
      "value": { "kind": "literal", "value": "Build visually" }
    }
  ]
}
```

`createdBy` may point only to an operation that appears earlier in the same batch. It works for parent and target node references, so a complete nested region can be created and styled atomically without intermediate ID reads. The response still returns `createdIds` for later batches.

`createdIds[operationId]` is the created node ID. `insertRepeat` also returns `createdIds[operationId + ".itemSymbol"]` and `.indexSymbol`; `convertRepeatedSiblings` additionally returns `.propSymbol`, `.itemSymbol`, and `.indexSymbol`. `createdBy` resolves node references only—it cannot be placed inside `reference.symbolId`. If a later operation in the same batch must bind to a new Repeat symbol, provide explicit `item.id`/`indexSymbol.id` values in `insertRepeat` and reference those IDs directly.

## Structured failures

- `revision-conflict`: returned inside an atomic result's diagnostics; refetch and rebase, and do not retry unchanged.
- `graph-validation-failed` or `semantic-validation-failed`: inspect the following diagnostics and fix the payload.
- `component-not-found`: query the catalog and choose a registered ID.
- `node_not_found`: direct page/node lookup failed; refresh the outline because the hierarchy changed.
- `node-not-found`: an operation inside an atomic batch targeted a missing node.
- `studio_not_running`: start the desktop app and wait for bridge readiness.
- `bridge_timeout`: keep the intended batch, check Studio health, then retry only after confirming it was not applied.
- `unsupported_protocol_version`: stop writes and use the migration guidance.

Transport success and document acceptance are separate. MCP returns `structuredContent.ok: true` when the authenticated RPC completed; mutating and validation tools can still return `structuredContent.result.ok: false` with the diagnostics above.
