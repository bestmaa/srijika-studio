# Adopt an existing Next.js App Router project

Srijika can attach its project contract, diagnostics, editor integration, MCP
routing, and owner-test harness to an existing populated Next.js App Router
application without converting it to Vite or rewriting application source.

## Preview the transaction

Run the no-write plan first:

```bash
npx @srijika/cli adopt . --framework next --dry-run --json
```

The planner fails closed unless it finds all of the following at one real,
non-symlinked project root:

- `package.json` with a declared Next.js dependency and production `build` script;
- exactly one App Router root, `app` or `src/app`;
- one authoritative npm, pnpm, yarn, or Bun text lockfile;
- an authoritative `tsconfig.json`; and
- at least one explicit `.ui.tsx` presentation source.

Route files are never inferred as UI owners. The inventory classifies App Router
pages, layouts, loading/error/not-found states, templates, defaults, and route
handlers as framework-owned surfaces. Route handlers, `use server` modules, and
imports from `server-only`, `next/headers`, or `next/server` are protected as
server-only code.

The plan includes a SHA-256 baseline for every bounded TypeScript/JavaScript
source plus `package.json`, `tsconfig.json`, and the selected lockfile. Apply
rechecks that baseline before and after writing.

## Apply adoption

After reviewing the JSON plan:

```bash
npx @srijika/cli adopt . --framework next --json
```

Before writing metadata, the engine runs the existing project typecheck and
production build. It uses the declared package manager, preserves the existing
scripts, aliases, Next TypeScript plugin, framework configuration, lockfile, and
dependency versions, and writes nothing when either gate fails.

Apply creates only missing files:

- `srijika.config.json` in report-only adoption mode;
- `.srijika/adoption/next-app-router.json` with the reviewed inventory and source baseline;
- missing VS Code recommendations/settings and MCP routing files; and
- the generated `tests/srijika-next` owner-test contract and harness.

Existing files are never overwritten. If an editor, MCP, test, or package file
already exists, the result preserves it and emits an exact merge instruction.
`package.json` is always preserved and receives reviewed additive instructions
for the Srijika marker, owner-test scripts, and missing test dependencies.

## Report-only means honest partial adoption

The first apply runs architecture and UI diagnostics but records them as a
report-only baseline. A populated repository is not described as fully governed
just because metadata was added. Existing Next routes, Server Components, route
handlers, middleware, services, and framework configuration remain normal Next.js
code. Srijika governs only explicit frontend ownership sources.

After applying reviewed `package.json` merge instructions, run:

```bash
npx @srijika/cli check .
npx @srijika/cli tests sync . --framework next --dry-run
npx @srijika/cli tests sync . --framework next
npx @srijika/cli tests verify . --framework next
```

The same project contract is then available to the CLI, VS Code extension, MCP
server, generated validator, and Desktop Studio. A later enforcement change must
be reviewed separately; adoption itself does not silently restructure owners.

## Package-manager and alias boundaries

Root `packageManager` selects npm, pnpm, yarn, or Bun when multiple lockfiles are
present. Without that declaration, multiple package-manager lockfiles are
ambiguous and adoption stops. Legacy binary `bun.lockb` must first be migrated to
the text `bun.lock` format.

TypeScript path aliases remain sourced from `tsconfig.json`. Exact aliases and
slash-delimited terminal `/*` aliases are supported. A project-relative
`compilerOptions.baseUrl` is resolved into the alias target; absolute,
drive-relative, backslash, and traversal paths fail closed.
