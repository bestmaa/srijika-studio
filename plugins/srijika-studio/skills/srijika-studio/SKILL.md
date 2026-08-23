---
name: srijika-studio
description: Build, inspect, scaffold, migrate, validate, debug, and preview Srijika React projects through CLI-first project MCP tools and an optional authenticated Studio bridge. Use for converting an existing React project into a distinct new Srijika target without changing the source, for Feature/Slot/Part/strict Shared project structure even without Desktop Studio, or for visual document, hierarchy, renderer, and preview work when Studio is running.
---

# Srijika Studio

For code-first projects, the TSX files and `srijika.config.json` are the source of
truth and Desktop Studio is optional. For visual document work, use the running
Studio document engine as the source of truth. Never automate the editor by
guessing DOM coordinates.

## Choose the adapter first

- Feature, Slot, Part, Connector, Hook, Store, Logic, API, Types, project setup,
  validation, or runtime: call `srijika_get_code_project`, then use the code-project
  check/plan/apply tools. These must work when Studio is closed or uninstalled.
- Existing React application to a new Srijika project: read
  [react-project-migration.md](references/react-project-migration.md), then use the
  migration session tools. Keep the source immutable, require a distinct new or
  empty target, follow the deterministic ownership plan, review each native
  slice, and apply only its bound token. Compatibility wrappers never complete.
- Canvas nodes, visual document props/events/styles, layout snapshots, history, or
  clean preview capture: use the Studio bridge workflow below.
- If the Studio bridge is unavailable during a code-project task, continue with
  the project tools. Stop only when the requested operation inherently needs the
  visual document or renderer.

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

When creating, moving, or reviewing code-first Features, Slots, Parts, strict Shared owners, Connectors, Hooks, Stores, Logic, APIs, or owner Types, read [code-first-architecture.md](references/code-first-architecture.md). Resolve the exact owner folder through its strict creation matrix before writing: Feature/Slot/Part and Shared Widget owners always include UI + Connector; Shared UI has pure UI plus optional Types only; Shared Headless Capability forbids UI/Connector and requires at least one runtime layer. Optional capabilities come only from the checked set, paths are preflighted without overwrite, and arbitrary folders or alternate names are forbidden. Apply the highest-available/no-jump chain and nearest-common-owner promotion rules. Shared code never imports Features, and consumers use only public Shared boundaries. The same machine-readable contract is available from the read-only MCP resource `srijika://docs/code-first-architecture`.

Treat every file ending in the resolved UI suffix (canonical default `.ui.tsx`)
as a behavior-free renderer: only its matching Connector
renders it, except that pure UIs may compose canonical Shared UI Primitives.
Never put Hook calls (including `React.useState`), browser/runtime globals
(including transport, storage, timers, workers, observers, DOM/navigation,
`window`, `globalThis`, `self`, `process`, `Deno`, or `Bun`), external runtime
behavior, requests, state, effects, or business behavior in UI. UI
external imports are limited to types, styles/assets, safe React JSX support,
and bindings used only as JSX tags. The static asset allowlist is CSS-family,
image/icon, font, audio, and video extensions documented by the architecture
resource; do not treat arbitrary data/module extensions as assets. Treat every
file ending in the resolved Types suffix (canonical default `.types.ts`) as a
passive contract consumed with `import type`/`export type`; never add runtime
declarations or runtime-value references. Do not silence
`SRIJIKA-ARCH-DIRECT-CHILD-UI`/`SRIJIKA4116` or
`SRIJIKA-ARCH-PASSIVE-TYPES`/`SRIJIKA4117`. Keep Logic framework-free and
deterministic: retain pure validation, authorization, transforms, aggregation,
and API orchestration there, but move React/query/router/state lifecycle to
Hook, Connector, or Store. Never silence
`SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN`/`SRIJIKA4118`. Resolve custom architecture
roots, structural directory names, and suffixes through the validated project
config; reject traversal, overlap, duplicate names/suffixes, suffixes that end
with another configured suffix, and symlink escapes. Comparisons are
case-insensitive. When the `architecture` block is absent, use canonical defaults; when
it exists, require exact profile `feature-slot-part-v1` and fail closed on a
missing/unsupported profile. Treat generated validation as runtime-config-aware.
CLI watch is one filtered project-root watcher that reloads config, observes
config/tsconfig/entry/resolved roots plus future-root ancestors, and stays alive
through temporarily invalid configuration. Treat VS Code/Studio exact file and
safe-move previews as canonical planner output—never invent hardcoded
paths. Require exact `sourceOfTruth: "tsx"`, a configured entry ending in the
resolved UI suffix, and the full twelve-field architecture surface. The entry
remains authoritative and strict even when it is outside both ownership roots.
Parse aliases only from root JSONC `tsconfig.json`: reject `extends`, permit
only absent/empty `references`, require `compilerOptions.baseUrl` to be omitted,
and accept only exact or slash-delimited terminal `/*` paths whose first target
stays inside the project. Never assume a Vite-only alias is portable. Do not silence computed module target
`SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT`/`SRIJIKA4119` or unresolved local alias
`SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS`/`SRIJIKA4120`. Require every governed
relative or `src/...` source import to resolve inside the scanned ownership
roots; do not silence `SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT`/`SRIJIKA4121`.
CSS/static assets remain exempt. Honor emitted
`SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER` and
`SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER` evidence instead of inventing a bypass.

For structural writes, call `srijika_plan_code_structure` first and review every
created/updated path. Then pass its one-time `planId` to
`srijika_apply_code_structure` and finish with `srijika_check_code_project`. Never substitute Studio bridge
operations for a canonical TSX ownership change.

## Migrate an existing React project

Treat migration as a reviewable, resumable program rather than a bulk copy. Call
`srijika_create_react_migration`, scan and inspect the plan, then let Codex
read the bounded immutable slice context. If that context disproves an inferred
owner, use bounded canonical ownership review before any migration work. Then
analyze one source slice, submit it to `srijika_review_react_migration_slice`,
and apply only its returned review token. Verify the slice before continuing.

Every slice has one fixed gate: **zero Srijika diagnostics → architecture pass
→ TypeScript pass → production build pass**. Stop and fix before continuing.

Never edit the source root. Never use a target that is the source, contains the
source, is contained by the source, or is a nonempty unrelated project. The
engine inventories and guards the filesystem; Codex remains responsible for the
semantic mapping of routes, layouts, components, state, requests, auth, styles,
assets, forms, environment use, and tests. Unsupported or ambiguous behavior is
a blocker, not permission to guess.

Before finalization, call `srijika_verify_react_migration` and require source
immutability, complete source-to-target traceability, Srijika architecture,
zero Srijika diagnostics, and engine-executed build, typecheck, and test gates.
Never submit caller-authored status or receipt claims, URLs, routes, viewports,
screenshots, artifact paths, or pass details. When route or visual surfaces
require parity, call verify with `target` and optional `includeInstall` only.
The engine prepares an isolated immutable-source copy plus the target runtime,
selects loopback ports, derives routes, captures fixed-viewport semantic
DOM/redirect/error and PNG evidence, and applies fixed thresholds. Do not describe migration as guaranteed
zero-loss; report every blocker and unmapped source item. Finalize only after
the session reports all required gates passing.

When a task asks to initialize, inspect, validate, run, build, or open a code-first project from the terminal or VS Code, read [cli-and-runtime.md](references/cli-and-runtime.md). Prefer the shared `srijika` CLI over recreating package-manager or scaffold decisions. Keep Node as the compatibility default, select Bun only when explicitly requested for a detected Vite project, and never change the lockfile or package manager merely because the runtime changed. The same machine-readable contract is available from `srijika://docs/cli-runtime`.

## Recreate a design image

Interpret the image in Codex, not in the MCP bridge. Decompose it into regions, select registered components, then send a structured design plan through `srijika_import_design_plan`. This avoids uploading the image or requiring another vision API key.

Read [design-image-workflow.md](references/design-image-workflow.md) before recreating a supplied screenshot or mockup.

Treat the source pixel dimensions as part of the specification. Inventory every visible region before writing, build geometry before decoration, and keep fixed screenshot content literal until parity is established. After parity, convert high-confidence repeated structures to typed props plus Repeat and add responsive overrides without changing the source-frame capture.

After each major pass: validate, inspect layout, capture a clean PNG, compare it to the source, and patch the largest structural mismatch first. After source parity, run the responsive matrix and compare repeated-structure instance geometry before and after normalization. Continue until all declared acceptance checks pass, two consecutive captures show no measurable improvement, or six correction passes have completed. If capture is unavailable or fails, state explicitly that visual verification was not completed.

## Connection and evolution

Never read, display, copy, or persist the bridge bearer token. The MCP client discovers it from the user-private Studio descriptor and communicates only over loopback.

Read [security-and-troubleshooting.md](references/security-and-troubleshooting.md) for connection failures and safe recovery. Read [versioning-and-migrations.md](references/versioning-and-migrations.md) before changing protocol schemas, tool names, operation payloads, or document format versions.
