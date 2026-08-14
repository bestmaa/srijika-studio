# Roadmap and deliberate limits

## Current — code-first UI foundation

Implemented in the repository:

- restricted typed TSX as the single persisted UI source of truth;
- TSX compiler diagnostics, quick fixes, source maps, conditional expressions, nullish fallback, and connector slots;
- normalized typed `() => void` event props for safe button bindings;
- last-good derived `UiDocument` preview with explicit stale state on errors;
- full Project Explorer, project-wide UI-source indexing, read-only source navigation, UI Nodes, contract/diagnostics Inspector, and Studio problems console;
- exact file/node VS Code deep links validated at the native project boundary;
- deterministic React 19 project scaffolding with a polished interactive Home page, React Compiler, Connector + UI Slot structure, exact versions, and a portable frozen lockfile;
- safe project create/open plus bounded, hash-checked atomic `.ui.tsx` persistence;
- native managed dependency status/install, application start/stop, and production build commands; and
- VS Code diagnostics and Quick Fixes powered by the same compiler; and
- retained actual-DOM renderer, component registry, semantic analyzer, appearance, and preview surfaces.

The older palette/IR mutation UI and command engine remain as inactive migration/test infrastructure until an operation has a lossless TSX source writer. They are not active Studio authoring entry points.

The Linux Tauri shell check, build, full-workspace tests, and Clippy gates pass when its native libraries are available. An interactive run in a fresh WSL installation first requires the packages listed in [Development setup](DEVELOPMENT.md).

## Next — code-first platform hardening

These remain beyond the current milestone:

- rename/move filesystem transactions and event-driven native watching (the current index uses bounded hash refreshes);
- additional lossless Studio-to-TSX visual edits beyond literal text and compiler quick fixes;
- a reusable design-token, class, breakpoint, and component-variant registry;
- public custom-component package loading and registry-supplied TSX code-generation adapters;
- generics, multi-argument/result-bearing actions, and custom connector-reference implementations;
- explicit format and component migration runners when version 2 is introduced;
- signed embedded Node/pnpm sidecars and toolchain version switching (development builds currently resolve fixed host commands);
- signed Windows, macOS, and Linux release pipelines on native/compatible CI runners.

## Phase 2 — API and business logic

- versioned API documents and typed request/response/payload schemas;
- Rust routes, actions, validation, and workflow graph;
- state/resource/action symbol providers connected to the existing expression system;
- editor panels for endpoint composition, data binding, diagnostics, and local execution;
- stable action IDs for UI event bindings; and
- generation of Vite assets plus Rust routes/assets into one deployable server binary and one configured port.

Restricted UI TSX will continue to describe presentation and typed connections; it will not contain backend business logic.

## Phase 3 — AI and extensibility

- schema- and compiler-aware natural-language project edits;
- reviewable source transactions using expected hashes, compiler diagnostics, and the semantic validator;
- safe custom hooks/code-reference packaging and capability permissions;
- plugin SDK and reusable component marketplace boundaries; and
- collaboration transport and eventual CRDT support.

AI will propose typed TSX/connector source edits, never patch derived JSON or mutate the design DOM directly.
