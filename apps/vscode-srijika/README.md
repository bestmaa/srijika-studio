# Srijika Language Support

Additive VS Code integration for code-first Srijika UI components. VS Code's
built-in TypeScript/TSX language service remains responsible for standard
TypeScript, React JSX, HTML attributes, navigation, and IntelliSense. Srijika
only adds the stricter authoring contract used by Studio.

The extension validates documents ending in the resolved `uiSuffix`
(`.ui.tsx` by default) with `@srijika/tsx-compiler` when they are opened,
changed, or saved. Compiler diagnostics are shown as editor
squiggles, and compiler-provided text edits are exposed as Quick Fixes. Inside
intrinsic JSX opening tags it also suggests the supported props and event bindings
such as `onClick={props.onOpen}`. The extension does not contain a second set of
Srijika syntax rules; completions and diagnostics use the shared compiler catalog.
Typing `<` also offers only the intrinsic HTML elements supported by the current
Srijika compiler. Generated projects enable Emmet for TSX and VS Code's normal CSS
language suggestions for `.css` files.

## Install in VS Code

Install **Srijika Language Support** from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=srijika.srijika-language-support)
or search for it in VS Code's Extensions view. The stable extension identifier
is `srijika.srijika-language-support`.

For a local Srijika Studio development build:

1. From the Srijika Studio repository run
   `pnpm --filter srijika-language-support install:local`.
2. Reload VS Code.
3. Open the complete Srijika project folder and run its pinned install once. React
   IntelliSense needs the project's `react` and `@types/react` packages; opening only
   a loose file cannot provide that project context. Generated projects deliberately
   use VS Code's built-in TypeScript SDK instead of forcing a platform-specific
   `node_modules/typescript` SDK path.

If every JSX tag reports that `react/jsx-runtime` or `JSX.IntrinsicElements` is
missing, first finish **Install / Sync**, then run **Developer: Reload Window**.
Those messages come from an incomplete/stale React project, not from a Srijika
restriction. After reload, normal TSX support and Srijika diagnostics run together.

The generated project recommends `srijika.srijika-language-support` automatically.
Run **Srijika: Open Setup and Language Support Guide** at any time for this guide.

## Current project Structure Graph

Open the **Srijika** Activity Bar and use the hierarchy icon in the **Structure**
view, or run **Srijika: Open Current Project Structure Graph**. Unlike the
migration graph, this panel does not require a migration session. It scans the
currently selected configured project and renders its live source architecture:

```text
App
|-- Features -> Feature -> Slot -> Part
`-- Shared -> UI / Widget / Headless Capability
                    |
        UI -> Connector -> Hook / Store / Logic / API / Types
```

Click an owner to expand its exact files. Click a file to see incoming and
outgoing imports, named exports, capability, package dependencies, unresolved
imports, and strict-rule findings, then open the source directly. Blue edges
stay inside one owner, green edges consume Shared, dashed amber edges cross
owners, and red edges/nodes come only from matching validator evidence. Search,
violations-only filtering, dependency visibility, collapse, zoom, refresh, and
saved panel state are built in.

The scanner uses the same bounded file/byte limits, symlink rejection,
configuration, aliases, and architecture validator as the editor diagnostics.
In a monorepo it discovers each bounded package with its own
`srijika.config.json`; **Switch project** changes the graph without granting one
package access to another package's source.

## React migration dashboard

Open the **Srijika** Activity Bar container and expand **Migration**, or run
**Srijika: Open React Migration Dashboard**. This is a real VS Code webview over
the shared migration engine and the persisted target session; it does not keep
an alternate plan in extension storage.

1. Choose the existing React folder. It is treated as an immutable source.
2. Keep **New target folder** to type or browse to a separate target. The
   suggested sibling path ends in `-srijika`.
3. Use **Current workspace target** only when the open workspace is an eligible
   empty target or already contains the same resumable migration. A normal
   populated project is rejected; this option never authorizes in-place
   conversion or overwrite.
4. Run **Start / Resume Migration**. The dashboard displays the bounded file
   inventory, canonical Feature / Slot / Part / Shared owner tree, ordered
   migration slices, applied/verified progress, and exact blockers.
5. Use **Refresh status** after CLI, MCP, Studio, or another agent advances the
   same session. Use **Run verification** for engine-owned project checks and
   **Full session JSON** for the complete uncapped machine-readable plan, or
   **Open target** to continue in a separate VS Code window.

The readiness card inspects the current extension host for the OpenAI
Codex/ChatGPT extension and checks the selected target for a readable Srijika
entry in `.vscode/mcp.json` or `.mcp.json`. **Detected** and **Configured** mean
the local pieces exist; the MCP client remains responsible for reporting its
authenticated live connection. **Copy Codex handoff** copies a target- and
session-aware instruction that tells Codex to resume through the fixed Srijika
MCP review/apply/verify sequence.

VS Code decides where an Activity Bar container is placed, so an extension
cannot force itself onto the right edge. To keep Migration on the right, enable
**View -> Appearance -> Secondary Side Bar**, then use the Migration view title
menu and **Move View -> Secondary Side Bar**. The Structure tree can remain on
the left while the migration dashboard stays on the right.

### Interactive architecture graph

After a migration session exists, choose **Open Architecture Graph** in the
Migration dashboard, use its title-bar hierarchy icon, or run **Srijika: Open
Migration Architecture Graph**. The graph opens in a full editor panel so a
real project is not compressed into the sidebar.

The initial view is compact: Application -> Features / Shared / Project ->
Feature -> Slot -> Part. Click an owner to expand its source modules. Selecting
an owner or module shows its role, source path, canonical target paths, imported
modules/packages, named exports, and engine-linked violations. Applied modules
come from a bounded read-only inspection of the real converted target, so the
UI -> Connector -> Hook/Store/API edges and exports are exact. Pending work is
marked as planned source. Named source exports are loaded lazily through the
migration engine's bounded, immutable slice context; the webview never reads
arbitrary paths or keeps a second architecture plan.

Graph edges have explicit meanings:

- gray: ownership hierarchy;
- blue: import inside one owner;
- green: import from a Shared owner;
- dashed amber: cross-owner source dependency that migration must review; and
- red node border: an actual unresolved import or engine-reported migration,
  Srijika diagnostic, architecture, target-graph, or verification failure.

A cross-owner edge is not automatically mislabeled as a violation. It becomes
red only when engine evidence fails. Search, import-edge visibility,
violations-only filtering, collapse, zoom, refresh, and exact source opening are
available from the same panel.

## Feature architecture and ownership

Srijika validates the `feature-slot-part-v1` downward ownership model across the
whole project. The canonical source tree is the resolved
`{featuresRoot}/<feature>` (`src/features/<feature>` by default). A feature
owns optional `slots/`; each slot may own optional `parts/`. Parent stores and
hooks may be consumed anywhere below their owner, while child-private modules
cannot move upward or sideways into a parent or sibling.

Ownership is promoted only as far as its real consumers require: one Part keeps
it in that Part; two Parts promote it to their Slot; two Slots promote it to
their Feature; and two Features promote it to the resolved `sharedRoot`
(`src/shared` by default).

```text
Home feature
|-- Home.ui.tsx                    required, props-only UI
|-- Home.connector.tsx             required runtime gateway
|-- useHome.ts                     optional public Hook gateway
|-- home.store.ts                  optional; Home + all descendants
|-- home.logic.ts                  optional business rules
|-- home.api.ts                    optional HTTP boundary
|-- home.types.ts                  optional owner contracts
`-- slots/navigation
    |-- Navigation.ui.tsx          required slot UI
    |-- Navigation.connector.tsx   required runtime gateway
    |-- useNavigation.ts           optional public Hook gateway
    |-- navigation.store.ts        Navigation subtree only
    `-- parts/user-menu
        |-- UserMenu.ui.tsx
        |-- UserMenu.connector.tsx required runtime gateway
        |-- useUserMenu.ts         optional public Hook gateway
        |-- userMenu.store.ts      UserMenu subtree only
        `-- userMenu.logic.ts      UserMenu subtree only
```

Those flat Hook/Store paths are the small-owner mode. Adding another behavior
or state concern moves the gateway to `hooks/useHome.ts` or
`stores/home.store.ts` and creates only owner-prefixed private files beside it.
The extension rewires imports and removes the root gateway atomically; both
locations can never coexist.

Cross-feature code has three canonical, non-freehand shapes. The paths below
show the default `sharedRoot`; configured roots and suffixes are resolved before
discovery or creation:

```text
src/shared/ui/button
|-- Button.ui.tsx                  required pure props/events UI
`-- button.types.ts                optional; no runtime imports

src/shared/widgets/user-menu
|-- UserMenu.ui.tsx                required pure reusable UI
|-- UserMenu.connector.tsx         required and only runtime UI gateway
`-- useUserMenu.ts                 optional strict runtime chain

src/shared/capabilities/auth
|-- useAuth.ts                     optional public React gateway
|-- auth.store.ts                  optional shared client state
|-- auth.logic.ts                  optional rules
|-- auth.api.ts                    optional transport
`-- auth.types.ts                  optional contracts
```

A Shared UI Primitive allows only UI and optional Types. A Shared Widget uses
the same Connector -> Hook -> Store -> Logic -> API chain as a Feature. A
Headless Capability has no UI or Connector and must contain at least one Hook,
Store, Logic, or API layer. Shared code can never import a Feature or another
owner's private internals.

Allowed access:

| Owner module               | Feature root | Owning slot |      Slot parts | Sibling slot | Other feature |
| -------------------------- | -----------: | ----------: | --------------: | -----------: | ------------: |
| Feature Store / Hooks      |          YES |         YES |             YES |          YES |            NO |
| Slot Store / Hooks / Parts |           NO |         YES |             YES |           NO |            NO |
| Part-private Store / Hooks |           NO |          NO | owning part YES |           NO |            NO |

When two siblings need a private module, do not cross-import it. Promote it to
their nearest common owner. Pure files ending in the resolved `uiSuffix`
(`.ui.tsx` by default) never import stores, hooks, or Connectors; a matching
Connector performs that wiring and supplies typed props.
Run **Srijika: Check Feature Architecture** to validate the complete workspace.

The extension resolves the complete project contract before it discovers,
previews, or creates files. `srijika.config.json` requires exact
`sourceOfTruth: "tsx"` and a normalized configured entry ending in the resolved
UI suffix. An omitted `architecture` object uses defaults; an explicit object
must declare profile `feature-slot-part-v1`. Its twelve optional overrides are
the Feature/Shared roots, Slot/Part/Hook/Store directory names, and
UI/Connector/Store/Logic/API/Types suffixes. Roots are bounded,
project-relative, non-overlapping, and symlink-safe. Directory names and
suffixes are case-insensitively distinct; suffixes are basename-only and no one
suffix may end with another. Invalid explicit configuration fails closed.

Root `tsconfig.json` is parsed as JSONC. `extends` is rejected, `references`
must be absent or empty, and `compilerOptions.baseUrl` must be omitted. Only
exact and slash-delimited terminal `/*` `compilerOptions.paths` aliases are
portable; their first target must stay inside the project. Vite-only aliases do
not become architecture aliases until the same mapping exists in that root
TypeScript configuration.

The configured entry remains authoritative and is included in the bounded scan
even if it is outside the ownership roots. It is still a behavior-free UI and
receives `SRIJIKA4119` computed-module, `SRIJIKA4120` unresolved-alias, and
`SRIJIKA4121` missing/outside-root source-import checks. Complete scans reject
symlinks or partial results and are capped at 4,096 sources, 32,768 entries,
4,096 directories, depth 32, 4 MiB per source, and 24 MiB total.

Every UI rejects identifier/property Hooks, browser/runtime globals, local or
external state/router/request/query behavior, and callable utilities. Only
type-only imports, safe React JSX support, JSX-only presentational bindings,
and CSS/image/icon/font/audio/video assets are accepted. Types is passive and
must use `import type`/`export type`. Logic keeps deterministic business rules
but rejects React/query/router/state lifecycle, browser globals, and transport
APIs/modules; transport belongs in API.

### Fast application runtime

The Structure title bar now provides **Run App**, **Stop App**, and **Doctor**.
Run App starts the project's real Vite server on a strict port, so React Fast
Refresh and Srijika's Connector preview bridge stay active while UI Sources
change. The extension and CLI share project detection and command planning.

Node compatibility mode is the default. Set `srijika.runtime` to `bun` only
when you want the optional Bun-powered Vite turbo path; if Bun is unavailable
or the project is not Vite-based, Srijika reports the reason and safely falls
back to Node. Dependency installation still follows the detected lockfile and
package manager, so changing the JavaScript runtime never silently changes the
resolved dependency graph.

### Strict visual creation

Open the **Srijika** Activity Bar icon and expand the **Structure** view. Every
canonical Feature, Slot, and Part owner has an inline `+` action. The same flow
is also available by right-clicking an exact ownership folder in the normal VS
Code Explorer and running **Srijika: Add Strict Feature / Shared Owner...**:

```text
{featuresRoot} -> New Feature
Feature root  -> Feature capabilities or New Slot
Slot root     -> Slot capabilities or New Part
Part root     -> Part capabilities only
{sharedRoot}  -> New Shared UI Primitive, New Shared Widget, or New Headless Capability
Shared owner  -> Only the capabilities valid for that exact shared owner kind
```

For an existing Feature, Slot, or Part, the form first shows its complete file
checklist. Created files stay visible as checked, disabled `Created` entries;
missing Connector, Hook, Store, Logic, API, and Types entries can be selected
individually or with **Select all missing files** and created as one safely
rewired batch. `New Slot` and `New Part` remain separate choices in the same
form, so completing an owner never hides child creation.

If Hook or Store already exists, **Add private Hook / Store behavior** accepts a
suffix such as `Keyboard` or `Filters`. It derives `useOwnerKeyboard.ts` or
`ownerFilters.store.ts` and switches the capability from flat to expanded mode
when necessary. `index.ts`, custom prefixes, mixed layouts, and deeper
`hooks/`/`stores/` folders are rejected by the same workspace validator.

For a new Feature, Slot, or Part, enter one normalized PascalCase name and tick
only the optional Hook, Store, Logic, API, and Types you need. UI + Connector
are always required. The visual form displays every exact path while you type,
without rebuilding the form or losing input focus. The extension derives every
path, rejects arbitrary folders and alternate names, preflights duplicates, and
commits the validated files together without overwrite. When an existing custom
Connector needs a new Hook boundary, Srijika preserves its behavior and inserts
only the required Hook import and call. The sidebar and Explorer command both
use the same scaffold engine as the strict project contract.

## Complexity policy

The shared Srijika compiler reports editor diagnostics when a file ending in
the resolved `uiSuffix` (`.ui.tsx` by default) exceeds any of these project
rules:

- 200 meaningful lines in the exported UI function. Its local or resolved
  owner-local type-only props interface,
  blank lines, and comments are excluded from this function count.
- 300 meaningful lines in the complete resolved UI Source file.
- 16 top-level component contract members. Data props, events, ReactNode slots,
  and optional props all count.

Because these diagnostics come from `@srijika/tsx-compiler`, Studio and the VS
Code extension always enforce the same policy.

## Command

- **Srijika: Check Current UI File** (`srijika.checkCurrentFile`) validates the
  active document ending in the resolved `uiSuffix` and writes a summary to the
  Srijika output channel.
- **Srijika: Check Strict Project Architecture** (`srijika.checkArchitecture`)
  validates Feature and Shared ownership with the same project rule engine.
- **Srijika: Open Migration Architecture Graph**
  (`srijika.openMigrationArchitecture`) opens the session-backed interactive
  ownership, import/export, Shared dependency, and violation graph.
- **Srijika: Open Current Project Structure Graph**
  (`srijika.openProjectArchitecture`) opens the live configured-project graph
  without requiring a migration session, including monorepo package selection.
- **Srijika: Add Strict Feature / Shared Owner...**
  (`srijika.addOwnershipCapability`) opens the strict visual scaffold form from
  the Structure `+` action or Explorer folder context menu.
- **Srijika: Refresh Structure** (`srijika.refreshStructure`) refreshes the
  Feature -> Slot -> Part and canonical Shared owner hierarchies.
- **Srijika: Run App** (`srijika.runApp`) starts the real strict-port Vite app.
- **Srijika: Stop App** (`srijika.stopApp`) terminates the managed VS Code task.
- **Srijika: Run Doctor** (`srijika.doctor`) audits Node, Bun, package manager,
  lockfile, and project scripts through the shared developer engine.
- **Srijika: Sync Owner Vitest / Playwright Tests** (`srijika.syncOwnerTests`)
  safely creates or updates the generated Vite or Next.js owner-test harness,
  while preserving authored fixtures and refusing unknown file collisions.
- **Srijika: Show Owner Test Evidence** (`srijika.showTestEvidence`) reads the
  generated Vitest and Playwright JSON reports and shows every owner as passed,
  failed, uncovered, or not-run. Missing reports and verification gates never
  appear green.
- **Srijika: Verify All Owner Tests** (`srijika.verifyOwnerTests`) synchronizes
  the adapter and package contract, installs the resolved test toolchain and
  Chromium, then runs architecture, typecheck, Vitest, and Playwright gates.

## Development

```sh
pnpm --filter srijika-language-support typecheck
pnpm --filter srijika-language-support test
pnpm --filter srijika-language-support build
pnpm --filter srijika-language-support install:local
```

The build bundles the extension and compiler for Node.js while leaving the
VS Code runtime API external. Output is written to `dist/extension.cjs`.
