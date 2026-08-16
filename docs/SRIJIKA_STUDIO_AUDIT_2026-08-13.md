# Srijika progressive architecture and native audit — 2026-08-13

## Executive result

Srijika now implements one progressive runtime contract for every Feature,
Slot, and Part:

```text
UI ← Connector → Hook → Store → Logic → API → Backend
```

`UI` and `Connector` are required. `Hook`, `Store`, `Logic`, `API`, and
`Types` are optional. Runtime code always enters through the highest available
capability and may not skip an existing intermediate capability for the same
owner behavior.

The implementation was verified in the real Tauri desktop application first,
using the Windows system mouse and keyboard against the WSLg window. A complete
Feature chain was created from the visible Structure dialog and written to a
real project. Automated browser, Studio, VS Code, portable-validator, Rust,
generated-project, type, lint, and production-build gates are green.

Legend: ✅ verified; ⚠️ verified with the stated external limitation; ➖ not
applicable.

## Required architecture

### Owner files

Every Feature, Slot, and Part follows this flat owner-root contract:

```text
Owner.ui.tsx          required visual contract
Owner.connector.tsx  required public runtime gateway
useOwner.ts           optional React/Query gateway
owner.store.ts        optional shared client state
owner.logic.ts        optional business rules
owner.api.ts          optional transport
owner.types.ts        optional shared owner types
```

The exact Dashboard folder blueprint, naming rules, React Query/Zustand split,
and ownership-promotion diagrams live in
`docs/FEATURE_SLOT_PART_ARCHITECTURE.md`.

### Runtime resolution matrix

| Caller    | Must call when present                                |
| --------- | ----------------------------------------------------- |
| Connector | Hook, otherwise Store, otherwise Logic, otherwise API |
| Hook      | Store, otherwise Logic, otherwise API                 |
| Store     | Logic, otherwise API                                  |
| Logic     | API                                                   |
| API       | shared transport/backend                              |
| Types     | type-only support; not a runtime layer                |

Examples:

```text
Connector → API
Connector → Logic → API
Connector → Store → Logic → API
Connector → Hook → Store → Logic → API
```

If Hook exists, Connector may not jump to Store, Logic, or API. The same rule
continues down the chain.

### Ownership and promotion

```text
one Part needs it     → Part root
two Parts need it     → their Slot root
two Slots need it     → their Feature root
two Features need it  → src/shared
```

A parent composes a child's Connector, never its private UI, Hook, Store,
Logic, or API. Private code does not move upward, sideways to a sibling, or
across Features.

## Product implementation matrix

| Area                            | Implemented behavior                                                                                                      | Result |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| Feature creation                | UI + locked required Connector; optional Hook, Store, Logic, API, Types checkboxes                                        | ✅     |
| Slot creation                   | Same six capability choices at the Slot owner root                                                                        | ✅     |
| Part creation                   | Same six capability choices at the Part owner root                                                                        | ✅     |
| Bundled first Part              | UI + required Connector are always selected when a Slot includes its first Part                                           | ✅     |
| Standalone capability actions   | Connector, Hook, Store, Logic, API, and Types can be added at the exact selected owner                                    | ✅     |
| Canonical Hook and Store        | Starts flat; the first named helper atomically moves the public gateway into `hooks/` or `stores/` with no mixed layout   | ✅     |
| Atomic scaffold                 | Multi-file plans preflight every path, do not overwrite, and roll back partial writes                                     | ✅     |
| Highest-available templates     | Newly generated files import the next available lower capability                                                          | ✅     |
| Studio Problems                 | Errors block; recommendations are amber, separate, and do not falsely mark the architecture invalid                       | ✅     |
| VS Code parity                  | Same numeric code, semantic `ruleId`, severity, message, rule guidance, and quick-action model                            | ✅     |
| Portable/browser validator      | Same suffix classification, required Connector, no-jump, reverse-dependency, and recommendation behavior                  | ✅     |
| Generated project               | Minimal starter omits TanStack Query; both default and `--react-query` frozen-lock install/typecheck/build flows verified | ✅     |
| MCP/Codex architecture resource | Read-only `srijika://docs/code-first-architecture`, contract ID `srijika.progressive-behavior-chain`                      | ✅     |
| Product/website documentation   | Studio Structure guide, engineering docs, portal Project Anatomy, generated reference, and Codex plugin guidance aligned  | ✅     |

## Enforced errors

The validator preserves numeric consumer-compatible codes and adds stable
semantic rule IDs.

| Rule ID                           | Meaning                                             |
| --------------------------------- | --------------------------------------------------- |
| `SRIJIKA-ARCH-MISSING-UI`         | owner has capabilities but no required UI           |
| `SRIJIKA-ARCH-MISSING-CONNECTOR`  | owner has UI/capabilities but no required Connector |
| `SRIJIKA-ARCH-LAYER-JUMP`         | runtime skips an available intermediate capability  |
| `SRIJIKA-ARCH-UI-RUNTIME-IMPORT`  | pure UI imports Hook, Store, Logic, or API          |
| `SRIJIKA-ARCH-PRIVATE-IMPORT`     | private child/sibling/cross-feature import          |
| `SRIJIKA-ARCH-DIRECT-CHILD-UI`    | parent composes child UI instead of child Connector |
| `SRIJIKA-ARCH-REVERSE-DEPENDENCY` | junior runtime layer imports a senior layer         |

Missing Connector is also emitted as numeric `SRIJIKA4109`. Existing 410x,
4201, 4202, and 4203 codes remain compatible with Studio and VS Code consumers.

## Deterministic intelligent recommendations

Recommendations are non-blocking in v1 and include evidence plus a safe target
path.

| Recommendation ID                         | Measurable trigger                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SRIJIKA-ARCH-RECOMMEND-LOGIC`            | two or more API endpoints, or API use plus branching, validation, authorization, transformation, or orchestration |
| `SRIJIKA-ARCH-RECOMMEND-HOOK`             | lifecycle/cache/retry/poll/subscription/pagination/mutation, two async handlers, or three React hooks             |
| `SRIJIKA-ARCH-RECOMMEND-STORE`            | state shared by descendants/ownership boundaries, or four related local state fields                              |
| `SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE` | five Store selectors/actions, or Store-owned async/cache lifecycle                                                |
| `SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER`    | duplicated or sideways-consumed private capability                                                                |
| `SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER`      | oversized UI implementation or public contract                                                                    |

TanStack Query belongs in Hook for server lifecycle/cache. Zustand Store owns
shared client state. The same server entity must not be mirrored in both.

## Real native desktop audit

The Tauri application was launched with `pnpm tauri dev`. It remains running at
the end of this audit as `/target/debug/srijika-studio`.

| Native workflow              | Evidence                                                                                                                         | Result |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Cold welcome                 | Visible New Project, Open Existing Project, and Resume Last Project choices                                                      | ✅     |
| Resume real project          | Opened the existing `srijika-app/srijika-app` audit project through the visible native window                                    | ✅     |
| UI source switch             | Selected `D.ui.tsx`, then `Home.ui.tsx`; source text, preview, Inspector identity, and OPEN marker all switched together         | ✅     |
| Structure architecture guide | Visible required UI + Connector, Feature → Slot → Part, full runtime chain, fallback, and no-jump guidance                       | ✅     |
| Creation-field focus         | Typed `NativeAudit`, waited beyond the runtime refresh interval, then typed `Feature`; exact `NativeAuditFeature` value remained | ✅     |
| Capability selection         | Selected Hook, Store, Logic, API, and Types; required Connector stayed locked on                                                 | ✅     |
| Real Feature creation        | Clicked Create New Feature; seven files appeared on disk and the new UI became the active Studio source immediately              | ✅     |
| Generated import chain       | Connector → `useNativeAuditFeature` → Store → Logic → API                                                                        | ✅     |
| Live recommendation          | Existing Home Connector produced one non-blocking Hook recommendation while Problems remained `0 issues`                         | ✅     |

### Native evidence screenshots

The session screenshots are stored in the Windows temporary directory:

```text
C:\Users\beste\AppData\Local\Temp\srijika-native-current.png
C:\Users\beste\AppData\Local\Temp\srijika-native-project.png
C:\Users\beste\AppData\Local\Temp\srijika-native-home-selected.png
C:\Users\beste\AppData\Local\Temp\srijika-native-runtime-guide.png
C:\Users\beste\AppData\Local\Temp\srijika-native-focus-chain.png
C:\Users\beste\AppData\Local\Temp\srijika-native-capabilities.png
C:\Users\beste\AppData\Local\Temp\srijika-native-created-chain.png
```

### Real generated artifact

The native audit intentionally left this user-visible Feature in the opened
test project:

```text
/home/beste/project/<audit-project>/srijika-app/srijika-app/
└─ src/features/native-audit-feature/
   ├─ NativeAuditFeature.ui.tsx
   ├─ NativeAuditFeature.connector.tsx
   ├─ useNativeAuditFeature.ts
   ├─ nativeAuditFeature.store.ts
   ├─ nativeAuditFeature.logic.ts
   ├─ nativeAuditFeature.api.ts
   └─ nativeAuditFeature.types.ts
```

It was not removed because the requested native audit required proving where
saved files actually go and whether Studio immediately reflects them.

## Browser audit

Before the native sequence, the in-app browser loaded
`http://127.0.0.1:5173/` and visibly showed the corrected browser-only contract:
Create Demo Project and Import One `.ui.tsx` File, with project folders stated
as desktop-only.

After the native sequence, the browser-control runtime rejected further local
URL interaction under its URL security policy. That restriction was not
bypassed and no false console claim is made. Browser behavior is nevertheless
covered by the green Studio integration suite, including browser in-memory
project creation, source switching, resilient file import errors, preview
routing, and the exact single-file capability copy.

| Browser verification                                      | Result                                   |
| --------------------------------------------------------- | ---------------------------------------- |
| Initial live welcome/capability wording                   | ✅                                       |
| Browser-mode in-memory project and source switching tests | ✅                                       |
| Browser import failure remains user-visible and safe      | ✅                                       |
| Post-change live browser click/console pass               | ⚠️ blocked by browser-control URL policy |

## Codex/Srijika bridge audit

The Srijika Studio skill was loaded and its capability probe was run before and
after the native application launch. Both probes returned `bridge_unreachable`.
Per the skill contract, no Srijika mutation tools were called after that probe.
The native product itself remained usable and was audited through real system
input. This is an authenticated local MCP bridge connectivity limitation for
the current Codex task, not a claim that the desktop editor failed.

## Strict creation-surface follow-up

| Surface                         | Verified behavior                                                                                                | Result |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| Shared architecture contract    | One parser resolves configured Feature/Slot/Part roots plus the three strict Shared owner shapes                 | Pass   |
| Studio folder `+`               | Opens the ownership dialog directly; no clipped intermediate menu                                                | Pass   |
| Studio folder right-click       | Opens the same ownership dialog directly                                                                         | Pass   |
| Studio composite owner          | UI + Connector locked required; Hook, Store, Logic, API, and Types selectable                                    | Pass   |
| Native name/focus audit         | `OwnershipAudit` remained after waiting; all optional selections remained checked                                | Pass   |
| Native exact-path preview       | Preview derived the kebab-case folder and seven related canonical file names; audit was cancelled without writes | Pass   |
| Native writer boundary          | Feature, Slot, and Part requests with `createConnector:false` are rejected                                       | Pass   |
| VS Code Explorer                | Exact owner folders expose only their valid actions; arbitrary folders are rejected                              | Pass   |
| VS Code composite scaffold      | Multi-select optional files, duplicate preflight, no overwrite, and one coherent WorkspaceEdit                   | Pass   |
| VS Code local installation      | Installed in Windows, WSL, and WSL-server extension roots                                                        | Pass   |
| MCP machine-readable resource   | Publishes the same owner actions, naming policy, required/optional files, and write policy                       | Pass   |
| MCP packaged stdio bundle       | Starts successfully and publishes all four documentation resources                                               | Pass   |
| Codex plugin skill              | Strict owner resolution and no-arbitrary-write workflow documented; plugin and skill validators pass             | Pass   |
| Website/reference documentation | Portal project anatomy and generated architecture reference include the same strict creation matrix              | Pass   |
| Exact architecture profile      | Explicit architecture requires `feature-slot-part-v1`; missing/unsupported profiles fail closed                  | Pass   |
| Live generated validator config | Generated validation reloads current roots/directories/suffixes rather than a baked scaffold snapshot            | Pass   |
| Recoverable filtered CLI watch  | Project-root watch filters to config/tsconfig/entry/resolved roots and future roots, surviving invalid config    | Pass   |
| Strict TypeScript alias policy  | Root JSONC only; `extends`, nonempty `references`, and `baseUrl` rejected; exact/slash-terminal `/*` paths only  | Pass   |
| Authoritative outside entry     | Configured entry is counted and receives strict UI/import checks outside ownership roots                         | Pass   |
| Resolved Studio path preview    | Exact files, safe moves, and rewires come from the canonical planner with configured directories/suffixes        | Pass   |

Native follow-up evidence:

```text
C:\Users\beste\AppData\Local\Temp\srijika-native-right-click-dialog.png
C:\Users\beste\AppData\Local\Temp\srijika-native-strict-feature-preview2.png
```

## Automated verification

This table is the immutable 2026-08-13 audit snapshot. The expanded 2026-08-16
suite and current counts are recorded in
`SHARED_ARCHITECTURE_AUDIT_2026-08-16.md` and supersede these historical totals.

| Gate                             | Final result                                                |
| -------------------------------- | ----------------------------------------------------------- |
| `pnpm test`                      | ✅ 71 files, 411 tests                                      |
| `cargo test --workspace`         | ✅ 61 tests                                                 |
| `cargo check -p srijika-studio`  | ✅                                                          |
| `pnpm typecheck`                 | ✅ all participating workspace projects; portal 0/0/0       |
| `pnpm build`                     | ✅ VS Code, MCP server, Studio; final portal build 25 pages |
| `pnpm lint`                      | ✅ zero errors and zero warnings                            |
| `git diff --check`               | ✅                                                          |
| architecture-rules focused suite | ✅ 30 tests                                                 |
| generated-project smoke          | ✅ 19 tests, frozen install, validation, typecheck, build   |
| VS Code extension suite          | ✅ 18 tests                                                 |
| Studio strict-creation suites    | ✅ 15 tests                                                 |
| MCP stdio packaged smoke         | ✅                                                          |

The production Studio build still reports a non-blocking large-chunk warning
for the main JavaScript bundle. Correctness is green; code splitting remains a
performance follow-up.

## Reusable release checklist

- [x] Cold native launch and explicit project choices.
- [x] Resume/open a real desktop project.
- [x] Switch multiple UI sources and compare Source, OPEN marker, preview, UI
      Nodes, and Inspector identity.
- [x] Hold focus through at least one runtime refresh while typing a creation
      name.
- [x] Create a Feature with UI, Connector, Hook, Store, Logic, API, and Types.
- [x] Verify exact disk paths and the full generated import chain.
- [x] Exercise Slot/Part composite plans and standalone capability plans through
      React integration tests and real-filesystem Rust tests.
- [x] Verify missing UI/Connector, no-jump, UI isolation, private ownership,
      direct-child UI, and reverse-dependency errors.
- [x] Verify Logic, Hook, Store, and Hook-above-Store recommendation evidence.
- [x] Confirm recommendations do not turn the green architecture status red.
- [x] Verify Studio, portable/browser validator, and VS Code diagnostic parity.
- [x] Verify MCP resource, Codex skill guidance, website docs, and generated
      portal reference.
- [x] Generate a new project; frozen install, validate, typecheck, and build.
- [x] Run full TypeScript, Rust, lint, diff, and production build gates.
- [x] Record native screenshots and any honest external-tool limitation.
- [x] Open the same strict creation dialog from folder `+` and right-click.
- [x] Reject missing Connectors at the native writer boundary.
- [x] Install and validate the VS Code Explorer creation command locally.
- [x] Validate the packaged Codex/MCP bundle and strict creation resource.

### Audit history

- 2026-08-13: progressive Feature/Slot/Part architecture implemented end to
  end; native Feature chain created with system input; all correctness gates
  green; post-change live browser control and current-task MCP bridge limits
  documented.
- 2026-08-13: strict ownership-aware folder creation unified across Studio,
  native writer, VS Code Explorer, MCP resource, Codex skill, and portal docs;
  native input/focus/path preview and packaged MCP startup re-audited.
- 2026-08-16: release-blocker parity hardened: explicit architecture profiles
  fail closed, generated validation reads current config, filtered watch mode
  recovers through invalid config and follows current/future roots, strict root
  JSONC aliases reject `extends`, nonempty `references`, and `baseUrl`, the
  authoritative outside-root entry remains covered, and VS Code/Studio path
  previews use canonical planner output.
