# Srijika monorepo workflow

Treat a monorepo as an explicit registry of independent Srijika application
roots. Never infer a target application from a filename and never widen one MCP
server beyond its configured `--project` boundary.

## Required root contract

The root contains `package.json`, one supported lockfile, and
`srijika.workspace.json`. Each manifest project has a unique kebab-case ID,
bounded non-overlapping root, detected `vite` or `next` framework, and unique
Playwright port. Each project root owns its own `package.json`,
`srijika.config.json`, `srijika.toolchain.json`, entry, ownership roots, and
tests. Shared libraries are inventory only; they are not automatically part of
an application's ownership graph.

## Safe command sequence

```bash
srijika workspace inspect . --json
srijika workspace check . --json
srijika workspace tests sync . --project-id <id> --dry-run --json
srijika workspace tests sync . --project-id <id> --json
srijika workspace tests verify . --project-id <id> --skip-install --json
```

For a new workspace, run `workspace init --dry-run --json` first. Review the
discovered roots, frameworks, ports, and proposed files. Initialization never
overwrites an existing manifest, `.mcp.json`, or `srijika.code-workspace`.

Use the MCP server named `srijika-<project-id>` from generated `.mcp.json` for
project structure work. Use workspace CLI commands for aggregate checks and
tests. Open only the selected project root in Desktop Studio. VS Code may open
the generated multi-root `srijika.code-workspace`.

Vite tests live under `tests/srijika`; Next.js App Router tests live under
`tests/srijika-next`. Preserve handwritten tests and require aggregate evidence
before declaring a workspace verified. Project selection is explicit by ID or
all projects; do not claim cross-package affected-project inference.

The exhaustive contract is documented in `docs/MONOREPO.md` and at
`https://srijika.com/docs/monorepo/`.
