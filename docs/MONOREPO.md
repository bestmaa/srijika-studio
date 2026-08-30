# Srijika in a monorepo

Srijika supports a JavaScript monorepo as a bounded collection of independent
Srijika applications. Install Srijika Studio once. Each React application keeps
its own project contract, while the repository root owns discovery, editor
handoff, MCP routing, and aggregate validation/testing.

## Supported model

```text
company-products/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── srijika.workspace.json
├── srijika.code-workspace
├── .mcp.json
├── apps/
│   ├── storefront/
│   │   ├── package.json
│   │   ├── srijika.config.json
│   │   ├── srijika.toolchain.json
│   │   └── src/
│   └── admin/
│       ├── package.json
│       ├── srijika.config.json
│       ├── srijika.toolchain.json
│       └── src/
└── packages/
    ├── design-system/
    ├── auth/
    └── api-client/
```

An application package is a Srijika project when its own root contains both
`package.json` and `srijika.config.json`. Pure libraries, backends, build tools,
and type-only packages do not need a Srijika project contract.

Desktop Studio opens one application root at a time. VS Code can open every
application as a multi-root workspace. The root MCP configuration starts one
bounded server per application, so AI tools never guess which product they are
changing.

## Requirements

The monorepo root must contain:

- a real, non-symlink directory;
- `package.json`;
- one supported root lockfile: `pnpm-lock.yaml`, `package-lock.json`,
  `yarn.lock`, or `bun.lock`; and
- at least one nested Srijika project using exactly one supported framework,
  Vite or Next.js.

The root `packageManager` declaration and lockfile must agree. Discovery is
fail-closed and ignores vendor/build folders including `.git`, `.next`,
`.srijika`, `.turbo`, `build`, `coverage`, `dist`, `node_modules`, `out`, and
`target`. It is bounded to 128 projects, 512 matching config files, 65,536
entries, 8,192 directories, and depth 12. Symlink escapes are rejected.

## Initialize an existing monorepo

First ensure each application is already a valid Srijika project. Then run at
the repository root:

```bash
npx @srijika/cli workspace init . --dry-run
npx @srijika/cli workspace init .
npx @srijika/cli workspace inspect .
npx @srijika/cli workspace check .
```

`workspace init` discovers applications and creates, without overwriting:

- `srijika.workspace.json` — the authoritative workspace registry;
- `srijika.code-workspace` — VS Code multi-root folders plus the extension
  recommendation; and
- `.mcp.json` — one pinned Srijika MCP server per application.

If `.mcp.json` or `srijika.code-workspace` already exists, Srijika preserves it
and reports that fact. Merge the generated content shown by
`workspace init --dry-run --json`; Srijika never silently replaces existing
editor or AI configuration. An existing `srijika.workspace.json` also fails
closed instead of being regenerated.

## Workspace contract

```json
{
  "$schema": "https://srijika.com/schemas/srijika-workspace-v1.schema.json",
  "version": 1,
  "packageManager": "pnpm",
  "projects": [
    {
      "id": "storefront",
      "root": "apps/storefront",
      "framework": "next",
      "testPort": 4174
    },
    {
      "id": "admin",
      "root": "apps/admin",
      "framework": "vite",
      "testPort": 4175
    }
  ],
  "sharedPackages": ["packages/design-system", "packages/auth"]
}
```

Rules:

- `version` is exactly `1`.
- `packageManager` is `pnpm`, `npm`, `yarn`, or `bun` and must match the root
  lockfile.
- IDs are unique lowercase kebab-case identifiers.
- Project and shared-package roots are normalized, project-relative,
  non-overlapping paths without traversal, absolute paths, or backslashes.
- Every project root contains its own project contract.
- `framework` must match detected package metadata and is exactly `vite` or
  `next`.
- Every `testPort` is unique and between 1 and 65,535, allowing deterministic
  Playwright servers.
- Shared package paths are unique directories containing `package.json`.
- Unknown fields fail validation rather than being ignored.

The published JSON Schema gives editors completion and early feedback. Runtime
validation remains authoritative and additionally checks the real filesystem,
package metadata, lockfile, symlinks, and project boundaries.

## Commands

```bash
# Read the resolved workspace and every application
npx @srijika/cli workspace inspect .

# Check all application architecture and UI diagnostics
npx @srijika/cli workspace check .

# Check one application only
npx @srijika/cli workspace check . --project-id storefront

# Generate/update owner Vitest and Playwright files for all applications
npx @srijika/cli workspace tests sync .

# Preview test writes without changing files
npx @srijika/cli workspace tests sync . --dry-run --json

# Run install, architecture, typecheck, Vitest, Chromium, Playwright, and evidence
npx @srijika/cli workspace tests verify .

# Reuse a root CI install and verify one application
npx @srijika/cli workspace tests verify . --project-id admin --skip-install
```

All workspace commands support `--json` for automation. `--project-id` prevents
path guessing and selects only a declared application.

## Playwright and owner tests

Workspace test synchronization delegates to the same tested adapter used by a
standalone project. Each application owns its generated test contract and
evidence:

```text
apps/storefront/tests/srijika-next/
├── contract.generated.json
├── owners/
├── playwright.config.ts
├── vitest.config.ts
└── evidence/

apps/admin/tests/srijika/
├── contract.generated.json
├── owners/
├── playwright.config.ts
├── vitest.config.ts
└── evidence/
```

Feature, Slot, Part, and supported Shared owners receive deterministic tests.
Handwritten owner tests are preserved. Every application has a distinct
loopback port. Verification runs applications sequentially today for stable,
low-resource CI behavior and aggregates their gates and evidence status into
one result.

Changed-file owner selection is available inside each project. At workspace
level, select an application explicitly with `--project-id` or verify all
declared applications. Cross-package affected-project calculation is a future
optimization; it is not inferred from an incomplete dependency graph.

## Vite and Next.js

Vite applications use `tests/srijika`. Next.js App Router applications use
`tests/srijika-next` and an isolated generated harness. Framework selection is
declared in the workspace and checked against `package.json`; a project that
looks like both or neither framework is rejected until its boundary is made
explicit.

The workspace uses the root package manager for test synchronization and
execution. This supports normal root-lockfile monorepos even when an individual
application does not carry its own lockfile.

Desktop Studio's managed live application is currently Vite-first. A Vite app
using only the monorepo root lockfile should be installed from the root before
opening Studio; Studio's own managed install still expects a project-local
lockfile. Next.js projects still receive architecture, CLI, VS Code, MCP,
Vitest, Playwright, and evidence support; full Desktop live-preview parity and
root-lockfile-aware Desktop installation remain separate product work.

## VS Code

Open the generated file:

```bash
code srijika.code-workspace
```

Each application is a real VS Code workspace folder. Srijika Language Support
already isolates diagnostics, creation plans, configured suffixes, and
Structure trees by workspace folder. Shared packages may be added to
`sharedPackages` and then to the generated workspace file when they should be
visible for ordinary TypeScript navigation.

The root `srijika.code-workspace` is generated only once. After manually
changing `projects` or `sharedPackages`, update its `folders` list explicitly;
the CLI will not overwrite editor customizations.

## Codex and MCP

Generated `.mcp.json` uses a separate server name and explicit `--project` for
each application:

```json
{
  "mcpServers": {
    "srijika-storefront": {
      "command": "npx",
      "args": ["-y", "@srijika/mcp-server@0.6.0", "--project", "apps/storefront"],
      "cwd": "."
    }
  }
}
```

An AI agent should select the server matching the manifest project ID, inspect
before writing, use canonical Feature/Slot/Part operations, synchronize owner
tests, and return evidence. A shared MCP process is deliberately not allowed to
guess a target application from a filename.

## Desktop Studio

Open a declared application root:

```bash
npx @srijika/cli studio apps/storefront
npx @srijika/cli studio apps/admin
```

Studio validates one project root and keeps every filesystem/process action
inside it. Switching products means opening another declared application. The
workspace manifest does not weaken that safety boundary and does not grant one
application permission to mutate another. Run the root workspace install first
for root-lockfile monorepos; keep a project-local matching lockfile only when
you intentionally want Studio to own that app's install lifecycle.

## Shared packages and boundaries

`sharedPackages` is workspace inventory, not automatic architecture ownership.
Srijika verifies the directory and `package.json`, exposes it to generated
editor setup, and documents the intended dependency surface. Each application's
Feature → Slot → Part rules still apply only inside that application's configured
Feature and Shared roots.

Keep shared package public APIs explicit. Do not deep-import another
application's private Feature, Slot, Part, Hook, Store, Logic, or API. If a UI
system must be consumed by several applications, publish it through a stable
package entry and test each consuming application. Cross-package dependency
policy and affected-project computation are planned workspace-v2 capabilities.

## CI example

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm exec srijika workspace inspect .
- run: pnpm exec srijika workspace check .
- run: pnpm exec srijika workspace tests sync .
- run: git diff --exit-code
- run: pnpm exec srijika workspace tests verify . --skip-install
```

Commit generated owner contracts and tests. Keep reports, screenshots created
only on failure, and other transient test output ignored according to the
application's generated setup.

## Adoption checklist

1. Keep a single root package manager and lockfile.
2. Make each UI application an independent Srijika project.
3. Run `workspace init --dry-run` and review discovered framework/ports.
4. Initialize the workspace and merge preserved editor/MCP files if reported.
5. Declare intentional shared packages.
6. Run workspace inspect and architecture checks.
7. Synchronize and commit per-owner tests.
8. Add the aggregate CI gate.
9. Open `srijika.code-workspace` for daily development.
10. Open one declared project at a time in Desktop Studio.

This setup keeps the monorepo convenient for humans and deterministic for AI:
every command names a bounded application, every owner has a test contract, and
every verification run produces machine-readable evidence.
