# Testing strategy

## JavaScript quality gate

```bash
pnpm verify
```

`verify` is the full supported-product gate. It runs formatting, ESLint with zero warnings, strict TypeScript checks (including Playwright tooling), root and package-level tests, Rust core checks, the current code-first Playwright lane, and the production workspace build. Use the shorter feedback loop while developing:

```bash
pnpm verify:fast
pnpm test:packages
pnpm test:coverage
```

V8 coverage is enforced for the reusable framework packages at 75% for lines, functions, and statements and 60% for branches. The React editor shell is intentionally measured by the Playwright, visual, and Axe browser gates because those browser executions are not represented in Vitest's V8 process. The report is written to `coverage/`.

## Test layers

- **Contracts:** TypeBox/Ajv acceptance and rejection, canonical JSON round trips, property-based document identifiers, and pinned project toolchain shape.
- **Unit:** document commands/history/envelopes, atomic repeater scope, expression evaluation, manifest registry and semantic analyzer, and deterministic TSX generation/compilation.
- **Integration:** registry-backed React rendering, named-slot preservation, Inspector-to-document behavior, invalid-import rejection, and UI error resilience in jsdom.
- **Browser E2E:** the supported code-first shell, project creation, TSX/preview/Inspector synchronization, ownership-aware creation, accessibility, and visual stability. Framework adapters generate isolated owner suites under `tests/srijika/` (Vite) or `tests/srijika-next/` (Next App Router).
- **Accessibility:** Axe checks for serious/critical shell violations. The current check excludes the design iframe and disables color contrast, so those areas still need separate manual and automated coverage.
- **Visual:** a deterministic 1440×900 dark-mode Chromium snapshot in `tests/e2e/code-first-smoke.spec.ts-snapshots/`.
- **Rust:** bounded/atomic JSON persistence, error behavior, envelope/path validation, and the narrow Tauri command error contract.

Geometry-sensitive drag/drop and visual behavior run in Chromium, not jsdom.

For Next App Router projects, framework-neutral Store/Logic/API modules may run
in Vitest. Visual owners, especially async Server Components, run through a
real `next dev` harness in Playwright. The generated suite covers render,
fixed-viewport screenshots, and Axe checks per Feature, Slot, Part, and visual
Shared owner. The smoke gate also compiles a generated thin `src/app` route with
`next build`, so a passing generator syntax test alone is not accepted as
framework evidence.

The CLI and MCP use the same engine contract:

```bash
srijika tests sync . --json
srijika tests verify . --json
srijika tests evidence . --json
```

Each adapter writes bounded JSON reports below `test-results/srijika/` or
`test-results/srijika-next/`. The evidence manifest maps those reports back to
owner requirement IDs. Missing or uncovered evidence never becomes green. A
failed owner includes an AI repair scope containing only its governed source
files, failing generated artifacts, bounded failure messages, and exact rerun
scripts and `verify` runs the bounded architecture, typecheck, Vitest, and
Playwright pipeline. MCP exposes all three actions through compact
`srijika_owner_tests` without
requiring Desktop Studio.

## Playwright setup

Install the pinned browser once:

```bash
pnpm exec playwright install chromium
```

Then run:

```bash
pnpm test:e2e:web
pnpm test:a11y
pnpm test:visual
```

The default config selects supported code-first specs and future generated owner specs. Tests for the retired visual-editor surface remain discoverable as an explicit, non-release-blocking compatibility lane instead of being silently deleted:

```bash
pnpm test:e2e:web:legacy
pnpm test:a11y:legacy
pnpm test:visual:legacy
```

Playwright starts its own strict Vite server on `127.0.0.1:4173` by default, independent of the manual development port 5173. Override it with `SRIJIKA_E2E_PORT` if necessary. Traces, screenshots, and video are retained on failure; the HTML report is written to `playwright-report/`.

Update the committed visual baseline only after reviewing an intentional design change:

```bash
pnpm exec playwright test --config playwright.config.ts --grep @visual --update-snapshots
```

## Rust gates

The two native core crates can be checked before installing WebKitGTK:

```bash
pnpm check:rust
```

After installing the WSL native packages from [Development setup](DEVELOPMENT.md), include the Tauri shell:

```bash
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo check -p srijika-studio --locked
```

Native Windows, macOS, and Linux release certification belongs on matching CI runners. WSL tests only the Linux target.

## Regression rule

Every defect fix should add the lowest-level regression test that proves it, plus an E2E test when the user-visible synchronization path was involved. Generated TSX changes must continue to pass strict TypeScript compilation tests rather than relying only on string snapshots.
