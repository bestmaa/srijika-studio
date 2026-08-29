# CLI and Fast Runtime

Srijika exposes one developer workflow through four adapters: CLI, VS Code,
Desktop Studio, and Codex/MCP. The adapters must not invent their own project,
ownership, validation, or runtime rules.

```text
CLI ───────────┐
VS Code ───────┼─> shared Srijika developer engine
Desktop ───────┤      ├─ project and lockfile detection
Codex / MCP ───┘      ├─ Feature → Slot → Part scaffold contract
                       ├─ strict Shared UI / Widget / Capability contract
                       ├─ incremental architecture validation
                       └─ Vite / Next.js runtime command planning
```

## Runtime policy

Node.js `>=22.13.0` compatibility mode is the default. It gives the CLI, VS Code
extension, Vite plugins, React dependencies, and package-manager scripts one
predictable baseline.

Bun is an optional explicit turbo runtime for a detected Vite project:

```bash
srijika dev --runtime bun
```

If Bun is unavailable or the project is not Vite-based, Srijika explains the
reason and selects Node. Runtime selection does not change dependency
resolution. Install always follows the project's declared package manager and
lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, or `bun.lock`).

React is browser code in both modes. Bun changes the process executing Vite; it
does not remove React or restrict npm-compatible React packages.

Detected Next App Router projects remain in Node compatibility mode and run the
declared dev script with `--hostname 127.0.0.1 --port <reserved>`. Vite uses its
strict-port equivalents. Desktop Studio owns the process tree and route origin;
CLI planning uses the same framework distinction.

TanStack Query is independent of runtime selection. The default project is
minimal and has no Query dependency or Provider. Opt in only when required:

```bash
srijika create my-app --react-query
```

## Why the workflow is fast

- Vite serves and hot-updates the real application instead of rebuilding the
  whole project for every source edit.
- Srijika scans only the configured `src/features` and strict `src/shared`
  ownership subtrees for an architecture check.
- The in-process architecture index reuses unchanged source text by size and
  modification time.
- CLI and VS Code call the shared planner directly instead of shelling through
  duplicated scaffolding implementations.
- Creation preflights the complete request, writes temporary files durably,
  refuses overwrite, and performs only the required senior-chain rewires. A
  flat-to-folder Hook/Store migration discovers every bounded TS/JS source in
  the project so imports outside the ownership roots are rewired too.

## Commands

```bash
npm create srijika@latest my-app
srijika create my-app
srijika init my-app
srijika add feature Dashboard --hook --store --logic --api --types
srijika add slot Summary --in src/features/dashboard --hook --logic
srijika add part MetricCard --in src/features/dashboard/slots/summary --types
srijika add shared-ui Button --types
srijika add shared-widget UserMenu --hook --store --logic --api --types
srijika add shared-capability Auth --hook --store --logic --api --types
srijika add logic --to src/features/dashboard
srijika check
srijika doctor
srijika install
srijika dev
srijika dev --runtime bun
srijika build
srijika studio
srijika workspace init .
srijika workspace inspect .
srijika workspace check .
srijika workspace tests sync .
srijika workspace tests verify . --skip-install
```

`workspace` turns a root-lockfile monorepo into a bounded registry of independent
Srijika Vite and Next.js applications. It generates a strict
`srijika.workspace.json`, VS Code multi-root setup, and one explicitly scoped MCP
server per app, then aggregates architecture and owner-test verification. See
[Srijika in a monorepo](MONOREPO.md) for the complete contract and CI workflow.

`create` is the recommended product entrypoint. It performs a complete setup:

1. create the pinned React/Vite project and strict ownership config;
2. install from the frozen lockfile;
3. run the shared architecture validator;
4. install/recommend Srijika Language Support and open the exact folder when VS
   Code is available;
5. open the same folder in Desktop Studio when Studio is installed, otherwise
   continue successfully without it.
6. write generic and VS Code MCP configs plus `AGENTS.md`, allowing Codex or any
   MCP client to inspect, validate, plan, and scaffold the project without Studio.

`init` remains the low-level scaffold-only primitive for scripts that want to
control every later step. `create --no-open` is the CI-safe complete setup;
`--no-install`, `--no-vscode`, `--no-extension`, and `--no-studio` provide finer
control. Generated VS Code tasks keep Run App, Check Architecture, and Build App
available even without the extension.

`add` accepts only canonical ownership boundaries and predefined capability
names. A new Feature, Slot, or Part always includes UI + Connector; Hook, Store,
Logic, API, and Types remain optional. `--dry-run` prints exact files and safe
rewires without writing.

`src/shared` accepts exactly three composites. Shared UI requires pure UI and
permits only Types. Shared Widget requires UI + Connector and permits the normal
optional runtime chain. Shared Headless Capability forbids UI/Connector and
requires at least one runtime layer. Every adapter rejects freehand shared
folders, Feature imports from shared code, and consumer imports of private
shared layers. It also rejects noncanonical owner spellings, Shared runtime
dependency cycles, direct child UI imports, UI Hook/browser-API behavior, and
runtime content or runtime consumption of passive Types contracts.

The hard source identifiers are stable across CLI, VS Code, Studio, and MCP:

```text
SRIJIKA4116  SRIJIKA-ARCH-DIRECT-CHILD-UI
SRIJIKA4117  SRIJIKA-ARCH-PASSIVE-TYPES
SRIJIKA4118  SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN
SRIJIKA4119  SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT
SRIJIKA4120  SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS
SRIJIKA4121  SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT
```

Every UI is rendered only by its matching Connector (except pure UI composition
of a canonical Shared UI Primitive), calls no Hook such as `React.useState`, and
accesses no browser/runtime API such as `fetch`, `XMLHttpRequest`, `WebSocket`,
`localStorage`, or `sessionStorage`. It also cannot import or execute external
runtime behavior such as state, router, request, query-lifecycle, or callable
utility modules; only type-only contracts, styles/assets, safe React JSX
support, and JSX-only presentational bindings are allowed. Files ending in the
resolved Types suffix (canonical default `.types.ts`) contain passive interfaces
and type aliases only and are consumed with
`import type`/`export type`.

Logic remains framework-free and deterministic. Pure validation,
authorization, transforms, aggregation, and orchestration through the matching
API remain valid. React/Hook lifecycle, React Query/query-cache lifecycle,
router lifecycle, and client-state lifecycle fail with `SRIJIKA4118`; place
those concerns in Hook, Connector, or Store and keep request transport in API.

Custom `architecture` roots, directory names, and suffixes in
`srijika.config.json` are supported only inside the same hard safety boundary:
roots are bounded project-relative and non-overlapping, the four structural
directory names are case-insensitively distinct single segments, suffixes are
case-insensitively distinct, non-overlapping basename-only `.tsx`/`.ts` values,
and traversal, absolute paths, backslashes,
root overlap, or symlink escape paths are rejected before reading or writing.
If the `architecture` block is absent, canonical defaults apply. If the block
exists, it must declare the exact `feature-slot-part-v1` profile; a missing or
unsupported profile fails closed in CLI, generated validation, VS Code, Studio,
and MCP.

The complete project object also requires `"sourceOfTruth": "tsx"` and a
normalized project-relative `entry` ending in the resolved UI suffix. The
optional architecture object exposes all twelve supported overrides:
`featuresRoot`, `sharedRoot`, `slotsDirectory`, `partsDirectory`,
`hooksDirectory`, `storesDirectory`, `uiSuffix`, `connectorSuffix`,
`storeSuffix`, `logicSuffix`, `apiSuffix`, and `typesSuffix`. Missing override
fields use defaults; the profile is never inferred once the block exists.

The root `tsconfig.json` is parsed as JSONC. `extends` is rejected;
`references` must be absent or empty; and `compilerOptions.baseUrl` must be
omitted. Only exact and slash-delimited terminal `/*`
`compilerOptions.paths` aliases are used, with their first target kept inside
the project. Generated aliases `@/`, `@features/`,
and `@shared/` are recognized. Unresolved `~/`, `#...`, `@app`, and `@src`
namespaces fail with `SRIJIKA4120`; aliases defined only in Vite are unsupported
until mirrored in `tsconfig.json`. A computed `import()` or `require()` under an
ownership root fails with `SRIJIKA4119` because its target cannot be proven.
Every governed relative or `src/...` source import must also resolve to a
scanned source inside the configured Feature/Shared roots or fail with
`SRIJIKA4121`; CSS/static assets are exempt and external packages remain bare
package imports.

The authoritative configured `entry` is included in validation and the source
budget even when it is outside the ownership roots; it is still a strict pure
UI source and receives `SRIJIKA4119`–`SRIJIKA4121` checks. Config and source
reads are symlink-safe and bounded: 64 KiB for
`srijika.config.json`, 1 MiB for `tsconfig.json`, and—per complete validation or
migration corpus—4,096 sources, 32,768 entries, 4,096 directories, depth 32,
4 MiB per source, and 24 MiB total. Srijika rejects an incomplete scan rather
than reporting partial success.

The generated `scripts/srijika-validate.mjs` reloads the current configuration
at runtime rather than retaining its generation-time architecture snapshot.
`srijika check --watch` uses a recursive project-root watcher with ignored
vendor/generated directories filtered. It reacts to project config,
`tsconfig.json`, the configured entry, resolved Feature/Shared roots, and
ancestors where a future configured root may appear. Each debounced check
reloads config; after a temporarily invalid config it stays alive, watches all
non-ignored paths until recovery, then resumes resolved filtering. VS Code and Studio exact-file/safe-move
previews are canonical planner output under that same resolved configuration.
Studio's managed Vite bridge opens the configured `entry`, recognizes the
configured `uiSuffix`, and loads its matching configured `connectorSuffix`.

The validator emits `SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER` with two-consumer
evidence on the blocking ownership error. It emits
`SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER` as non-blocking `SRIJIKA4202` only when the
exact 200/300/16 UI limits are exceeded.

## Surface parity

| Operation                 | CLI      | VS Code                  | Desktop          | Codex/MCP          |
| ------------------------- | -------- | ------------------------ | ---------------- | ------------------ |
| Inspect project/toolchain | `doctor` | Doctor                   | Runtime bar      | Read-only guidance |
| Create owner/capability   | `add`    | Structure `+` / Explorer | Structure dialog | Shared contract    |
| Validate architecture     | `check`  | Diagnostics              | Problems         | Stable rule IDs    |
| Start real app            | `dev`    | Run App                  | Run App          | Not implicit       |
| Stop managed app          | signal   | Stop App                 | Stop             | Not implicit       |
| Open Desktop              | `studio` | external handoff         | already open     | MCP connection     |

The project folder and `srijika.config.json` are the product boundary. No adapter
owns a private project format, so installing or removing Studio never migrates or
changes a CLI-created project.

## MCP without Desktop Studio

Every generated project contains `.mcp.json` and `.vscode/mcp.json` pointing to
the pinned Srijika MCP server, plus `AGENTS.md` with the architecture contract.
The server is bounded to that project and exposes:

- `srijika_get_code_project` — metadata and bounded canonical file inventory;
- `srijika_check_code_project` — shared strict diagnostics;
- `srijika_plan_code_structure` — exact no-write file and rewire plan;
- `srijika_owner_tests` — framework-detected safe sync, full verification, or bounded owner evidence and AI repair scope;
- `srijika_apply_code_structure` — atomic no-overwrite Feature/Slot/Part/Shared creation.

Studio bridge tools appear in the same MCP server but remain optional. If Studio
is absent, only visual document, layout, and preview operations are unavailable;
all code-project tools continue to work.

The CLI passes `--project <absolute-path>` when launching the Desktop. The native
app validates and opens that project through the same bounded project service.

## Release requirements

Before publishing the CLI or extension:

1. Typecheck and unit-test developer engine, scaffold, CLI, and extension.
2. Run the packaged CLI against a newly generated temporary project.
3. Verify Node command planning and explicit Bun fallback/turbo behavior.
4. Build the VS Code bundle and run its extension-host activation smoke.
5. Run Studio TypeScript and Rust checks, plus the desktop runtime smoke.
6. Build the documentation portal and validate the Codex plugin.

Release verification runs on both the declared Node floor (`22.13.0`) and Node 24. Publication remains on Node 24 for npm Trusted Publishing. The MCP gates
include unit, stdio, isolated-plugin, and code-project smokes; the isolated
plugin must start without repository `node_modules` and must not retain a bare
runtime import of `typescript`.

The automated release contract lives in `.github/workflows/release-npm.yml` and
is documented in `docs/NPM_RELEASE.md`. A published GitHub Release whose tag
matches all three public package versions triggers ordered npm publication with
OIDC Trusted Publishing and provenance.
