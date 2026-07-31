# Sutra Studio architecture

## Invariants

1. A versioned `UiDocument` is the only persisted UI source of truth.
2. The DOM is a projection. Editor code does not persist DOM mutations.
3. Every persisted edit is a serializable semantic command with a document ID and base revision.
4. Static TypeScript checks, runtime JSON Schema checks, graph invariants, and registry-aware semantic checks are separate layers and all matter.
5. Editor session state is not application data.
6. Ordinary expressions are interpreted data and never use `eval`; advanced custom code is represented by a typed reference.
7. The editor UI, rendered project UI, native services, and future business logic keep explicit boundaries.

## Repository and dependency direction

```text
packages/contracts
├── packages/document-engine
├── packages/component-registry ── packages/core-components
├── packages/react-renderer
└── packages/react-codegen

apps/studio
├── React editor consuming all UI packages
└── src-tauri ── crates/studio-core ── crates/project-store

tests
├── contracts, unit, and integration
└── e2e (Playwright and visual baseline)
```

`react-renderer` has no dependency on the Studio editor. Rust deliberately validates the stable persistence envelope and graph identity, while TypeScript owns the complete versioned UI schema. This avoids maintaining two full AST implementations.

## Canonical edit path

```text
Palette / hierarchy / Inspector
              │
              ▼
revision-checked CommandEnvelope
              │
              ▼
apply command to cloned document
              │
              ├── graph validation
              └── component-registry semantic validation
              │
              ▼
commit revision and bounded undo history
              │
       ┌──────┼───────────┬──────────────┐
       ▼      ▼           ▼              ▼
 hierarchy  Inspector  React DOM      JSON / TSX
                       renderer       projections
```

The Studio store uses the same `CommandEnvelope` intended for future AI and migration callers. A stale base revision or wrong document ID is rejected before mutation. Repeater creation is one atomic command: the structural node and its item/index scope symbols either all appear or none do.

The component registry's semantic analyzer checks component/version existence, prop and event types, required props, slots, missing symbols, boolean conditions, array repeat sources, repeat scope ownership, and public-prop/symbol synchronization. Documents are accepted into history only after that analyzer succeeds.

## Persisted document versus session state

Persisted JSON contains nodes, expressions, symbols, public props, styling values, and the current revision used for command preconditions. Content-edit commands advance that revision; undo/redo and whole-document import restore their recorded document snapshots. Selection, hover, current panel, viewport preset, drop target, and the branch currently being authored are Studio session state.

This distinction matters for `If`. Its `condition`, `whenTrue`, and `whenFalse` arrays are persisted, but `activeIfBranches[nodeId]` is transient. An author can inspect and drop content into the false branch without changing the condition that generated code will execute.

## Rendering and preview paths

The design frame renders real React elements into an iframe with a React portal. Edit mode adds selection/drop metadata; preview mode omits those editor overlays. Props, events, named slots, structural nodes, and style values are evaluated from the AST without compiling TSX during normal editing.

During `pnpm dev`, Vite listens on strict port 5173:

```text
editor document
├── localStorage snapshot ── initial /preview hydration
└── BroadcastChannel ─────── live /preview updates
```

`http://localhost:5173/preview` is therefore an interpreted, same-origin browser preview. It verifies the renderer, not a fresh Vite compilation of generated TSX. A packaged desktop loopback server that exposes an external browser port is future work.

## Native persistence boundary

In a Tauri window, Open and Save use `tauri-plugin-dialog` and invoke only two Rust commands:

```text
native dialog
  → load_ui_document / save_ui_document
  → studio-core envelope and path validation
  → project-store bounded JSON read or atomic write
```

The Rust store limits a UI document to 32 MiB. A save writes pretty JSON to a temporary file in the destination directory, flushes and syncs it, atomically renames it, preserves existing permissions, and syncs the parent directory where supported. Browser mode uses file upload/download instead of native commands.

## Node and desktop build model

Node/Vite are development and build-time tools; they are not involved in drag/drop, Inspector edits, history, or interpreted preview rendering. A production Tauri bundle embeds the built web assets and does not need Node merely to run the editor UI.

The current MVP does **not** bundle Node as a sidecar and does not implement Node download/version switching. That toolchain manager is planned for generated-project dependency installation and compilation. Windows, macOS, and Linux desktop artifacts must be built and signed on their native CI runners; a WSL build produces a Linux application.

## Planned monolithic application boundary

The future generated application target is:

```text
UiDocument ── TSX generator ── Vite assets ─────┐
API/workflow documents ── Rust route generator ┼─ one deployable Rust binary
project assets ─────────────────────────────────┘
```

The generated Rust server is intended to serve `/`, `/assets/*`, and `/api/*` on one configured port. This is an architectural boundary, not an implemented API generator in the UI MVP. UI events will reference stable typed action IDs; business logic will not be embedded in element JSON.

## AI boundary

The command envelope and semantic analyzer are the implemented foundation for AI features. A future AI layer will read schemas, manifests, diagnostics, and a project graph, then propose a base-revision transaction of typed commands. The normal engine will validate and apply that transaction as one undoable operation. There is no AI model or natural-language command UI in the current MVP.
