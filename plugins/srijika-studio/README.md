# Srijika Studio Codex plugin

This package connects Codex to Srijika projects with or without the desktop app. The bundled MCP server can inspect a code-first project, run the shared architecture validator, plan canonical Feature → Slot → Part files, and apply a reviewed one-time plan directly on disk. When Studio is running, the same server also reads and edits the canonical visual document through its authenticated loopback bridge.

It can also coordinate a resumable migration from an existing React project to
a distinct new Srijika target. The source remains read-only. The engine captures
a source baseline, inventories the application, persists a reviewed plan and
source-to-target traceability, applies atomic target-only slices, and fails
closed when behavior is unsupported or verification evidence is incomplete.
Codex performs semantic slice analysis; the plugin does not claim an arbitrary
automatic rewrite or guaranteed zero-loss conversion.

The plugin MCP entry point requires Node.js `>=22.13.0` and is a self-contained
bundle, including its TypeScript analysis runtime. It must start from an
isolated plugin copy without a repository-level `node_modules` and must not
contain a bare runtime import of `typescript`; package consumers of
`@srijika/mcp-server` continue to resolve declared package dependencies normally.

For code-first filesystem work, the plugin also publishes the strict Feature → Slot → Part → Shared creation contract. Codex resolves an exact owner boundary before writing, creates only the required files for that owner kind, preflights every canonical path, and never invents alternate folders or overwrites existing files. The resolved Shared root (`src/shared` by default) is limited to pure UI Primitives, UI+Connector Widgets, and UI-less Headless Capabilities; shared code never imports Features and consumers use only public shared boundaries.

The bundled machine-readable contract also enforces behavior-free UI and
passive Types. Only a matching Connector renders an owner UI; the sole
cross-owner UI exception is pure composition of a canonical Shared UI
Primitive. UI cannot call Hooks (including `React.useState`), browser APIs, or
external runtime behavior; only type-only imports, styles/assets, safe React JSX
support, and JSX-only presentational bindings are allowed. Types use
`import type`/`export type`, contain no runtime values, and are not a runtime
chain step. Logic remains framework-free: React, query, router, and state
lifecycle concerns fail with `SRIJIKA4118`, while pure validation and transforms
remain valid. Custom roots/directories/suffixes stay project-bounded,
non-overlapping, case-insensitively distinct, suffix-non-overlapping,
traversal-free, and symlink-safe. Shared runtime
dependencies are acyclic, and PROMOTE/SPLIT recommendations are returned as
structured evidence.

Computed `import()`/`require()` targets under ownership roots fail as
`SRIJIKA4119` / `SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT`. Declared and reserved
project aliases must resolve to scanned governed source or fail as
`SRIJIKA4120` / `SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS`. TypeScript aliases come
from root JSONC `tsconfig.json`: `extends` and nonempty `references` are
rejected, empty references are allowed, `compilerOptions.baseUrl` must be
omitted, and only exact or slash-delimited terminal `/*` paths are accepted. A
Vite-only alias is unsupported until mirrored in `compilerOptions.paths`.
Relative and `src/...` source imports from governed
files must resolve inside the scanned configured ownership roots or fail as
`SRIJIKA4121` / `SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT`; CSS and static assets
remain exempt.

Architecture loading is fail-closed and live. No `architecture` block means
canonical defaults; an explicit block must declare exact profile
`feature-slot-part-v1`. Generated validation reloads current configuration.
CLI watch is a filtered project-root watcher that reloads config, observes
config/tsconfig/entry/resolved roots and future-root ancestors, and recovers
after temporarily invalid config. VS Code/Studio
exact-file and safe-move previews come from the canonical resolved planner.
The full project contract requires exact `sourceOfTruth: "tsx"`, a bounded
configured `entry` ending in the resolved UI suffix, and—when architecture is
present—the exact profile plus its twelve supported root/directory/suffix
overrides. The entry remains a strict, counted UI source outside the ownership
roots too. Studio live preview follows that entry, UI suffix, and matching
Connector suffix.

Reads and migrations are bounded and fail closed: 64 KiB project config, 1 MiB
TypeScript config, and at most 4,096 TS/JS sources, 32,768 entries, 4,096
directories, depth 32, 4 MiB per source, and 24 MiB total. Hook/Store
flat-to-folder expansion rewires the complete safe project source tree before
removing the flat gateway; it never commits a partial migration.

## Use

1. Add this repository as a local Codex marketplace:

   ```bash
   codex plugin marketplace add /path/to/srijika-studio
   codex plugin add srijika-studio@srijika-studio-local
   ```

2. Start a new Codex task or reload plugins, then ask Codex to use `$srijika-studio`.
3. Open a generated Srijika folder. Codex can immediately call `srijika_get_code_project`, `srijika_check_code_project`, and the reviewed plan/apply tools; Studio is not required.
4. To convert an existing React app, ask Codex to create a migration from an
   absolute source path to a separate new target path. Review the scan and plan,
   then migrate and verify one slice at a time.
5. Start Srijika Studio only for visual-document editing, hierarchy/layout inspection, or preview capture. Its status bar reports `Codex connected` after the first bridge tool call.

The Windows launcher supports a native Windows Studio process and a Studio process started inside WSL. WSL defaults are distribution `Ubuntu` and the Windows username. Override unusual installations with `SRIJIKA_STUDIO_WSL_DISTRO`, `SRIJIKA_STUDIO_WSL_USER`, or `SRIJIKA_STUDIO_WSL_DATA_HOME`.

## Develop and verify

```bash
pnpm plugin:build
pnpm test:mcp
pnpm test:mcp:stdio
pnpm test:mcp:isolated
pnpm test:mcp:code
pnpm test:mcp:windows
pnpm test:mcp:tauri
```

Run the plugin and skill validators before installation. After changing an already installed local plugin, use the plugin-creator cachebuster script and reinstall it so Codex does not retain an older cached copy.

## Security

Studio listens only on an ephemeral loopback port and creates a fresh bearer token for each process. The token stays in the user-private bridge descriptor and is never returned by MCP tools, health responses, logs, or UI status.

The canonical protocol, tools, recovery rules, and migration policy are documented under `skills/srijika-studio/references`.
