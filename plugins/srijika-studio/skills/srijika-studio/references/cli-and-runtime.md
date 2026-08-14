# CLI and fast runtime

## Shared command surface

```text
srijika create <directory>
srijika init <directory>
srijika add <feature|slot|part|hook|store|logic|api|types>
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

## Runtime decision

Node is the default compatibility runtime. Bun is optional and explicit:

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

## App lifecycle

`srijika dev` and VS Code **Run App** start the real Vite HMR process. Do not
claim full application behavior from the derived UI renderer. `srijika studio`
passes the validated root through `--project`; Desktop then opens it through its
bounded native project service.

Run `srijika doctor` before diagnosing a startup failure and `srijika check`
after architecture changes. Treat any error diagnostic as a failed check;
recommendations remain non-blocking.

## MCP lifecycle without Studio

Generated projects contain `.mcp.json`, `.vscode/mcp.json`, and `AGENTS.md`.
Start the bounded server with:

```bash
npx -y @srijika/mcp-server@0.1.0 --project .
```

Call `srijika_get_code_project`, then `srijika_check_code_project`. For structure
changes, review `srijika_plan_code_structure`, pass its one-time `planId` to
`srijika_apply_code_structure`, then check again. These tools use the shared
developer engine and do not require a Studio bridge.
