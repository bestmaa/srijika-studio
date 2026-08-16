# React-to-Srijika migration

Srijika can coordinate a resumable migration from an existing React application
into a distinct new Srijika project. The source tree is immutable. A migration
may write only inside the target tree and records its session at:

```text
<target>/.srijika/migrations/react/session.json
```

The migration engine is the single implementation used by CLI, MCP, VS Code,
and Desktop Studio adapters. It owns canonical path checks, source inventory,
the baseline, plan/session state, atomic target writes, traceability, and
verification. Codex performs the semantic analysis required to turn a reviewed
source slice into canonical Feature, Slot, Part, and Shared owners.

## Safety contract

- Source and target are resolved as canonical real paths.
- Equal, nested, overlapping, or symlink-aliased roots are rejected.
- The source is read-only and its baseline is checked again before completion.
- The target must be new or a recognizable clean generated Srijika starter.
- Unsupported or ambiguous behavior blocks the affected slice.
- Every migrated source item is represented in source-to-target traceability.
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
srijika migrate verify --target ../new-app
```

## Codex and MCP

Use the tools in this order:

1. `srijika_create_react_migration` — preflight paths, capture the source
   baseline, create the target scaffold, and persist a session. It never writes
   to the source.
2. `srijika_scan_react_migration_source` — read the bounded React inventory.
3. `srijika_get_react_migration_plan` — inspect slices, mappings, blockers, and
   required evidence.
4. `srijika_apply_react_migration_slice` — apply one Codex-reviewed slice as an
   atomic target-only change.
5. `srijika_verify_react_migration_slice` — verify the slice before another
   slice is accepted.
6. `srijika_get_react_migration_status` — resume from persisted session state.
7. `srijika_verify_react_migration` — run session-wide source, traceability,
   architecture, build, typecheck, and test gates.
8. `srijika_finalize_react_migration` — complete only when all required current
   evidence passes.

Codex must inventory routes/layouts, components and contracts, hooks/context and
state, queries and API boundaries, authentication, CSS and assets, forms,
environment variables, loading/error/responsive states, and tests. It migrates
one coherent route or dependency slice at a time. Computed imports, runtime code
generation, server-only behavior, unsupported framework plugins, or an
incomplete inventory become blockers rather than guesses.

## VS Code

Open the complete source and target folders only after the migration has
accepted them as distinct roots. The Srijika migration view is an adapter over
the same engine and session; it does not maintain a second plan. Use it to pick
the roots, review inventory/plan/blockers, monitor slices, resume, run
verification, and open the converted target. Terminal commands and MCP remain
fully usable when the extension is absent.

## Desktop Studio

Desktop Studio is optional. Its migration surface reads the same persisted
session and delegates every scan, plan, apply, and verification operation to the
shared engine. Use Studio only when visual comparison helps verify a migrated UI;
the source code, target code, and migration session remain authoritative.

## Verification and final report

Finalization requires current evidence for:

- source baseline unchanged;
- complete source-to-target mapping or explicitly reviewed blocker/exception;
- strict Srijika architecture;
- build, typecheck, and tests;
- route inventory equivalence when the source has routing; and
- representative responsive/visual comparison when visual behavior is in
  scope.

Verification evidence uses the names `install`, `typecheck`, `build`, `test`,
`routes`, and `visual`. Typecheck, build, and test are always required and must
pass. When the
inventory contains route files or reports `semanticRoutesPresent`, `routes` must
be `passed`. Codex reviews and submits route parity for semantic routes inside
entry or other files, even if the coarse filename classifier labels them
differently. When the inventory
contains an entry, component, style, or asset, `visual` must be `passed`; neither
conditional parity gate can be skipped. Slice verification also confirms the
source baseline is still unchanged. Route and visual entries require nonempty
details. Visual details must name at least two reviewed viewports from mobile,
tablet, desktop, and wide, or provide at least two `WxH` measurements. Duplicate
or oversized evidence is rejected.

The final report records canonical source/target roots, session ID, mapped and
blocked counts, target owner tree, commands and results, route/visual evidence,
and remaining limitations.
