# Srijika Language Support

Additive VS Code integration for code-first Srijika UI components. VS Code's
built-in TypeScript/TSX language service remains responsible for standard
TypeScript, React JSX, HTML attributes, navigation, and IntelliSense. Srijika
only adds the stricter authoring contract used by Studio.

The extension validates `*.ui.tsx` documents with `@srijika/tsx-compiler` when they
are opened, changed, or saved. Compiler diagnostics are shown as editor
squiggles, and compiler-provided text edits are exposed as Quick Fixes. Inside
intrinsic JSX opening tags it also suggests the supported props and event bindings
such as `onClick={props.onOpen}`. The extension does not contain a second set of
Srijika syntax rules; completions and diagnostics use the shared compiler catalog.
Typing `<` also offers only the intrinsic HTML elements supported by the current
Srijika compiler. Generated projects enable Emmet for TSX and VS Code's normal CSS
language suggestions for `.css` files.

## Install in VS Code

For a local Srijika Studio build:

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

## Feature architecture and ownership

Srijika validates the `feature-slot-part-v1` downward ownership model across the
whole project. The canonical source tree is `src/features/<feature>`. A feature
owns optional `slots/`; each slot may own optional `parts/`. Parent stores and
hooks may be consumed anywhere below their owner, while child-private modules
cannot move upward or sideways into a parent or sibling.

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

Allowed access:

| Owner module               | Feature root | Owning slot |      Slot parts | Sibling slot | Other feature |
| -------------------------- | -----------: | ----------: | --------------: | -----------: | ------------: |
| Feature Store / Hooks      |          YES |         YES |             YES |          YES |            NO |
| Slot Store / Hooks / Parts |           NO |         YES |             YES |           NO |            NO |
| Part-private Store / Hooks |           NO |          NO | owning part YES |           NO |            NO |

When two siblings need a private module, do not cross-import it. Promote it to
their nearest common owner. Pure `*.ui.tsx` files never import stores, hooks, or
Connectors; a matching Connector performs that wiring and supplies typed props.
Run **Srijika: Check Feature Architecture** to validate the complete workspace.

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
Code Explorer and running **Srijika: Add Feature / Slot / Part Capability...**:

```text
src/features -> New Feature
Feature root  -> Feature capabilities or New Slot
Slot root     -> Slot capabilities or New Part
Part root     -> Part capabilities only
```

For an existing Feature, Slot, or Part, the form first shows its complete file
checklist. Created files stay visible as checked, disabled `Created` entries;
missing Connector, Hook, Store, Logic, API, and Types entries can be selected
individually or with **Select all missing files** and created as one safely
rewired batch. `New Slot` and `New Part` remain separate choices in the same
form, so completing an owner never hides child creation.

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

The shared Srijika compiler reports editor diagnostics when a `*.ui.tsx` file
exceeds any of these project rules:

- 200 meaningful lines in the exported UI function. Its local props interface,
  blank lines, and comments are excluded from this function count.
- 300 meaningful lines in the complete `*.ui.tsx` file.
- 16 top-level component contract members. Data props, events, ReactNode slots,
  and optional props all count.

Because these diagnostics come from `@srijika/tsx-compiler`, Studio and the VS
Code extension always enforce the same policy.

## Command

- **Srijika: Check Current UI File** (`srijika.checkCurrentFile`) validates the
  active `*.ui.tsx` document and writes a summary to the Srijika output channel.
- **Srijika: Add Feature / Slot / Part Capability...**
  (`srijika.addOwnershipCapability`) opens the strict visual scaffold form from
  the Structure `+` action or Explorer folder context menu.
- **Srijika: Refresh Structure** (`srijika.refreshStructure`) refreshes the
  Feature -> Slot -> Part sidebar hierarchy.
- **Srijika: Run App** (`srijika.runApp`) starts the real strict-port Vite app.
- **Srijika: Stop App** (`srijika.stopApp`) terminates the managed VS Code task.
- **Srijika: Run Doctor** (`srijika.doctor`) audits Node, Bun, package manager,
  lockfile, and project scripts through the shared developer engine.

## Development

```sh
pnpm --filter srijika-language-support typecheck
pnpm --filter srijika-language-support test
pnpm --filter srijika-language-support build
pnpm --filter srijika-language-support install:local
```

The build bundles the extension and compiler for Node.js while leaving the
VS Code runtime API external. Output is written to `dist/extension.cjs`.
