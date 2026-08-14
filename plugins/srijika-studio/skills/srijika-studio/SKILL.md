---
name: srijika-studio
description: Build, inspect, edit, validate, debug, and preview React UI documents in a running Srijika Studio desktop application through its authenticated local MCP tools. Use when a user asks Codex to recreate an interface from an image, create or modify Srijika pages/components/props/styles/events, diagnose a Srijika AST or renderer problem, inspect hierarchy or generated UI, or operate the Srijika Studio application without manually dragging every element.
---

# Srijika Studio

Use the running Studio document engine as the only source of truth. Operate on stable node IDs and versioned JSON operations; never automate the editor by guessing DOM coordinates.

## Core workflow

1. Call `srijika_get_capabilities` once per connection. Stop and explain any unsupported protocol or document version.
2. Call `srijika_get_project_summary`, then request only the required outline, node, or catalog details.
3. Capture the active page `revision` immediately before a write.
4. Send related changes in one `srijika_apply_operations` batch with `expectedRevision` and distinct `operationId` values.
5. When `result.ok` is `false` and its diagnostics contain `revision-conflict`, read the latest summary/outline, rebase the intended operations, and retry once. Never replay a stale batch blindly.
6. Call `srijika_validate_document` and `srijika_get_diagnostics` after structural writes.
7. After Repeat conversion or binding changes, call `srijika_get_generated_code` in compact `summary` mode to verify typed props and React map signatures. Request `full` TSX only when exact emitted code is required.
8. Call `srijika_render_preview` at the intended dimensions, then `srijika_get_layout_snapshot` and `srijika_capture_preview` when visual fidelity matters. Never claim fidelity from the editor canvas alone.
9. For a responsive deliverable, keep the source frame as the base style, add breakpoint overrides to the same nodes, and repeat validation/layout/capture at mobile, tablet, desktop, and wide widths. Treat any horizontal document overflow as a failed check unless the named region intentionally scrolls.

Prefer one coherent batch over one tool call per CSS field. Split only when an intermediate node ID or validation result is needed.
Within a batch, use `{ "createdBy": "operation-id" }` for parents or target nodes created by an earlier operation instead of spending another read on generated IDs.

## Choose the smallest read

- Project/page discovery: `srijika_get_project_summary`
- Hierarchy and drop targets: `srijika_get_page_outline`
- Exact props, events, styles, or bindings: `srijika_get_node`
- Available components and allowed ports: `srijika_get_component_catalog` in `summary` mode; request `manifest` detail only for chosen component IDs.
- Repeated sibling candidates: `srijika_analyze_repetitions`; keep `includeValues: false` for discovery and request values only for a reviewed candidate.
- Generated React contract: `srijika_get_generated_code` with `detail: "summary"`; use `detail: "full"` only for exact TSX debugging.
- Validation failures: `srijika_get_diagnostics`
- Rendered geometry, clipping, and overflow: `srijika_get_layout_snapshot`
- Clean visual evidence: `srijika_capture_preview`

Do not request or reproduce the full canonical document unless replacement, migration, or deep corruption recovery requires it. Keep tool results compact by filtering page, node, depth, category, and severity.

## Write rules

- Define page props before binding a node expression to them.
- Pass application logic only through typed props/events; do not invent runtime function registries in generated UI.
- Use `setStyle` only for literal style declarations in `style.base` or a named breakpoint. For runtime-dynamic style, define a typed object page prop and bind it to the component's `style` prop; the renderer/codegen validates it through `srijikaStyle`.
- Use breakpoint-aware `setStyle` operations for responsive overrides. Do not copy the component tree for another viewport.
- Use registered components when possible. Inspect the catalog before adding an unknown component.
- Use `insertRepeat` for repeated data and `insertIf` for conditional UI instead of duplicating or hiding nodes manually.
- When repeated siblings already exist, call `srijika_analyze_repetitions` and convert only a reviewed candidate with `convertRepeatedSiblings`. The conversion must create one typed array page prop with current rows as its default/design value, retain one template subtree, and preserve source-viewport order and geometry.
- Treat `replaceDocument`, subtree removal, and large design imports as destructive writes. Match them to explicit user intent.
- Use `srijika_undo` or `srijika_redo` only against the revision the user currently sees.

Read [document-model.md](references/document-model.md) when constructing expressions, public props, events, styles, or AST nodes. Read [protocol-and-tools.md](references/protocol-and-tools.md) for exact tool behavior and operation examples.

When creating, moving, or reviewing code-first Features, Slots, Parts, Connectors, Hooks, Stores, Logic, APIs, or owner Types, read [code-first-architecture.md](references/code-first-architecture.md). Resolve the exact owner folder through its strict creation matrix before writing: new owners always include UI + Connector, optional capabilities come only from the checked set, paths are preflighted without overwrite, and arbitrary folders or alternate names are forbidden. Apply the highest-available/no-jump chain and nearest-common-owner promotion rules. The same machine-readable contract is available from the read-only MCP resource `srijika://docs/code-first-architecture`.

When a task asks to initialize, inspect, validate, run, build, or open a code-first project from the terminal or VS Code, read [cli-and-runtime.md](references/cli-and-runtime.md). Prefer the shared `srijika` CLI over recreating package-manager or scaffold decisions. Keep Node as the compatibility default, select Bun only when explicitly requested for a detected Vite project, and never change the lockfile or package manager merely because the runtime changed. The same machine-readable contract is available from `srijika://docs/cli-runtime`.

## Recreate a design image

Interpret the image in Codex, not in the MCP bridge. Decompose it into regions, select registered components, then send a structured design plan through `srijika_import_design_plan`. This avoids uploading the image or requiring another vision API key.

Read [design-image-workflow.md](references/design-image-workflow.md) before recreating a supplied screenshot or mockup.

Treat the source pixel dimensions as part of the specification. Inventory every visible region before writing, build geometry before decoration, and keep fixed screenshot content literal until parity is established. After parity, convert high-confidence repeated structures to typed props plus Repeat and add responsive overrides without changing the source-frame capture.

After each major pass: validate, inspect layout, capture a clean PNG, compare it to the source, and patch the largest structural mismatch first. After source parity, run the responsive matrix and compare repeated-structure instance geometry before and after normalization. Continue until all declared acceptance checks pass, two consecutive captures show no measurable improvement, or six correction passes have completed. If capture is unavailable or fails, state explicitly that visual verification was not completed.

## Connection and evolution

Never read, display, copy, or persist the bridge bearer token. The MCP client discovers it from the user-private Studio descriptor and communicates only over loopback.

Read [security-and-troubleshooting.md](references/security-and-troubleshooting.md) for connection failures and safe recovery. Read [versioning-and-migrations.md](references/versioning-and-migrations.md) before changing protocol schemas, tool names, operation payloads, or document format versions.
