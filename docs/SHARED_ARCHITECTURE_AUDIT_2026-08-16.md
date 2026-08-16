# Srijika strict Shared architecture audit — 2026-08-16

## Result

Srijika now uses one deterministic ownership contract across the public CLI,
generated projects, VS Code extension, Studio desktop application, portable
project validator, MCP server, Codex plugin, and documentation website.

The cross-feature boundary is no longer a freehand `src/shared` directory. It
contains exactly three public owner shapes:

```text
src/shared/
├─ ui/             pure Shared UI Primitives
├─ widgets/        UI + Connector Shared Widgets
└─ capabilities/   headless Shared Capabilities
```

The implementation was verified through unit, integration, contract,
generated-project, MCP stdio, production-build, Rust, and native Tauri/WebDriver
gates. Existing unrelated `release-bundles` workspace changes were excluded
from this work.

Legend: ✅ verified; ⚠️ verified source/bundle with the stated local-environment
limitation.

## Canonical owner shapes

### Shared UI Primitive

```text
src/shared/ui/action-button/
├─ ActionButton.ui.tsx       required
└─ actionButton.types.ts     optional, type-only
```

A Primitive is behavior-free. It receives values, events, and composition
through typed props. It has no Connector, Hook, Store, Logic, or API.

### Shared Widget

```text
src/shared/widgets/user-menu/
├─ UserMenu.ui.tsx           required
├─ UserMenu.connector.tsx    required
├─ useUserMenu.ts            optional Hook gateway
├─ userMenu.store.ts         optional Store
├─ userMenu.logic.ts         optional Logic
├─ userMenu.api.ts           optional API
└─ userMenu.types.ts         optional, type-only
```

A Widget is a complete visual owner. Its Connector is its public runtime
boundary and follows the same highest-available chain as Feature, Slot, and
Part owners.

### Shared Headless Capability

```text
src/shared/capabilities/auth/
├─ useAuth.ts                optional Hook/public gateway
├─ auth.store.ts             optional Store/public fallback
├─ auth.logic.ts             optional Logic/public fallback
├─ auth.api.ts               optional API/public fallback
└─ auth.types.ts             optional, type-only
```

A headless Capability has no UI or Connector and must contain at least one
runtime capability: Hook, Store, Logic, or API. Types alone are rejected.

## Ownership and promotion

```text
one Part needs behavior      → keep it in that Part
two Parts need behavior      → promote it to their Slot
two Slots need behavior      → promote it to their Feature
two Features need behavior   → promote it to Shared
```

Children are composed only through their public Connector. Private UI, Hook,
Store, Logic, and API files cannot be imported sideways, upward, or across
Feature boundaries. Shared cannot depend on Features, and public Shared
runtime owners cannot form dependency cycles.

Deterministic recommendations now emit:

- `SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER` with the exact target owner;
- `SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER` only above the documented measurable
  UI/contract thresholds.

## Runtime and type rules

The runtime chain is:

```text
Connector → Hook → Store → Logic → API
```

Only capabilities that are needed are created. Every caller selects the
highest available next capability and cannot jump over an existing boundary.
`Types` is passive and is never a runtime hop.

Every file ending in the resolved UI suffix (canonical default `.ui.tsx`)—Feature, Slot, Part, Shared Widget, or Shared
Primitive—is behavior-free. The validator rejects React state/effect hooks,
browser/request APIs, routers, state libraries, and other executable runtime
imports in UI. UI may use typed props, supplied event callbacks, JSX-safe
presentational components, styles, and assets.

Every file ending in the resolved Types suffix (canonical default `.types.ts`) contains type contracts only. Consumers must use
`import type` or `export type`; runtime declarations and value references are
rejected.

Logic remains framework-independent. Validation, authorization,
transformation, and deterministic orchestration belong there. React,
TanStack Query lifecycle, routers, state libraries, and Hook/query lifecycle
calls are rejected from Logic and belong in Hook, Connector, or Store. HTTP
transport remains in API.

## Stable blocking diagnostics

| Numeric code  | Stable rule ID                           | Meaning                                     |
| ------------- | ---------------------------------------- | ------------------------------------------- |
| `SRIJIKA4101` | `SRIJIKA-ARCH-UI-RUNTIME-IMPORT`         | UI contains runtime behavior                |
| `SRIJIKA4109` | `SRIJIKA-ARCH-MISSING-CONNECTOR`         | a visual runtime owner lacks its Connector  |
| `SRIJIKA4110` | canonical/freehand structure rule        | noncanonical owner/category/name            |
| `SRIJIKA4113` | `SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY` | invalid Shared dependency or cycle          |
| `SRIJIKA4116` | `SRIJIKA-ARCH-DIRECT-CHILD-UI`           | parent bypasses a child Connector           |
| `SRIJIKA4117` | `SRIJIKA-ARCH-PASSIVE-TYPES`             | Types contains or is consumed as runtime    |
| `SRIJIKA4118` | `SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN`     | Logic contains framework/lifecycle behavior |
| `SRIJIKA4119` | `SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT` | computed module target cannot be proven     |
| `SRIJIKA4120` | `SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS`  | local/reserved alias does not resolve       |
| `SRIJIKA4121` | `SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT` | relative/project source is missing/outside  |

Existing no-jump, private-import, sibling, cross-Feature, reverse-dependency,
missing-UI, and missing-Connector codes remain consumer-compatible.

## Strict configurable architecture

All product surfaces resolve the same twelve `srijika.config.json` fields:

```text
featuresRoot, sharedRoot,
slotsDirectory, partsDirectory, hooksDirectory, storesDirectory,
uiSuffix, connectorSuffix, storeSuffix, logicSuffix, apiSuffix, typesSuffix
```

The shared resolver rejects absolute paths, drive paths, traversal, empty
segments, backslashes, NUL characters, overlapping roots, duplicate structural
directories, case-insensitive duplicate suffixes, suffixes that end with one
another, `.d.ts`/`.d.tsx` declaration suffixes, and
filesystem writes through symlink ancestors. Roots are bounded to ten path
segments. Studio's native Rust writer applies the same constraints.

Source discovery includes TypeScript and JavaScript-family files so `.js`,
`.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs` cannot bypass architecture checks.

Configuration loading is explicit and fail-closed:

- no `architecture` block means canonical defaults;
- an explicit block must declare exact profile `feature-slot-part-v1`; and
- missing/unsupported explicit profiles fail on generated validation, CLI,
  VS Code, Studio, and MCP rather than silently falling back.

The complete project also requires exact `sourceOfTruth: "tsx"` and a bounded
configured UI entry ending in the resolved UI suffix. The entry is included in
validation and the 4,096-source budget even when it is outside the configured
ownership roots; it remains a behavior-free UI and receives
`SRIJIKA4119`–`SRIJIKA4121` checks.

Root `tsconfig.json` is JSONC and is the only custom alias authority. `extends`
is rejected, `references` may be absent or empty but not nonempty, and
`compilerOptions.baseUrl` must be omitted. Only exact and slash-delimited
terminal `/*` `compilerOptions.paths` mappings are accepted; the first target
must stay inside the project. Vite-only aliases are unsupported until mirrored
there.

Parity is live after generation. `scripts/srijika-validate.mjs` reloads current
config on every run. `srijika check --watch` uses a filtered project-root
watcher for config, `tsconfig.json`, entry, resolved roots, and future-root
ancestors; it stays alive through temporarily invalid configuration and resumes
resolved filtering after recovery. VS Code/Studio **Exact files and safe move/rewire**
previews are canonical planner output under the full resolved naming contract.
No surface retains or reconstructs a hardcoded `src`/default-suffix snapshot.

## Creation surfaces

| Surface           | Strict behavior                                                                                  | Result |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Public starter    | `npm create srijika@latest [name]`; missing name is prompted                                     | ✅     |
| CLI               | `srijika add shared-ui`, `shared-widget`, and `shared-capability`                                | ✅     |
| Generated project | MCP config, portable validator, AGENTS contract, and canonical folders                           | ✅     |
| VS Code           | Shared tree, contextual `+`/right-click creation, checklist, flat-to-folder Hook/Store promotion | ✅     |
| Studio            | Same three Shared cards, exact preview, safe native apply, configured paths                      | ✅     |
| MCP/Codex         | Inspect, check, preview, and apply the same canonical plans                                      | ✅     |
| Portal            | CLI, VS Code, Studio, anatomy, architecture, and authoring docs synchronized                     | ✅     |

Hook and Store gateways start flat for a small owner. Adding a second named
Hook or Store atomically promotes the gateway into `hooks/` or `stores/`,
rewrites every safe import, and prevents a mixed flat/folder layout.

## Starter dependency policy

The default starter is minimal and does not install TanStack Query or generate
`AppProviders.tsx`/`query-client.ts`. Query lifecycle is opt-in:

```bash
npm create srijika@latest my-app -- --react-query
```

Both default and React Query variants are covered by real frozen-install,
portable-validation, typecheck, and production-build smoke tests.

## Verification record

| Gate                     | Result                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Full workspace lint      | ✅ zero warnings                                                                             |
| Full workspace typecheck | ✅ all workspace projects                                                                    |
| Architecture rules       | ✅ 110 tests across canonical/config/creation/portable parity                                |
| Project scaffold         | ✅ 31 active tests; 3 environment-gated generated-project smokes                             |
| Developer Engine         | ✅ 30 tests; bounded configured-root scan, entry, aliases, and plan parity                   |
| Public CLI/launcher      | ✅ 17 CLI tests plus fresh-project workflow coverage                                         |
| VS Code extension        | ✅ typecheck and 69 tests                                                                    |
| Studio                   | ✅ 208 unit, 201 integration, and 24 contract tests                                          |
| Rust `studio-core`       | ✅ 66 tests, `cargo check`, and `cargo fmt --check`                                          |
| MCP/plugin               | ✅ 32 tests plus code-project, generated-project/apply, isolated-bundle, and stdio smoke     |
| Portal                   | ✅ Astro check/build, 32 pages, zero diagnostics                                             |
| Native desktop           | ✅ release Tauri binary opened through WebDriver; Shared shapes and promotion ladder visible |
| NPM release              | ✅ version `0.2.0`, package build and publish-safety verification                            |

Native screenshot evidence is written to:

```text
test-results/tauri-code-first-shared.png
```

The built Codex plugin bundle and manifest validate successfully. Reinstalling
that local plugin from WSL is ⚠️ blocked only by the host WindowsApps Codex
executable permission boundary (`exit 126`); this does not affect the validated
plugin source or bundle.

The existing Vite large-chunk advisory remains a non-blocking production-build
warning. No architecture, type, lint, test, or release gate is waived for it.

## Release and deployment

Public npm packages and the VS Code extension are prepared at version `0.2.0`.
The repository's GitHub Release workflow publishes the npm packages after the
change is merged and a release is created. The documentation portal remains in
the existing repository/Dockploy flow; no Cloudflare deployment path is added.
