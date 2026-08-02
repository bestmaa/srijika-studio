# Roadmap and deliberate limits

## Phase 1 — UI MVP

Implemented in the repository:

- canonical version 1 UI AST, runtime validation, graph invariants, and registry-aware semantic analysis;
- revision-checked command envelopes, atomic repeater creation, bounded/coalesced undo/redo;
- actual-DOM React renderer, component registry, and eight core visual components;
- palette, hierarchy, drag/drop, Inspector, typed bindings, public props, conditions, repeaters, and expressions;
- transient true/false branch authoring without changing runtime `If` behavior;
- canonical JSON and deterministic core-component TSX views;
- same-origin Vite browser preview with live synchronization;
- browser import/export and native dialog-backed atomic JSON persistence; and
- contract, unit, integration, accessibility, visual, browser E2E, and Rust coverage.

The Linux Tauri shell check, build, full-workspace tests, and Clippy gates pass when its native libraries are available. An interactive run in a fresh WSL installation first requires the packages listed in [Development setup](DEVELOPMENT.md).

## Phase 1.1 — UI platform hardening

These are not part of the current MVP:

- multi-page/project navigation and a project-file orchestrator around the existing page/component document schema;
- a reusable design-token, class, breakpoint, and component-variant registry;
- public custom-component package loading and registry-supplied TSX code-generation adapters;
- generics, multi-argument/result-bearing actions, and custom connector-reference implementations;
- explicit format and component migration runners when version 2 is introduced;
- an embedded, verified Node LTS sidecar plus Node/package-manager version switching;
- a packaged loopback preview host that opens the generated application in an external browser; and
- signed Windows, macOS, and Linux release pipelines on native/compatible CI runners.

## Phase 2 — API and business logic

- versioned API documents and typed request/response/payload schemas;
- Rust routes, actions, validation, and workflow graph;
- state/resource/action symbol providers connected to the existing expression system;
- editor panels for endpoint composition, data binding, diagnostics, and local execution;
- stable action IDs for UI event bindings; and
- generation of Vite assets plus Rust routes/assets into one deployable server binary and one configured port.

The UI AST will continue to describe presentation and typed connections; it will not contain arbitrary backend business logic.

## Phase 3 — AI and extensibility

- schema- and manifest-aware natural-language project commands;
- reviewable, base-revision command transactions using the existing engine and semantic validator;
- safe custom hooks/code-reference packaging and capability permissions;
- plugin SDK and reusable component marketplace boundaries; and
- collaboration transport and eventual CRDT support.

AI will propose typed commands, never patch raw JSON text or mutate the design DOM directly.
