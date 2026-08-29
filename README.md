# Srijika Studio

[![Continuous integration](https://github.com/bestmaa/srijika-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/bestmaa/srijika-studio/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Srijika Studio is a code-first React application studio. Restricted, typed source ending in the resolved UI suffix (canonical default `.ui.tsx`) is the single persisted UI source of truth; the hierarchy, contract Inspector, diagnostics console, and live React preview are derived projections. `UiDocument` remains the validated renderer IR, but Studio never saves it back over developer-owned TSX.

## Code-first milestone

The repository currently implements:

- a Tauri 2/Rust desktop boundary with React 19 and strict TypeScript 6;
- deterministic new-project scaffolding plus no-overwrite UI and architecture-aware
  Feature → Slot → Part creation with optional Connectors, Stores, and Hooks;
- a non-executing restricted-TSX compiler that emits source diagnostics, quick fixes, stable source ranges, and a derived `UiDocument`;
- a real Project Explorer, project-wide resolved-UI-suffix index, derived DOM preview, read-only source viewer, UI Nodes hierarchy, prop-contract Inspector, and Studio problems console;
- last-good preview behavior when the current source has errors;
- safe native resolved-UI-suffix reads, optimistic hash-checked atomic saves, and explicit non-overwriting project creation;
- direct project/file/node navigation into VS Code plus a managed frozen-lockfile install, run, open, stop, and build lifecycle;
- a polished interactive one-page Srijika starter that demonstrates pure UI, connector state, typed events, slots, responsive styling, and the pinned project toolchain;
- a Srijika VS Code extension for the same compiler diagnostics and fixes,
  including a bounded live App → Feature → Slot → Part / Shared import-export
  Structure Graph for individual projects and monorepo packages; and
- a shared Node-compatible CLI/developer engine for strict creation, incremental
  architecture checks, Vite HMR, toolchain doctoring, Desktop handoff, and optional
  explicit Bun turbo mode;
- first-class monorepo discovery with a validated workspace manifest, generated
  VS Code/MCP routing, and aggregate Vite/Next owner-test verification;
- fail-closed brownfield adoption for populated Next.js App Router applications,
  with a no-write plan, immutable source baseline, report-only diagnostics,
  create-only metadata, and engine-run typecheck/build gates; and
- the existing schema, component registry, renderer, semantic analyzer, and preview channel as reusable lower layers.

The old palette/drag/drop/Inspector mutation surfaces remain in the repository while migration tests are retained, but they are no longer active authoring entry points. A visual operation may return only when it can produce a bounded TSX source edit and pass through the normal compiler path. See [Code-first Srijika TSX](docs/CODE_FIRST_TSX.md).

## Quick start in WSL

The repository is tested with Node.js 22.22.1 (the declared minimum is 22.13), pnpm 11.18.0, TypeScript 6.0.3, and Rust 1.97.1.

```bash
cd /path/to/srijika-studio
pnpm install --frozen-lockfile
pnpm dev
```

Open the editor at `http://localhost:5173/` and the standalone live preview at `http://localhost:5173/preview`. Port 5173 is strict: startup fails instead of silently selecting another port.

Browser mode provides an in-memory project and does not receive filesystem, VS Code,
or process-launch authority. For the real independent-project workflow, start the
desktop shell:

```bash
pnpm tauri dev
```

The packaged developer workflow is also available without opening Desktop:

```bash
pnpm cli:build
pnpm srijika doctor /path/to/project
pnpm srijika check /path/to/project
pnpm srijika dev /path/to/project
pnpm srijika dev /path/to/project --runtime bun
```

For a monorepo containing multiple Srijika applications:

```bash
pnpm srijika workspace init /path/to/monorepo --dry-run
pnpm srijika workspace init /path/to/monorepo
pnpm srijika workspace check /path/to/monorepo
pnpm srijika workspace tests sync /path/to/monorepo
```

See [Srijika in a monorepo](docs/MONOREPO.md) for the manifest, Vite/Next,
Playwright, VS Code, MCP, Studio, CI, and shared-package contracts.

For an existing populated Next.js App Router application:

```bash
npx @srijika/cli adopt . --framework next --dry-run --json
npx @srijika/cli adopt . --framework next --json
```

See [Adopt an existing Next.js App Router project](docs/NEXT_ADOPTION.md) for
the no-overwrite transaction, server/framework classifications, merge
instructions, and verification gates.

Node remains the compatibility default. Bun is an optional explicit Vite runtime;
dependency installation always follows the project's declared package manager and
lockfile.

`New project` creates a complete folder containing `package.json`, `pnpm-lock.yaml`,
`srijika.config.json`, `srijika.toolchain.json`, source, assets, editor recommendations,
and a build-time architecture validator. The canonical starter lives at
`src/features/home`: its pure `Home.ui.tsx` is composed by an optional Connector,
feature Store, and a private `slots/navigation` subtree. Select a canonical feature,
slot, or part folder in Project Explorer to add only the capabilities that owner may
contain. The new source opens immediately across Source, UI Nodes, Preview, and
Inspector. Use the compact UI Sources list or click any file ending in the resolved
UI suffix in Project Explorer to switch views; double-click opens the exact location
in VS Code. Routes, services,
and intentionally cross-feature code remain normal VS Code work under the appropriate
owner or `src/shared`.
For an attached desktop project, the center preview, `Browser preview`, and `Open App`
all use one managed Vite application. `Run App` and `Build App` re-check the lockfile
and automatically synchronize exact dependencies when required. Once the managed
loopback server is ready, Studio embeds that exact app in the center panel; Browser
Preview opens it in Srijika's separate window and Open App uses the system browser.
Project CSS, assets, dependencies, Connector behavior, routes, and HMR therefore stay
identical in all three views. The dependency-free derived preview remains available
for browser demos and detached standalone UI files. In development, the scaffold's
Vite bridge adds source-location metadata to resolved-UI-suffix elements: clicking the embedded
live app selects the matching stable UI node, source range, and Inspector entry, while
selecting a Studio node outlines that live element. `Stop` terminates the tracked
process tree.

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
- [CLI and fast runtime](docs/CLI_AND_FAST_RUNTIME.md)
- [Monorepo setup and aggregate testing](docs/MONOREPO.md)
- [Existing Next.js App Router adoption](docs/NEXT_ADOPTION.md)
- [Feature → Slot → Part ownership and structure rules](docs/FEATURE_SLOT_PART_ARCHITECTURE.md)
- [Code-first Srijika TSX rules and project flow](docs/CODE_FIRST_TSX.md)
- [UI document format](docs/UI_DOCUMENT_FORMAT.md)
- [Command and history system](docs/COMMAND_SYSTEM.md)
- [Component authoring](docs/COMPONENT_AUTHORING.md)
- [Development setup](docs/DEVELOPMENT.md)
- [Testing strategy](docs/TESTING.md)
- [MVP acceptance checklist](docs/MVP_ACCEPTANCE.md)
- [Roadmap and deliberate limits](docs/ROADMAP.md)

## Contributing

Srijika Studio welcomes bug fixes, focused features, tests, documentation, and
design discussions. Start with [CONTRIBUTING.md](CONTRIBUTING.md), use a descriptive
branch such as `fix/graph-zoom` or `feat/focused-subgraphs`, and open a pull request
with the checks you actually ran. General help belongs in GitHub Discussions;
security vulnerabilities must follow [SECURITY.md](SECURITY.md).

Community participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
and support guidance is available in [SUPPORT.md](SUPPORT.md).
