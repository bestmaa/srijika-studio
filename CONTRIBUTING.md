# Contributing to Srijika Studio

Thank you for helping improve Srijika Studio. Contributions are welcome across the
desktop application, VS Code extension, compiler, project tooling, documentation,
tests, and examples.

## Before you start

- Search existing issues and discussions before opening a new one.
- Use an issue or discussion for substantial features, architecture changes, or
  behavior that affects more than one package.
- Report security vulnerabilities through GitHub's private vulnerability reporting
  flow described in [SECURITY.md](SECURITY.md), not through a public issue.
- Keep a pull request focused on one problem. Separate unrelated cleanup.

## Branch names

Use a short, descriptive branch name with the appropriate prefix:

- `fix/<topic>` for bug fixes;
- `feat/<topic>` for product features;
- `docs/<topic>` for documentation-only changes;
- `test/<topic>` for test-only changes;
- `refactor/<topic>` for behavior-preserving restructuring;
- `chore/<topic>` for maintenance; and
- `release/<version>` for release preparation.

Examples: `fix/graph-zoom`, `feat/focused-subgraphs`, and
`docs/extension-setup`.

## Development setup

Srijika Studio currently requires Node.js 22.13 or newer, pnpm 11.18.0, and the
Rust toolchain pinned by `rust-toolchain.toml`.

```bash
git clone https://github.com/bestmaa/srijika-studio.git
cd srijika-studio
corepack enable
pnpm install --frozen-lockfile
pnpm verify:fast
```

Read [Development setup](docs/DEVELOPMENT.md) before running the Tauri desktop
shell, and read [Architecture](docs/ARCHITECTURE.md) before changing shared
contracts.

## Making a change

1. Create a branch from the latest `main` using the conventions above.
2. Add or update tests that demonstrate the intended behavior.
3. Follow existing TypeScript, React, Rust, accessibility, and security patterns.
4. Update user-facing documentation when behavior or commands change.
5. Run the smallest relevant tests while iterating, then the appropriate quality
   gates before opening a pull request.

Useful commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:packages
pnpm check:rust
pnpm test:e2e:web
pnpm build
```

`pnpm verify:fast` runs formatting, linting, type checks, and the main regression
suite. Full browser, generated-project, native, and packaging checks also run in
CI. Only report commands and results that you actually observed.

## Commit and pull request style

Write concise commit subjects that describe the change. The repository commonly
uses scoped subjects such as:

- `fix(vscode): preserve graph focus while zooming`
- `feat(cli): add workspace validation summary`
- `docs: explain the owner dependency rules`
- `test(studio): cover preview recovery`

A pull request should explain the problem, the chosen approach, important tradeoffs,
and the tests that ran. Include screenshots or recordings for visible UI changes.
Reviewers may request that a large pull request be divided into independently
reviewable changes.

## Review expectations

Pull requests must pass required CI checks and receive maintainer review before
merge. Maintainers may close changes that bypass project safety boundaries, weaken
validation without evidence, introduce unrelated generated files, or do not include
enough information to reproduce and review the change.

By contributing, you agree that your contribution is licensed under the repository's
[Apache License 2.0](LICENSE).
