# Srijika MCP Server

This stdio MCP server lets Codex and other MCP clients understand, validate, plan,
and safely scaffold a CLI-first Srijika TSX project without Desktop Studio. It
also coordinates immutable-source React migration into a distinct new Srijika
target through the same canonical developer engine used by CLI and editor
adapters.

Node.js `>=22.13.0` is required. The npm package uses its declared runtime dependencies. The Codex plugin build is
separate and self-contained, including the TypeScript parser, so an installed
plugin does not depend on an ancestor repository `node_modules` directory.

```bash
npx -y @srijika/mcp-server --project /absolute/path/to/project
```

For migration, use the `srijika_create_react_migration` → scan → plan → reviewed
slice apply/verify → global verify → finalize flow. The source is never written;
equal, nested, overlapping, or symlink-aliased roots fail closed. Every applied
slice includes source-to-target traceability and writes atomically inside the
target. Each slice advances only after zero Srijika diagnostics, architecture,
TypeScript, and production build pass. Unsupported or ambiguous behavior remains blocking, and finalization
requires current source-baseline, traceability, architecture, build, typecheck,
and test evidence. The read-only `srijika://docs/react-migration` resource is the
machine-readable contract. The server does not claim arbitrary automatic
rewriting or guaranteed zero context loss; Codex performs reviewed semantic
slice analysis.

The code-project tools are bounded to `--project`, use the shared Srijika developer
engine, refuse overwrite, and enforce the canonical Feature → Slot → Part contract.
Structure plans also support named `behavior-hook` and `store-slice` expansions;
the server derives owner-prefixed paths, reports every move/update, and applies
the reviewed one-time plan atomically without mixed flat/folder gateways.
Flat-to-folder migrations scan the complete bounded project TS/JS corpus so
imports outside the ownership roots are rewired too; unsafe entries, symlinks,
incomplete scans, stale sources, or budget failures abort before any write.
The read-only `srijika://docs/code-first-architecture` resource also defines the
strict shared composites accepted by every surface: `shared-ui` (pure UI plus
optional Types), `shared-widget` (required UI + Connector and optional runtime
chain), and `shared-capability` (no UI/Connector and at least one runtime layer).
Shared code never imports Features, consumers use only public shared boundaries,
freehand shared folders and noncanonical names are invalid, and runtime Shared
owner dependencies must remain acyclic. The resource also publishes the
`SRIJIKA4116` direct-child-UI boundary, `SRIJIKA4117` passive-Types boundary,
`SRIJIKA4118` framework-free Logic boundary, `SRIJIKA4119` computed-module ban,
`SRIJIKA4120` unresolved-project-alias boundary, `SRIJIKA4121` unresolved or
outside-root relative/project-source import boundary, strict UI external-runtime ban,
safe bounded custom architecture configuration, and emitted PROMOTE/SPLIT recommendation
semantics. Types are consumed only through `import type`/`export type` and never
contain or reference runtime values.
If the project omits its `architecture` block, canonical defaults apply. An
explicit block must declare exact profile `feature-slot-part-v1`; missing or
unsupported profiles fail closed. Generated validation reloads current config,
and VS Code/Studio exact-file previews use the canonical resolved planner
rather than hardcoded paths.
The complete config requires `sourceOfTruth: "tsx"` and a bounded `entry` ending
in the resolved UI suffix. Its optional architecture block exposes all twelve
root/directory/suffix overrides. Root `tsconfig.json` is parsed as JSONC; exact
or slash-delimited terminal `/*` `paths` aliases are authoritative, while
`extends`, nonempty `references`, and any explicit `compilerOptions.baseUrl`
are rejected. Empty references are allowed; Vite-only aliases are unsupported
unless declared in root `paths`. Configured suffixes are compared
case-insensitively and cannot overlap by suffix. The configured entry remains a
strict, counted UI source even outside the ownership roots. Config reads are capped at 64 KiB,
`tsconfig.json` at 1 MiB, and a validation/migration corpus at 4,096 sources,
32,768 entries, 4,096 directories, depth 32, 4 MiB per source, and 24 MiB total.
Studio live preview also follows the configured entry, UI suffix, and Connector
suffix. CLI watch uses one filtered recursive project-root watcher, reloads
config, observes config/tsconfig/entry/resolved roots and future-root ancestors,
and stays alive through temporarily invalid configuration until recovery.
When Srijika Studio is running, the same server also exposes its authenticated
document, layout, preview, and history bridge tools.
