# UI MVP acceptance checklist

This checklist defines the first Srijika Studio milestone. “Done” means implemented and covered by the repository's automated checks; it does not pull later API, AI, or release-platform work into the UI MVP.

| Capability                     | Status               | Acceptance evidence                                                                                                        |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Desktop-style editor shell     | Done                 | Palette/hierarchy on the left, actual-DOM design frame in the center, and schema-driven Inspector on the right             |
| Canonical document model       | Done                 | Version 1 TypeBox/Ajv schema, normalized graph, stable symbols, runtime validation, and JSON view                          |
| Safe edit pipeline             | Done                 | Revision/document-checked command envelopes, graph and semantic validation, bounded coalesced undo/redo                    |
| Component authoring            | Done for core set    | Page, Container, Stack, Grid, Text, Heading, Button, and Input manifests and React implementations                         |
| JSX structure                  | Done                 | Fragment/slot rendering plus authorable `If` and atomic `Repeat` nodes with scoped symbols                                 |
| Inactive branch editing        | Done                 | True/false branch choice is transient; content can be added to either persisted branch without altering the condition      |
| Typed Inspector                | Done for MVP fields  | Literals/bindings, events, public props, visibility, base styles, classes, conditions, repeat sources, and code references |
| Synchronized projections       | Done                 | Inspector edits update the hierarchy, actual DOM, canonical JSON, and generated TSX from one document                      |
| Browser preview                | Done for development | `/preview` hydrates from localStorage and receives live BroadcastChannel updates on Vite port 5173                         |
| Persistence                    | Done                 | Browser upload/download and Tauri dialog adapters; Rust validates bounded JSON and writes atomically                       |
| Deterministic code output      | Done for core set    | Generated TSX tests compile under strict TypeScript; unknown components fail without an adapter                            |
| Automated QA                   | Done                 | Contract/unit/integration tests, cross-iframe Playwright flows, accessibility, visual, coverage, and full Rust gates       |
| Linux Tauri build verification | Done; runtime gated  | Tauri check/build, full-workspace tests, and Clippy pass; interactive launch still needs the documented system packages    |

## Release gate commands

```bash
pnpm verify
pnpm test:coverage
pnpm test:e2e:web
cargo fmt --all -- --check
cargo clippy --locked -p project-store -p studio-core -- -D warnings
cargo test --locked -p project-store -p studio-core
```

After the packages in [Development setup](DEVELOPMENT.md) are installed:

```bash
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo check -p srijika-studio --locked
pnpm tauri dev
```

## Explicitly outside this milestone

- API endpoint authoring, business workflows, and monolithic generated server output;
- AI model integration or a natural-language generation panel;
- multi-page project management;
- project-wide token/class/variant management;
- third-party runtime/codegen adapter packaging;
- bundled Node download and version management;
- a packaged external-browser loopback preview; and
- signed cross-platform production installers.
