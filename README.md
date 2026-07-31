# Sutra Studio

Sutra Studio is a DOM-native visual UI editor. A versioned JSON document is the canonical source of truth; the hierarchy, schema-driven Inspector, live React renderer, JSON view, and deterministic TSX generator are projections of that document.

## UI MVP

The repository currently implements:

- a Tauri 2/Rust desktop boundary with a React 19 and strict TypeScript 6 editor;
- an actual HTML/CSS design surface—there is no canvas or SVG-to-HTML conversion;
- palette insertion, cross-frame drag/drop, hierarchy selection and movement, undo/redo, and desktop/tablet/mobile viewports;
- manifest-driven Inspector controls for props, event bindings, base styles, class references, visibility, public props, `If` branches, and `Repeat` sources;
- a normalized, runtime-validated JSON/JSX-compatible AST with typed expressions, stable symbols, revision-checked commands, and semantic diagnostics;
- an interpreted React preview, canonical JSON output, and deterministic TSX output;
- a same-origin browser preview at `/preview`, synchronized with the editor during Vite development;
- browser import/export plus native Tauri open/save dialogs backed by bounded, atomic Rust persistence; and
- contract, unit, integration, accessibility, visual, browser E2E, and Rust tests.

API/business logic, AI command generation, a project-wide design-token/class registry, third-party code-generation adapters, an embedded Node version manager, and a packaged loopback preview server are planned extension points, not current MVP features. See [the roadmap](docs/ROADMAP.md).

## Quick start in WSL

The repository is tested with Node.js 22.22.1 (the declared minimum is 22.13), pnpm 11.18.0, TypeScript 6.0.3, and Rust 1.97.1.

```bash
cd /home/beste/project/sutra-studio
pnpm install --frozen-lockfile
pnpm dev
```

Open the editor at `http://localhost:5173/` and the standalone live preview at `http://localhost:5173/preview`. Port 5173 is strict: startup fails instead of silently selecting another port.

The Linux Tauri shell requires WebKitGTK and other native packages. Install the exact WSL prerequisites from [Development setup](docs/DEVELOPMENT.md) before running `pnpm tauri dev`.

## Quality gates

```bash
pnpm verify
pnpm test:e2e:web
cargo fmt --all -- --check
cargo clippy --locked -p project-store -p studio-core -- -D warnings
cargo test --locked -p project-store -p studio-core
```

Full-workspace Rust checks include the Tauri shell and therefore require the native packages documented above.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [UI document format](docs/UI_DOCUMENT_FORMAT.md)
- [Command and history system](docs/COMMAND_SYSTEM.md)
- [Component authoring](docs/COMPONENT_AUTHORING.md)
- [Development setup](docs/DEVELOPMENT.md)
- [Testing strategy](docs/TESTING.md)
- [MVP acceptance checklist](docs/MVP_ACCEPTANCE.md)
- [Roadmap and deliberate limits](docs/ROADMAP.md)
