# React-to-Srijika migration

Srijika can coordinate a resumable migration from an existing React application
into a distinct new Srijika project. The source tree is immutable. A migration
may write only inside the target tree and records its session at:

```text
<target>/.srijika/migrations/react/session.json
```

The migration engine is the single implementation used by CLI, MCP, VS Code,
and Desktop Studio adapters. It owns canonical path checks, source inventory,
the baseline, deterministic source/import/ownership graph, plan/session state,
review-token-bound payloads, atomic target writes, traceability, native target
graph inspection, and verification. Codex implements each fixed owner/role
obligation with semantic React code; it does not invent ownership from scratch.

## Safety contract

- Source and target are resolved as canonical real paths.
- Equal, nested, overlapping, or symlink-aliased roots are rejected.
- The source is read-only and its baseline is checked again before completion.
- The target must be new or a recognizable clean generated Srijika starter.
- Unsupported or ambiguous behavior blocks the affected slice.
- Every runtime source item finishes in a canonical native owner. Compatibility
  and adapter findings are planning hints only; review and apply reject them.
- Generic runtime ignores, bookkeeping-only mappings to starter files, copied
  legacy trees, wrapper/re-export/iframe fallbacks, source-root dependencies,
  and unowned target modules are rejected.
- Srijika does not claim arbitrary automatic rewriting or guaranteed zero
  context loss. Completion means the declared evidence passes for the supported
  React source, with no hidden unmapped item.

## CLI

Start a migration from any directory:

```bash
srijika migrate react \
  --source /absolute/path/old-react-app \
  --target /absolute/path/new-srijika-app
```

Optional creation metadata and automation output are available:

```bash
srijika migrate react --source ../old-app --target ../new-app \
  --name NewApp --display-name "New App" --json
```

`--dry-run` performs discovery and planning without creating the target. The
equivalent creation alias is:

```bash
srijika create ../new-app --from ../old-app
```

Resume or inspect an interrupted session:

```bash
srijika migrate status --target ../new-app
srijika migrate parity --target ../new-app
srijika migrate verify --target ../new-app
srijika migrate finalize --target ../new-app
```

Parity launches engine-owned isolated source/target runtimes. Add `--include-install`
only when dependency downloads are explicitly permitted.

## Codex and MCP

Use the tools in this order:

1. `srijika_create_react_migration` — preflight paths, capture the source
   baseline, create the target scaffold, and persist a session. It never writes
   to the source.
2. `srijika_scan_react_migration_source` — read the bounded React inventory.
   Large inventories are paged with an opaque query-bound `cursor` and `limit`
   (50 by default, 200 maximum). Reuse `nextCursor` unchanged only with the
   same source snapshot, plan, and optional slice filter.
3. `srijika_get_react_migration_plan` — inspect deterministic owners, roles,
   dependency graph, completion obligations, slices, adapters, and blockers.
4. `srijika_review_react_migration_ownership` — only when semantic analysis
   disproves an inferred owner, submit bounded canonical owner corrections
   with the exact current plan ID, source snapshot, and target snapshot before any slice
   review/application. The engine rechecks the source and
   recomputes the plan ID and SCC-atomic slices; freehand target paths are not
   accepted.
   Bind `expectedPlanId` to `planId`, `expectedSourceSnapshotSha256` to
   `sourceSnapshotSha256`, and `expectedTargetSnapshotSha256` to
   `targetBaselineSha256` from that same plan response.
5. `srijika_get_react_migration_slice_context` — read only the selected slice's
   immutable source content in byte-bounded pages, binding the same three
   expected plan/source/target fields. Each item carries its hash,
   imports, exports, owner, and canonical target paths; environment values and
   binary asset content are never returned.
6. `srijika_review_react_migration_slice` — validate and persist one exact
   native implementation payload, including expected-hash deletion of obsolete
   starter files when planned, then return its bound review token.
7. `srijika_apply_react_migration_slice` — apply using only `target` and the
   review token; reviewed code is not repeated or changed at apply time.
8. `srijika_verify_react_migration_slice` — require zero Srijika diagnostics,
   valid architecture, and engine-executed TypeScript and production-build
   gates before another slice is accepted. It accepts no caller-authored
   command status or receipt.
9. `srijika_get_react_migration_status` — resume from persisted session state.
   If a reviewed slice was not applied before interruption, status returns a
   pending apply handle; pass that value unchanged as `reviewToken` rather than
   recreating the review.
10. `srijika_verify_react_migration` — run session-wide source, traceability,
    architecture, build, typecheck, and test gates. The engine executes and
    snapshot-signs the command results itself. Its only optional input is
    `includeInstall`. For parity the engine creates an isolated temporary source
    copy, prepares both runtimes, selects loopback ports, derives routes, captures
    fixed-viewport semantic DOM/redirect/error and PNG evidence, applies fixed
    thresholds, and persists a snapshot-bound manifest. Caller URLs, routes,
    viewports, screenshots, evidence paths, details, and pass claims are rejected.
11. `srijika_finalize_react_migration` — rebuild the isolated runtimes, recapture
    and revalidate engine-owned browser parity, rerun gates, and complete only when every runtime mapping is
    native, the target graph is closed, and no unsupported finding remains.

Codex must inventory routes/layouts, components and contracts, hooks/context and
state, queries and API boundaries, authentication, CSS and assets, forms,
environment variables, loading/error/responsive states, and tests. It migrates
one coherent route or dependency slice at a time. Computed imports, runtime code
generation, server-only behavior, unsupported framework plugins, or an
incomplete inventory become blockers rather than guesses.

## VS Code

Open the Srijika Activity Bar container and expand **Migration**, or run
**Srijika: Open React Migration Dashboard**. The view is an adapter over the
same engine and target session; it does not maintain a second plan.

The form has two guarded target modes:

- **New target folder** accepts a new absolute sibling path or a selected empty
  or resumable directory.
- **Current workspace target** points at the first open workspace only. It is
  useful for an empty target or to resume an accepted migration, not for
  rewriting a populated application in place. The engine still rejects equal,
  nested, unrelated populated, symlinked, or otherwise unsafe roots.

After Start/Resume, the view renders file-category counts, canonical owners and
roles, ordered dependency slices, applied and verified counts, and blockers
from the persisted session. Refresh observes work performed by CLI, MCP,
Studio, or another agent. Verify calls the engine-owned verification adapter;
Full session JSON opens the complete uncapped persisted plan, and Open target
creates a separate VS Code window.

The readiness card detects whether an OpenAI Codex/ChatGPT extension is present
in the current extension host and whether the target contains a readable
Srijika entry in `.vscode/mcp.json` or `.mcp.json`. Those states deliberately
say **detected/configured**, not **connected**: authenticated live MCP state is
owned by the client. **Copy Codex handoff** produces a session-aware prompt
that preserves the immutable-source and one-slice-at-a-time contract.

VS Code owns view placement. Enable **View → Appearance → Secondary Side Bar**
and choose **Move View → Secondary Side Bar** from the Migration view menu to
keep the dashboard on the right while Structure remains on the left. Terminal
commands and MCP remain fully usable when the extension is absent.

## Desktop Studio

Desktop Studio is optional. Its migration surface reads the same persisted
session and delegates every scan, plan, apply, and verification operation to the
shared engine. Use Studio only when visual comparison helps verify a migrated UI;
the source code, target code, and migration session remain authoritative.

## Verification and final report

Finalization requires current evidence for:

- source baseline unchanged;
- complete native source-to-target ownership and role obligations;
- closed target import/dependency graph with no compatibility, wrapper,
  raw-source copy, runtime fallback, or unowned source module;
- strict Srijika architecture;
- zero Srijika compiler diagnostics across every resolved UI source;
- build, typecheck, and tests;
- route inventory equivalence when the source has routing; and
- representative responsive/visual comparison when visual behavior is in
  scope.

The engine executes typecheck, build, and test in the target with bounded time
and output, then signs each result to the current target snapshot. MCP inputs do
not accept caller-authored statuses, receipts, routes, screenshots, evidence
paths, or evidence prose. When the target has no declared `test` script,
verification stays blocked; architecture validation is not treated as a
substitute for meaningful migrated tests. For browser parity, the engine copies
the immutable source to a temporary runtime, prepares the target runtime,
selects separate loopback ports, derives up to 64 concrete routes, and compares
redirects, semantic DOM traces, console/page errors, and PNG pixels. Routes,
viewports, server commands, ports, and pass thresholds are engine-owned. The
capture and manifest live under `.srijika/migrations/react/` and are bound to
current source and target snapshots. Slice verification also confirms the source
baseline is still unchanged.

Browser capture needs a resolvable Playwright runtime and Chromium. A published
MCP installation includes Playwright as an optional dependency, but Chromium
may still require `npx playwright install chromium`. A bundled Codex plugin
fails closed when the host cannot resolve Playwright or launch Chromium; the
other project, planning, review, apply, and architecture tools remain usable.

Minimal verification input:

```json
{
  "target": "/absolute/path/new-srijika"
}
```

Set `includeInstall: true` only when dependency downloads are explicitly
permitted; URLs, ports, routes, and viewports are never model inputs.

The final report records canonical source/target roots, session ID, mapped and
blocked counts, target owner tree, commands and results, route/visual evidence,
and remaining limitations.
