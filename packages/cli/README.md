# Srijika CLI

The Srijika CLI is the fast, scriptable adapter for the same Feature → Slot → Part contract used by Studio and the VS Code extension.

```bash
npm create srijika@latest
# Project name: my-app

# Or pass the name directly:
npm create srijika@latest my-app
# Opt into TanStack React Query only when the app needs server-cache lifecycle:
npx @srijika/cli create my-query-app --react-query
npx @srijika/cli doctor
npx @srijika/cli add feature Dashboard --hook --logic --types
npx @srijika/cli add behavior-hook Keyboard --in src/features/home
npx @srijika/cli add store-slice Filters --in src/features/home
npx @srijika/cli add shared-ui ActionButton --types
npx @srijika/cli add shared-widget UserMenu --hook --store --types
npx @srijika/cli add shared-capability Auth --hook --logic --api --types
npx @srijika/cli check
npx @srijika/cli dev
npx @srijika/cli dev --runtime bun

# Attach Srijika safely to a populated Next.js App Router project:
npx @srijika/cli adopt . --framework next --dry-run --json
npx @srijika/cli adopt . --framework next --json

# Start or resume an immutable-source React migration:
npx @srijika/cli migrate react --source /old/react-app --target /new/srijika-app
npx @srijika/cli migrate status --target /new/srijika-app
npx @srijika/cli migrate verify --target /new/srijika-app
```

`npm create srijika@latest` resolves the public `create-srijika` launcher, which
delegates to the exact published `@srijika/cli` version.

`create` is the complete CLI-first onboarding path. It scaffolds the pinned app,
installs dependencies, validates the architecture, installs/recommends Srijika
Language Support when VS Code is available, and opens the exact project folder.
Srijika Studio is detected independently: an installed copy receives the same
project, while a missing copy is silently skipped. Use `--no-install`,
`--no-vscode`, `--no-extension`, `--no-studio`, or `--no-open` for automation.

Every generated project includes portable validation plus VS Code Run App, Check
Architecture, and Build App tasks, so Studio is never required.

`adopt --framework next` is the brownfield path for an existing populated App
Router application. Dry-run inventories the authoritative package manager,
lockfile, routes, aliases, Next TypeScript plugin, explicit `.ui.tsx` sources,
and server-only surfaces without writing. Apply runs the existing typecheck and
production build first, rechecks the source baseline, creates only missing
Srijika/editor/MCP/owner-test files, and emits exact merge instructions for every
existing file. It never rewrites `package.json`, application source, Next
configuration, scripts, versions, or the lockfile.

`migrate react` supports React Vite/CRA JavaScript and TypeScript projects in
phase 1. It never writes to the source: it captures a bounded hash inventory,
creates or resumes a distinct target, and persists the reviewed slice plan and
source-to-target mappings under `.srijika/migrations/react/`. Apply semantic
slices through Codex/MCP. Every slice requires zero Srijika diagnostics,
architecture pass, TypeScript pass, and production build pass before the next
slice. Then use `migrate verify`; completion requires an unchanged source, full
mapped-or-ignored traceability, verified slices, and typecheck/build/test evidence. Next.js, Remix, React
Native, and Expo fail closed until dedicated adapters are available.

`behavior-hook` and `store-slice` accept only a PascalCase suffix. The shared
writer derives the owner-prefixed filename, moves a flat gateway into its
canonical one-level folder, rewires imports, and removes the root copy in one
transaction.

Shared creation is also strict. `shared-ui` creates only pure UI plus optional
Types; `shared-widget` creates required UI + Connector with the same optional
Hook → Store → Logic → API chain as a Feature; `shared-capability` is headless
and requires at least one runtime flag (`--hook`, `--store`, `--logic`, or
`--api`). All three are created under the resolved `sharedRoot`
(`src/shared` by default) automatically.

Every command resolves `sourceOfTruth`, the configured entry, all twelve
architecture root/directory/suffix overrides, and exact profile
`feature-slot-part-v1` from `srijika.config.json`. Explicit invalid config,
case-insensitive name/suffix collisions, suffix overlap, traversal, and symlink
escapes fail closed. Root JSONC `tsconfig.json` is the alias authority:
`extends` and nonempty `references` are rejected, empty references are allowed,
`compilerOptions.baseUrl` may be a bounded project-relative path, and only exact
or slash-delimited terminal `/*` paths are accepted. The authoritative entry is validated and
counted even outside ownership roots.

`check --watch` uses one filtered recursive project-root watcher so config,
root `tsconfig.json`, the entry, resolved Feature/Shared roots, and future-root
ancestors can change without restart. It filters vendor/generated directories,
reloads config before a debounced check, stays alive after temporarily invalid
configuration, and returns to resolved filtering after recovery.

Existing React/Next repositories may declare the versioned
`adoption.ownership` contract documented in
[`docs/BROWNFIELD_ADOPTION.md`](../../docs/BROWNFIELD_ADOPTION.md). Run
`srijika adoption plan [project] --json` for governed/pending/blocked/excluded
coverage plus deterministic no-overwrite moves and exact rewires. `check`
strictly enforces adopted owners while reporting the rest as partial; partial
coverage is never printed as full-project success.

For Next.js projects, `check` also uses the versioned non-executing framework
adapter for exact `next/link`, `next/image`, and configured project presentation
components. App Router server/client violations and non-serializable boundary
props are reported as stable `SRIJIKA5001`–`SRIJIKA5005` diagnostics. The full
contract is in
[`docs/NEXT_FRAMEWORK_ADAPTER.md`](../../docs/NEXT_FRAMEWORK_ADAPTER.md).

React Query is not installed by default. Pass `--react-query` to `create` or
`init` when query caching, retries, invalidation, and server-state lifecycle are
part of the project.

Node compatibility mode is the default. Bun turbo mode is optional and is selected only for a detected Vite project. React continues to execute in the browser in either mode.
