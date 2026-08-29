# Srijika Studio architecture

## Invariants

1. Restricted, typed source ending in the resolved UI suffix (canonical default `.ui.tsx`) is the only persisted UI source of truth.
2. `UiDocument`, the hierarchy, Inspector, and rendered DOM are derived read models.
3. Studio never reconstructs or overwrites a whole TSX file from derived IR.
4. A Studio visual edit is allowed only when it can produce bounded source edits, recompile, and pass validation.
5. Invalid source publishes diagnostics while preserving a visibly stale last-good preview.
6. Static TypeScript rules, Srijika source rules, runtime JSON Schema checks, graph invariants, and registry semantic checks are separate layers.
7. UI components stay pure; hooks, stores, resources, and business logic live in connectors.
8. Editor session state is not application data.

Code-first ownership is equally canonical. Feature → Slot → Part stays private
until two Features need the same boundary, then it promotes to one strict
Shared UI Primitive, Shared Widget, or Shared Headless Capability. UI is
behavior-free, Types is passive, Logic is framework/transport-free, and every
surface consumes the same resolved `srijika.config.json` planner. See
`FEATURE_SLOT_PART_ARCHITECTURE.md` for the complete naming, import, config,
scan-budget, diagnostic, and creation contract.

Next.js primitives and server/client boundaries use an explicit, versioned,
non-executing adapter. Built-in `Link`/`Image` support, project-local component
registration, safe preview projection, and `SRIJIKA5001`–`SRIJIKA5005` are
defined in `NEXT_FRAMEWORK_ADAPTER.md`.

Payload CMS projects use the additional source-only profile described in
`PAYLOAD_NEXT_INTEGRATION.md`. Payload configuration, schema, routes, Local API,
storage, migrations, and generated contracts remain server-owned surfaces.

## Repository and dependency direction

```text
packages/contracts
├── packages/document-engine
├── packages/component-registry ── packages/core-components
├── packages/react-renderer
├── packages/react-codegen (legacy/debug projection)
├── packages/tsx-compiler
└── packages/project-scaffold

apps/studio
├── project explorer / read-only source viewer consuming all UI packages
├── UI Nodes / source diagnostics / derived preview / Inspector
└── src-tauri ── crates/studio-core ── crates/project-store

apps/vscode-srijika
└── VS Code diagnostics and source quick fixes using the same TSX compiler

tests
├── contracts, unit, and integration
└── e2e (Playwright and visual baseline)
```

`react-renderer` has no dependency on the Studio editor. Rust deliberately validates the stable persistence envelope and graph identity, while TypeScript owns the complete versioned UI schema. This avoids maintaining two full AST implementations.

## Canonical compile and edit path

```text
resolved UI source ── parse restricted TSX ── Srijika diagnostics/source map
       │                         │
       │                         ├── invalid: keep last-good IR, mark stale
       │                         │
       │                         └── valid: derive and validate UiDocument
       │                                      │
       │                           ┌──────────┼──────────┐
       │                           ▼          ▼          ▼
       │                       hierarchy  Inspector  React DOM
       │
       └── source edit intent ← quick fix / supported visual edit
                 │
                 └── bounded AST edit → hash-checked save → compile again
```

The existing command/history engine remains useful for derived-document tests and migration tooling, but it is not an authoring authority. Palette drops, hierarchy moves, old Inspector setters, JSON imports, and bridge operations that mutate `UiDocument` are absent from the active code-first shell. Future AI and visual tools must propose TSX source edits.

## Persisted source versus derived/session state

The source file contains JSX structure, the named props interface, conditions, attributes, and developer formatting/comments. The compiler emits a `UiDocument`, diagnostics, and stable node/prop spans. Selection, active diagnostic, preview-stale state, dirty state, and disk hash are Studio session state. The derived document is never independently saved.

The desktop project session additionally owns one validated project root, a bounded
flat file index, the active resolved-UI-suffix path, hashes for every indexed UI source, and
managed runtime status. Project Explorer shows real files; UI Nodes shows the
compiled JSX hierarchy for the active UI file. They deliberately remain separate,
matching the asset-versus-scene distinction in established visual studios.

Project-scoped creation accepts only the canonical planner actions for Feature,
Slot, Part, strict Shared owners, optional owner capabilities, and named
Hook/Store expansion. The native boundary resolves the configured roots,
directories, and suffixes; derives the PascalCase/kebab-case owner identity;
preflights the complete plan; and applies its creates, moves, and rewires as one
non-overwriting transaction. Browser mode uses the same canonical TypeScript
planner in its in-memory file map. After creation, the normal scan/load pipeline
activates the new source; there is no second hierarchy authority.

Manual text editing belongs to VS Code. The Studio source surface is read-only but
retains exact diagnostic and node-range selection. Double-clicking a project, file,
or UI node asks the native boundary to validate containment and launch VS Code with
fixed arguments. Supported quick fixes and visual edits remain bounded AST source
operations, not free-form editor mutations.

## Rendering and preview paths

The code-first design surface renders the last successfully compiled `UiDocument` as real React elements. Edit mode adds selection metadata; preview mode omits editor overlays. Srijika parses TSX but does not execute arbitrary project code to construct the read model.

During `pnpm dev`, Vite listens on strict port 5173:

```text
last valid derived document
├── localStorage snapshot ── initial /preview hydration
└── BroadcastChannel ─────── live /preview updates
```

`http://localhost:5173/preview` remains an interpreted, same-origin renderer preview. Only successful compile results are published. When the active source becomes invalid, the Studio surface explicitly labels the retained preview as stale.

## Native persistence boundary

In a Tauri window, project/source operations use `tauri-plugin-dialog` and narrow code-first Rust commands:

```text
native dialog
  → create_code_project / create_code_project_ui_source
  → open_code_project / scan_code_project
  → load_tsx_source / save_tsx_source / open_in_vscode / open_code_project_app
  → studio-core path, extension, size, and conflict validation
  → explicit project creation, deterministic indexing, or atomic source replacement
```

Project creation refuses roots, symlink targets, existing destinations, path traversal, oversized files, and excessive aggregate size. Tree scans are bounded, ignore generated/vendor directories, never follow symlinks, and hash indexed UI files. TSX reads are limited and accept only the resolved UI suffix. Saves use an expected content hash to reject concurrent VS Code changes and atomically replace the file. Editor targets must resolve inside the same validated project. Browser mode uses an in-memory file map and never receives native path or process authority.

## Design preview and managed application runtime

Browser demos and detached UI previews are dependency-free: Studio parses restricted
TSX in-process and uses its bundled renderer. That fallback never evaluates project
imports or mixes the project's React runtime into the editor. Configured CSS, SVG
assets, and design-time prop values are read through a bounded native boundary and
rendered in an isolated frame. An attached desktop project instead embeds the managed
Vite or Next.js application in the center preview after readiness, making the real project the
fidelity path for CSS, dependencies, routes, Connector behavior, assets, and HMR.

The independent application is a normal pinned React/Vite workspace. A generated
project includes exact dependency versions, `packageManager`, `pnpm-lock.yaml`, and
`srijika.toolchain.json`. Full Run/Build follows a separate lifecycle:

```text
validated project root
  → runtime status
  → immutable install from the nearest declared npm/pnpm/Yarn/Bun lockfile (only when needed)
  → declared framework dev script on fixed loopback / declared build script
  → tracked readiness, system-browser open, stop state, and capped diagnostics output
```

`Open App` accepts only a validated project root. Native code derives the URL from a
Studio-tracked child and opens it only after `127.0.0.1:<port>` is accepting
connections; the frontend cannot supply an arbitrary URL. Desktop `Browser preview`
resolves that same native target and loads it in a dedicated webview, so it is the real
managed application rather than another derived renderer. The center desktop preview
uses the same validated runtime URL inside a sandboxed iframe. Browser-mode and
detached UI preview continue to use the dependency-free derived route. Native commands use fixed
executables and argument arrays, never shell strings. The
current development baseline resolves the declared npm/pnpm/Yarn/Bun manager and VS Code from the host environment;
the boundary is structured so signed platform builds can substitute verified bundled
sidecars without changing project metadata or frontend behavior.

The Vite serve-only transform and Next development-only loader annotate rendered resolved-UI-suffix elements with
relative source locations. A versioned parent/iframe message bridge validates the
tracked loopback origin and converts those locations through the compiler source map
to stable node IDs. This keeps live-app clicks, UI Nodes, source selection, and the
Inspector synchronized without granting the embedded project Tauri IPC capability or
persisting instrumentation in production output. Next route selection is derived
from bounded App Router page files; route groups, dynamic parameters, loading, and
error boundaries stay framework-owned, and every resolved route remains on the
tracked loopback origin.

## Node and desktop build model

Node/Vite remain generated-project run/build tools. The Studio read model uses the TypeScript parser in-process and does not invoke a generated application or evaluate its imports. A production Tauri bundle embeds the built Studio assets and does not need Node merely to inspect source. Dependency and application tasks are managed separately and report toolchain availability explicitly.

The current repository does **not** check platform Node/package-manager binaries into source control. Development builds resolve the validated declared manager from the host environment; release packaging can provide verified sidecars behind the same native runner. Windows, macOS, and Linux desktop artifacts must be built and signed on their native CI runners; a WSL build produces a Linux application.

## AI boundary

AI receives the same Srijika TSX rules and diagnostics as a developer. It should edit files ending in the resolved UI suffix and matching Connector files, never mutate or persist derived `UiDocument`. Compiler quick fixes are machine-readable source edits, which gives future AI tools a bounded, reviewable correction path.
