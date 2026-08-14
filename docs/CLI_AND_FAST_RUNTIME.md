# CLI and Fast Runtime

Srijika exposes one developer workflow through four adapters: CLI, VS Code,
Desktop Studio, and Codex/MCP. The adapters must not invent their own project,
ownership, validation, or runtime rules.

```text
CLI ───────────┐
VS Code ───────┼─> shared Srijika developer engine
Desktop ───────┤      ├─ project and lockfile detection
Codex / MCP ───┘      ├─ Feature → Slot → Part scaffold contract
                       ├─ incremental architecture validation
                       └─ Vite runtime command planning
```

## Runtime policy

Node.js compatibility mode is the default. It gives the CLI, VS Code extension,
Vite plugins, React dependencies, and package-manager scripts one predictable
baseline.

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

## Why the workflow is fast

- Vite serves and hot-updates the real application instead of rebuilding the
  whole project for every source edit.
- Srijika scans only the configured `src/features` ownership subtree for an
  architecture check.
- The in-process architecture index reuses unchanged source text by size and
  modification time.
- CLI and VS Code call the shared planner directly instead of shelling through
  duplicated scaffolding implementations.
- Creation preflights the complete request, writes temporary files durably,
  refuses overwrite, and performs only the required senior-chain rewires.

## Commands

```bash
srijika init my-app
srijika add feature Dashboard --hook --store --logic --api --types
srijika add slot Summary --in src/features/dashboard --hook --logic
srijika add part MetricCard --in src/features/dashboard/slots/summary --types
srijika add logic --to src/features/dashboard
srijika check
srijika doctor
srijika install
srijika dev
srijika dev --runtime bun
srijika build
srijika studio
```

`add` accepts only canonical ownership boundaries and predefined capability
names. A new Feature, Slot, or Part always includes UI + Connector; Hook, Store,
Logic, API, and Types remain optional. `--dry-run` prints exact files and safe
rewires without writing.

## Surface parity

| Operation                 | CLI      | VS Code                  | Desktop          | Codex/MCP          |
| ------------------------- | -------- | ------------------------ | ---------------- | ------------------ |
| Inspect project/toolchain | `doctor` | Doctor                   | Runtime bar      | Read-only guidance |
| Create owner/capability   | `add`    | Structure `+` / Explorer | Structure dialog | Shared contract    |
| Validate architecture     | `check`  | Diagnostics              | Problems         | Stable rule IDs    |
| Start real app            | `dev`    | Run App                  | Run App          | Not implicit       |
| Stop managed app          | signal   | Stop App                 | Stop             | Not implicit       |
| Open Desktop              | `studio` | external handoff         | already open     | MCP connection     |

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
