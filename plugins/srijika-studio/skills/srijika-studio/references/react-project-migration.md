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
- Preserve every migrated source item in traceability. Only engine-classified
  nonruntime evidence may be excluded; runtime-bearing source cannot be ignored.
- Native completion rejects every compatibility mapping, copied legacy subtree,
  wrapper/re-export, iframe/webview, source-root dependency, and runtime fallback.
- Do not promise arbitrary automatic rewriting or guaranteed zero context loss.
  The acceptance contract is evidence-based equivalence for the supported
  source and declared behaviors.

## Phase flow

1. **Create** — call `srijika_create_react_migration` with `source` and
   `target`. Review canonical paths, compatibility, source baseline, and the
   new session ID.
2. **Scan** — call `srijika_scan_react_migration_source`. Inventory package
   scripts/dependencies, entry points, routes/layouts, UI, props/events, hooks,
   context/state, requests, authentication, styles, assets, forms, environment
   access, loading/error states, responsive behavior, and tests. Read paged
   results with an opaque query-bound `cursor` and `limit` instead of requesting
   the full graph again. Reuse `nextCursor` unchanged only for the same query.
3. **Ownership plan** — call `srijika_get_react_migration_plan`. Follow its
   deterministic owner ID, owner kind/path, role, import graph, completion
   obligation, bounded adapter planning hints, slice order, and blockers. Do not
   invent a different owner from filenames or apply an unreviewed plan.
4. **Correct ownership only when proven wrong** — before any slice review or
   apply, call `srijika_review_react_migration_ownership` with 1–256 inventoried
   source overrides. Each supplies canonical owner kind/name/path/role and a
   concrete rationale plus the exact current plan ID/source/target snapshots. Re-read
   the new plan ID and SCC-atomic slices. Never
   submit a freehand target path or correct ownership after work starts.
   Copy `planId`, `sourceSnapshotSha256`, and `targetBaselineSha256` from one
   plan response into the matching `expected*` request fields; never combine
   snapshots from separate reads.
5. **Read slice context** — call `srijika_get_react_migration_slice_context`
   with the target, exact slice ID, and current plan/source/target freshness
   fields. Follow `nextCursor` with the same query;
   read at most one bounded page at a time. Trust its hash-checked content,
   imports, exports, ownership, and canonical target paths. Environment values
   stay hidden and binary assets are hash-only.
6. **Review a native slice** — for one coherent route or dependency slice,
   perform semantic analysis on that bounded context, construct canonical
   target files, and call `srijika_review_react_migration_slice` with the target
   plus the exact planned ID/title, writes, canonical native owner/role mappings,
   rationales, optional trace ranges, and expected-hash deletions for obsolete
   generated starter files. Compatibility findings and bounded adapters are
   planning hints only: slice review accepts native mappings and rejects every
   compatibility kind, mode, adapter, wrapper, or copied legacy fallback.
7. **Apply by token** — call `srijika_apply_react_migration_slice` with only the
   target and returned `reviewToken`. Never resend or alter reviewed code. The
   token binds plan, source snapshot, target snapshot, and canonical payload;
   target writes are atomic and cannot touch the source.
8. **Verify each slice** — call `srijika_verify_react_migration_slice` with only
   the target and slice ID. The engine executes and snapshot-signs typecheck and
   build. The fixed gate is: zero Srijika diagnostics → architecture pass →
   TypeScript pass → production build pass. Never submit a command status or
   receipt. Stop and fix before moving to the next slice.
9. **Verify the application** — call `srijika_verify_react_migration`. Require
   the source baseline to match, all source items to be mapped or explicitly
   blocked, strict architecture to pass, and engine-executed
   build/typecheck/tests to pass. If the target has no declared `test` script,
   add meaningful migrated tests; never substitute architecture validation.
   When route or visual parity applies, call verify with `target` and optional
   `includeInstall` only. The engine prepares an isolated temporary source copy
   and the target runtime, selects loopback ports, derives concrete routes, and
   captures fixed-viewport redirects, semantic DOM traces, console/page errors,
   and PNGs. Caller URLs, routes, viewports, screenshots, artifact paths, status
   claims, receipts, and free-form evidence prose are rejected.
10. **Finalize** — call `srijika_finalize_react_migration` with only the target.
    It rebuilds both isolated runtimes, reruns the gates, recaptures, and
    revalidates the engine-owned manifest. It must
    refuse to complete unless all required evidence is current and target-snapshot-bound,
    every runtime mapping is native, the target graph is closed, and no wrapper,
    fallback, compatibility, unowned module, or unsupported behavior remains.

Use `srijika_get_react_migration_status` after any interruption. Resume from the
first incomplete or stale phase. If status reports a pending apply handle, pass
that value unchanged as `reviewToken`. Never recreate a session over existing
target work. Ownership cursors are bound to the current plan and optional
`sliceId`; never replay them against another source, plan, or slice.

Browser parity requires Playwright and Chromium on the MCP/plugin host. The
published MCP package declares Playwright as optional; install Chromium with
`npx playwright install chromium` when needed. If the runtime or browser is not
available, verification and finalization fail closed rather than trusting a
manual screenshot.

Minimal verify input is:

```json
{
  "target": "/absolute/path/new-srijika"
}
```

Set `includeInstall: true` only when dependency downloads are explicitly
permitted. Ports, routes, and viewport definitions stay engine-owned.

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

## Minimal-prompt operation

Follow the machine plan instead of restating architecture in each prompt. Read
only the current slice's listed source files and paged ownership rows, submit
one review payload, retain only its token, then apply by token. After any
interruption, read compact status and continue from the first incomplete slice.
Prefer counts, blockers, and `nextAction` over repeating the complete inventory
or session.

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
