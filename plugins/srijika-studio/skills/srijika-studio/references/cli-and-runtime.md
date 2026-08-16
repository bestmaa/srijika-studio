# CLI and fast runtime

## Shared command surface

```text
srijika create <directory>
srijika init <directory>
srijika add <feature|slot|part|shared-ui|shared-widget|shared-capability|hook|behavior-hook|store|store-slice|logic|api|types>
srijika check
srijika doctor
srijika install
srijika dev [--runtime node|bun]
srijika build
srijika studio
```

Prefer `srijika create` for complete onboarding. It scaffolds, installs, checks,
sets up VS Code and MCP, and hands the exact project to Studio only when Studio is
available. `init` is the lower-level scaffold-only primitive.

Use `srijika add --dry-run` before a write when exact targets or safe rewires
need review. Never replace it with arbitrary `mkdir` or template writes. New
owners always include UI + Connector and accept only the optional Hook, Store,
Logic, API, and Types set.

Shared creation is also composite and strict:

```text
srijika add shared-ui <Name> [--types]
srijika add shared-widget <Name> [--hook --store --logic --api --types]
srijika add shared-capability <Name> <--hook|--store|--logic|--api> [capability flags]
```

Shared UI has pure UI plus optional Types. Shared Widget has required UI +
Connector and the normal optional chain. Shared Headless Capability has no
UI/Connector and requires at least one runtime layer. Never create arbitrary
files or folders beneath the resolved `sharedRoot` (`src/shared` by default).

All CLI operations honor validated custom architecture roots, structural
directory names, and file suffixes from `srijika.config.json`. Do not bypass a
rejected config: roots must be bounded project-relative and non-overlapping,
directories/suffixes must be case-insensitively distinct and basename-safe,
configured suffixes cannot end with one another, and traversal, absolute paths,
backslashes, or symlink escapes are hard failures.

Use `srijika add behavior-hook <Behavior> --in <owner>` or
`srijika add store-slice <Concern> --in <owner>` after the matching flat
gateway exists. Srijika derives the full owner-prefixed name, atomically moves
the public gateway into its canonical one-level folder, rewires imports across
the complete bounded TS/JS project corpus, and removes the root copy. Unsafe,
symlinked, truncated, stale, or over-budget input aborts before any write.

No `architecture` block means canonical defaults. An explicit block must
declare exact profile `feature-slot-part-v1`; missing or unsupported profiles
fail closed across all adapters. The generated validator reloads current config
at runtime. `srijika check --watch` uses one recursive project-root watcher,
filters normal events to config, root `tsconfig.json`, the configured entry,
resolved roots, and their future ancestors, and ignores generated/vendor
directories. If config is temporarily invalid it stays alive and watches all
non-ignored paths until a valid edit restores resolved filtering.

Require `sourceOfTruth: "tsx"` and a project-relative `entry` ending in the
resolved UI suffix. That entry is always included in validation and the source
budget, including when it is outside ownership roots. The optional architecture
object has exact profile plus all twelve root/directory/suffix overrides. Root
`tsconfig.json` is parsed as JSONC: `extends` is rejected, `references` must be
absent or empty, and `compilerOptions.baseUrl` must be omitted. Only exact and
slash-delimited terminal `/*` `paths` aliases are portable. A Vite-only alias
is unsupported until mirrored there. Computed module targets and unresolved
reserved project aliases fail as `SRIJIKA4119` and `SRIJIKA4120`. Missing or
outside-root governed relative/`src/...` source imports fail as `SRIJIKA4121`;
CSS/static assets are exempt.

Treat scan limits as failures, never partial success: 64 KiB config, 1 MiB
`tsconfig.json`, 4,096 sources, 32,768 entries, 4,096 directories, depth 32,
4 MiB per source, and 24 MiB total.

## Runtime decision

Node `>=22.13.0` is the default compatibility runtime. Bun is optional and explicit:

```bash
srijika dev --runtime bun
```

Select Bun only for a detected Vite project. If Bun is unavailable or the
project is incompatible, retain the reported Node fallback. Do not install Bun,
rewrite package scripts, replace a lockfile, or change the package manager
without explicit user authorization.

Runtime selection and dependency resolution are separate. `srijika install`
must follow the declared package manager and detected lockfile. React runs in
the browser in either mode.

TanStack Query is a separate create-time opt-in, not a runtime choice. The
default project has no Query dependency or Provider. Use
`srijika create <directory> --react-query` only for server cache, retry,
invalidation, or mutation lifecycle.

## App lifecycle

`srijika dev` and VS Code **Run App** start the real Vite HMR process. Do not
claim full application behavior from the derived UI renderer. `srijika studio`
passes the validated root through `--project`; Desktop then opens it through its
bounded native project service.

Run `srijika doctor` before diagnosing a startup failure and `srijika check`
after architecture changes. Treat any error diagnostic as a failed check;
recommendations remain non-blocking.

The check includes `SRIJIKA4118` /
`SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN`: Logic keeps pure business validation and
transforms but cannot own React, query-cache, router, or client-state lifecycle.
Every UI also blocks external runtime behavior, not only local architecture
layers.

## MCP lifecycle without Studio

Generated projects contain `.mcp.json`, `.vscode/mcp.json`, and `AGENTS.md`.
Start the bounded server with:

```bash
npx -y @srijika/mcp-server@0.2.0 --project .
```

Call `srijika_get_code_project`, then `srijika_check_code_project`. For structure
changes, review `srijika_plan_code_structure`, pass its one-time `planId` to
`srijika_apply_code_structure`, then check again. These tools use the shared
developer engine and do not require a Studio bridge.
