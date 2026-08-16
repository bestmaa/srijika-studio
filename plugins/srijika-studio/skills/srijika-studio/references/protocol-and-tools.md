# Protocol and tools

## Contents

- Connection contract
- Software-independent code-project tools
- React migration tools
- Read tools
- Write tools
- Responsive and Repeat examples
- Batch example
- Structured failures

## Connection contract

Choose the adapter from the request. For filesystem structure, CLI-first project validation, or scaffolding, start with `srijika_get_code_project`; these tools do not require Studio. For visual-document work in a running desktop app, start with `srijika_get_capabilities`. Protocol `1.0` is the initial bridge contract. Every bridge response includes enough version and revision information to reject stale writes. Tool schemas are additive within a minor tool release; breaking payload changes require an adapter or a new protocol version.

The Studio desktop process owns the canonical document. The MCP server is a thin authenticated client and does not keep a second mutable copy.

The plugin ships this server as a self-contained Node bundle, including the
TypeScript parser used for code-project inspection. Do not add bare runtime
imports that depend on repository-level `node_modules`; the isolated plugin
bundle smoke is the release boundary. Node.js `>=22.13.0` is required.

## Software-independent code-project tools

| Tool                           | Use                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `srijika_get_code_project`     | Inspect bounded metadata, scripts, files, and the strict architecture profile. |
| `srijika_check_code_project`   | Run the same architecture rules used by CLI, VS Code, and Studio.              |
| `srijika_plan_code_structure`  | Resolve an owner and return exact files/rewires without writing.               |
| `srijika_apply_code_structure` | Consume the reviewed one-time `planId` and apply atomically without overwrite. |

The MCP process is bounded to the project passed with `--project`. Never apply an
unreviewed plan, invent alternate owner folders, or reuse an already-consumed
`planId`.

An omitted `architecture` block uses defaults; an explicit block without exact
profile `feature-slot-part-v1` fails closed. Generated validation reloads current
config. CLI watch uses a filtered project-root watcher, reloads config before
each check, observes config/tsconfig/entry/resolved roots and future-root
ancestors, and recovers after temporarily invalid config. Studio/VS Code
exact-file plus safe-move previews come from the canonical planner. MCP clients
must preserve that behavior instead of emitting default paths themselves.

The complete config requires `sourceOfTruth: "tsx"`, a bounded configured entry,
and—when architecture exists—exact profile plus twelve root/directory/suffix
overrides. The entry stays authoritative and counted even outside ownership
roots. JSONC `tsconfig.json` paths are the custom alias authority: `extends` is
rejected, nonempty `references` are rejected (absent/empty is valid),
`compilerOptions.baseUrl` must be omitted, and only exact or slash-delimited
terminal `/*` aliases are accepted. Vite-only aliases are unsupported.
`SRIJIKA4119` blocks computed module targets and
`SRIJIKA4120` blocks unresolved declared/reserved project aliases.
`SRIJIKA4121` blocks governed relative or `src/...` source imports that are
missing, outside the configured roots, or absent from the complete scan;
CSS/static assets are exempt. Complete
validation and migration scans are symlink-safe and capped at 4,096 sources,
32,768 entries, 4,096 directories, depth 32, 4 MiB/source, and 24 MiB total.

For `srijika_plan_code_structure`, shared composite `kind` values are exactly
`shared-ui`, `shared-widget`, and `shared-capability`. Shared UI permits only
optional Types; Shared Widget requires UI + Connector and permits the normal
optional runtime chain; Shared Capability forbids UI/Connector and requires at
least one runtime layer. Review all derived paths just as for Feature, Slot, and
Part plans. Never emulate a shared plan with generic filesystem writes.

Read `srijika://docs/code-first-architecture` before interpreting a custom
architecture. It publishes the bounded roots/directories/suffixes contract,
strict UI external-runtime policy, passive Types rule, and `SRIJIKA4118`
framework-free Logic boundary. Reject traversal, overlap, duplicate canonical
names, and symlink escapes instead of reconstructing a different plan.

## React migration tools

Read `srijika://docs/react-migration` and
[react-project-migration.md](react-project-migration.md) before converting an
existing React project. The migration source is immutable and the target must
be distinct, non-overlapping, and new or a recognizable clean generated starter.

| Tool                                   | Use                                                                 |
| -------------------------------------- | ------------------------------------------------------------------- |
| `srijika_create_react_migration`       | Preflight roots, baseline source, scaffold target, persist session. |
| `srijika_scan_react_migration_source`  | Read the bounded source inventory without writing.                  |
| `srijika_get_react_migration_plan`     | Read reviewed slices, mappings, blockers, and gates.                |
| `srijika_get_react_migration_status`   | Resume the persisted target session.                                |
| `srijika_apply_react_migration_slice`  | Apply one reviewed atomic target-only slice.                        |
| `srijika_verify_react_migration_slice` | Verify one slice before continuing.                                 |
| `srijika_verify_react_migration`       | Run source, traceability, architecture, and command gates.          |
| `srijika_finalize_react_migration`     | Complete only when all current required evidence passes.            |

The engine inventories and guards the migration. Codex performs semantic slice
analysis and supplies reviewed target writes and source mappings. Unsupported
or ambiguous behavior is a blocker. Never describe these tools as an arbitrary
automatic rewrite or guaranteed zero-loss conversion.

Verification evidence names are `install`, `typecheck`, `build`, `test`,
`routes`, and `visual`. Typecheck, build, and test are always required and must
pass. Route files or `semanticRoutesPresent` require `routes` with status
`passed`; any entry, component, style, or
asset source requires `visual` with status `passed`. Slice verification also
rescans the immutable source baseline before marking the slice verified. Route
and visual entries require nonempty details naming the checked routes and
representative viewports. Visual details must name at least two of mobile,
tablet, desktop, and wide, or provide at least two `WxH` measurements. Duplicate
or oversized evidence is rejected.

## Read tools

| Tool                            | Use                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- |
| `srijika_get_capabilities`      | Negotiate versions, operations, limits, and deprecated aliases.            |
| `srijika_get_project_summary`   | Read pages, active IDs, counts, and revisions.                             |
| `srijika_get_page_outline`      | Read a compact hierarchy with stable node IDs.                             |
| `srijika_get_node`              | Read one node, parent location, bindings, style keys, and children.        |
| `srijika_get_component_catalog` | Discover registered components, props, events, slots, and editor behavior. |
| `srijika_analyze_repetitions`   | Find deterministic contiguous repeated-sibling candidates without writing. |
| `srijika_get_generated_code`    | Inspect compact typed-prop/Repeat codegen evidence or explicit full TSX.   |
| `srijika_validate_document`     | Run schema, graph, registry, and semantic validation.                      |
| `srijika_get_diagnostics`       | Filter actionable errors and warnings.                                     |
| `srijika_render_preview`        | Focus the requested page/viewport and report a render-ready snapshot.      |
| `srijika_get_layout_snapshot`   | Measure rendered node instances, computed layout, clipping, and overflow.  |
| `srijika_capture_preview`       | Return a clean PNG at a preset or exact custom viewport.                   |

Use component catalog `summary` mode for discovery. Use `detail: "manifest"` with a short `ids` list to obtain prop types, defaults, options, event signatures, slot constraints, and editor behavior without spending tokens on unrelated components.

## Write tools

`srijika_apply_operations` applies a batch atomically. Supply the exact `expectedRevision`; the batch either produces one new revision or leaves the document unchanged.

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

`srijika_import_design_plan` uses the same atomic executor and adds source/plan context. When source width and height are supplied, Studio adopts that exact custom viewport. `srijika_undo` and `srijika_redo` operate on Studio history.

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

For existing duplicate siblings, first call `srijika_analyze_repetitions` with the current page ID and `includeValues: false`. Review the returned parent, ordered sibling IDs, confidence, template kind/depth, and differing literal field locators/shapes. Request values only for the reviewed `candidateId`, then convert that exact candidate at the same revision:

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

Use `srijika_get_generated_code` with `{ "pageId": "...", "detail": "summary" }` after conversion. The compact result reports the public-prop interface, prop type/default metadata, structure counts, and Repeat `.map(...)` signatures without returning the entire file. Use `detail: "full"` only when exact emitted TSX must be inspected.

`srijika_render_preview` and `srijika_capture_preview` expose `desktop` (1180 × 820), `tablet` (768 × 1024), and `mobile` (390 × 844) presets. For a wide check, use `viewport: "desktop"` and provide both `width` and `height` (for example 1440 × 1000). Always provide custom width and height together. In layout results, document overflow passes when `viewport.scrollWidth <= viewport.actual.width + 1`; do not compare against a nonexistent top-level `clientWidth`.

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
      "componentId": "srijika.container",
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
