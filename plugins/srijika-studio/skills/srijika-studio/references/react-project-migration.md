# React project migration

Use this workflow to convert an existing React project into a distinct Srijika
project while keeping the source tree unchanged. The migration engine owns
inventory, path safety, sessions, checkpoints, traceability, and verification.
Codex owns semantic analysis and the reviewed source-to-Srijika mapping.

## Non-negotiable invariants

- Resolve source and target to canonical real paths before any write.
- Reject equal, nested, overlapping, or symlink-aliased source/target roots.
- Read the source only. Capture its baseline before target creation and compare
  it again during every verification and finalization.
- Require a new target or a recognizable clean generated Srijika starter. Never
  overwrite an unrelated or developer-modified project.
- Fail closed on unsupported frameworks, dynamic behavior, incomplete scans,
  unsafe filesystem entries, stale session state, or missing evidence.
- Preserve every migrated source item in traceability. An unresolved item is a
  blocker or an explicitly reviewed exception, never silently dropped work.
- Do not promise arbitrary automatic rewriting or guaranteed zero context loss.
  The acceptance contract is evidence-based equivalence for the supported
  source and declared behaviors.

## Phase flow

1. **Create** — call `srijika_create_react_migration` with `sourceRoot` and
   `targetRoot`. Review canonical paths, compatibility, source baseline, and the
   new session ID.
2. **Scan** — call `srijika_scan_react_migration_source`. Inventory package
   scripts/dependencies, entry points, routes/layouts, UI, props/events, hooks,
   context/state, requests, authentication, styles, assets, forms, environment
   access, loading/error states, responsive behavior, and tests.
3. **Plan** — call `srijika_get_react_migration_plan`. Review every proposed
   Feature, Slot, Part, Shared UI/Widget/Capability owner, dependency, blocker,
   and verification gate. Do not apply an unreviewed plan.
4. **Migrate slices** — for one coherent route or dependency slice, read the
   referenced source files, perform semantic analysis, construct canonical
   target files, and call `srijika_apply_react_migration_slice` with the target
   root plus a slice containing its exact planned ID/title, target writes, and
   traceability entries. The engine resolves the persisted session and reviewed
   plan from the target. A slice write is atomic and cannot touch the source.
5. **Verify each slice** — call `srijika_verify_react_migration_slice`. Fix
   architecture, typecheck, test, route, or traceability failures before moving
   to the next slice.
6. **Verify the application** — call `srijika_verify_react_migration`. Require
   the source baseline to match, all source items to be mapped or explicitly
   blocked, strict architecture to pass, and build/typecheck/tests to pass. When
   route files or `semanticRoutesPresent` exist, submit `routes: passed`
   evidence from route parity checks, even when pathname/router behavior lives
   in an entry file that the coarse filename classifier labels differently.
   When entry, component, style, or asset sources exist, submit `visual: passed`
   evidence from representative viewport comparisons. These conditional gates
   cannot be skipped. Include nonempty `details` naming the checked routes and
   representative viewport matrix; visual details must name at least two of
   mobile, tablet, desktop, and wide, or provide at least two `WxH`
   measurements. Duplicate or oversized evidence is rejected, and a bare
   `passed` assertion is not evidence.
7. **Finalize** — call `srijika_finalize_react_migration`. It must refuse to
   complete unless all required evidence is current and passing.

Use `srijika_get_react_migration_status` after any interruption. Resume from the
first incomplete or stale phase; never recreate a session over existing target
work.

## A-to-Z inventory checklist

Record at least:

- toolchain and React version; Vite/CRA entry and build scripts;
- route tree, layouts, redirects, guards, loaders, and not-found/error routes;
- component tree, prop/event contracts, portals, lazy boundaries, and dynamic
  imports;
- React hooks, context, Redux/Zustand/other state, TanStack Query/cache behavior,
  persistence, effects, subscriptions, and browser APIs;
- API clients, request/response transforms, authentication/session behavior,
  authorization checks, retries, cancellation, and error mapping;
- CSS, CSS Modules, Sass, Tailwind, CSS-in-JS, fonts, icons, media, and public
  assets;
- forms, validation, accessibility, keyboard/focus behavior, responsive states,
  loading/empty/error states, environment variables, and feature flags;
- unit, integration, end-to-end, snapshot, route, build, and visual checks.

Computed imports, runtime code generation, framework plugins, server-only code,
or behavior that cannot be demonstrated become blockers. Do not reinterpret
them from filenames alone.

## Ownership mapping

- One Part consumer: keep the behavior in that Part.
- Multiple sibling Parts: promote to their Slot.
- Multiple sibling Slots: promote to their Feature.
- Multiple Features: use the appropriate strict Shared UI Primitive, Shared
  Widget, or Shared Headless Capability.
- UI remains behavior-free and receives values/events through typed props.
- Connector owns composition and runtime wiring. Hook owns React/query lifecycle,
  Store owns shared synchronous client state, Logic owns deterministic business
  rules, API owns request transport, and Types remains passive.

Trace every source file/export/route/asset/test to its target owner and public
boundary. Avoid `index.ts` barrels and freehand Shared folders.

## Subagent roles

When the user asks for subagents, divide work by non-overlapping migration
slices and keep one coordinator responsible for the session:

- **Inventory agent** — read-only source analysis and blocker discovery.
- **Architecture agent** — owner/promotion plan and dependency review.
- **Slice agents** — migrate assigned, non-overlapping route/feature slices.
- **Verification agent** — independently run architecture, build, typecheck,
  tests, route comparison, traceability, and visual checks.

Do not allow parallel agents to write the same target files. Every agent reports
its slice ID, source items, target files, assumptions, blockers, and evidence to
the coordinator before the slice is marked verified.

## Completion report

Report source and target canonical roots, session ID, source baseline result,
mapped/blocked/exception counts, generated owner tree, verification commands and
results, route and visual evidence status, and remaining limitations. A
successful final report contains no hidden unmapped items and does not imply
support beyond the detected React adapter.
