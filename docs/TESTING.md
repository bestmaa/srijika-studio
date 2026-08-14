# Testing strategy

## JavaScript quality gate

```bash
pnpm verify
```

`verify` runs formatting, ESLint with zero warnings, strict TypeScript checks for every package, all Vitest projects, and the production Vite build. It does not include coverage or Playwright, so run those separately:

```bash
pnpm test:coverage
pnpm test:e2e:web
```

V8 coverage is enforced for the reusable framework packages at 75% for lines, functions, and statements and 60% for branches. The React editor shell is intentionally measured by the Playwright, visual, and Axe browser gates because those browser executions are not represented in Vitest's V8 process. The report is written to `coverage/`.

## Test layers

- **Contracts:** TypeBox/Ajv acceptance and rejection, canonical JSON round trips, property-based document identifiers, and pinned project toolchain shape.
- **Unit:** document commands/history/envelopes, atomic repeater scope, expression evaluation, manifest registry and semantic analyzer, and deterministic TSX generation/compilation.
- **Integration:** registry-backed React rendering, named-slot preservation, Inspector-to-document behavior, invalid-import rejection, and UI error resilience in jsdom.
- **Browser E2E:** editor shell, palette insertion, cross-iframe DOM drag/drop, Inspector/JSON/TSX synchronization, independent live `/preview` synchronization, inactive `If` branch authoring, and absence of page errors.
- **Accessibility:** Axe checks for serious/critical shell violations. The current check excludes the design iframe and disables color contrast, so those areas still need separate manual and automated coverage.
- **Visual:** a deterministic 1440×900 dark-mode Chromium snapshot in `tests/e2e/editor-visual.spec.ts-snapshots/`.
- **Rust:** bounded/atomic JSON persistence, error behavior, envelope/path validation, and the narrow Tauri command error contract.

Geometry-sensitive drag/drop and visual behavior run in Chromium, not jsdom.

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

Playwright starts its own strict Vite server on `127.0.0.1:4173` by default, independent of the manual development port 5173. Override it with `SRIJIKA_E2E_PORT` if necessary. Traces, screenshots, and video are retained on failure; the HTML report is written to `playwright-report/`.

Update the committed visual baseline only after reviewing an intentional design change:

```bash
pnpm exec playwright test tests/e2e/editor-visual.spec.ts --update-snapshots
```

## Rust gates

The two native core crates can be checked before installing WebKitGTK:

```bash
cargo fmt --all -- --check
cargo clippy --locked -p project-store -p studio-core -- -D warnings
cargo test --locked -p project-store -p studio-core
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
