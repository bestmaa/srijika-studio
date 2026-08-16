# Code-first architecture

Every path below is resolved from the current project's validated
`srijika.config.json`, never reconstructed from defaults. Placeholders such as
`{featuresRoot}`, `{sharedRoot}`, `{hooksDirectory}`, `{storesDirectory}`, and
`{uiSuffix}` mean the resolved architecture value. The canonical defaults are
`src/features`, `src/shared`, `hooks`, `stores`, `.ui.tsx`, `.connector.tsx`,
`.store.ts`, `.logic.ts`, `.api.ts`, and `.types.ts`, but agents must not use
those literals when a valid project overrides them.

## Owner contract

Every Feature, Slot, and Part has two required public files:

```text
Owner{uiSuffix}
Owner{connectorSuffix}
```

It may add only the capabilities it needs:

```text
useOwner.ts
owner{storeSuffix}
owner{logicSuffix}
owner{apiSuffix}
owner{typesSuffix}
```

Hook and Store each use one of two mutually exclusive layouts. Start flat with
`useOwner.ts` and `owner{storeSuffix}`. When a second Hook behavior is required,
plan `behavior-hook <Behavior>`: atomically move the gateway to
`{hooksDirectory}/useOwner.ts`, create
`{hooksDirectory}/useOwner<Behavior>.ts`, rewire imports, and remove the root
gateway. `store-slice <Concern>` performs the matching move to
`{storesDirectory}/owner{storeSuffix}` and creates
`{storesDirectory}/owner<Concern>{storeSuffix}`.

Never keep both gateway locations. Consumers enter only through the gateway;
they never import private helpers/concerns. The two folders stay one level deep
and must not contain `index.ts`, arbitrary utilities, alternate owner prefixes,
or further folders.

## Strict creation matrix

Resolve the selected folder before any filesystem write. Only these actions are
valid:

```text
{featuresRoot}
  -> New Feature

Feature root
  -> Feature Connector, Hook, Private Hook, Store, Private Store, Logic, API, Types, or New Slot

Slot root
  -> Slot Connector, Hook, Private Hook, Store, Private Store, Logic, API, Types, or New Part

Part root
  -> Part Connector, Hook, Private Hook, Store, Private Store, Logic, API, or Types

{sharedRoot}
  -> Shared UI Primitive, Shared Widget, or Shared Headless Capability
```

Creating a new Feature, Slot, or Part is one composite request. Its normalized
PascalCase name derives the kebab-case owner folder and all file names. Always
create `Owner{uiSuffix}` and `Owner{connectorSuffix}`; create Hook, Store, Logic,
API, and Types only when selected. Preflight every target path, never overwrite, and
write the request as one coherent batch. Do not invent alternate folders,
suffixes, or sibling names. If the selected folder is not one of the exact
boundaries above, stop instead of creating arbitrary structure.

## Runtime resolution

```text
UI ← Connector → Hook → Store → Logic → API → Backend
```

Use the highest available capability for the same owner and behavior:

```text
Connector: Hook, otherwise Store, otherwise Logic, otherwise API
Hook:      Store, otherwise Logic, otherwise API
Store:     Logic, otherwise API
Logic:     API
```

Never skip an intermediate capability that already owns the behavior. Results
return through the same chain as typed UI props. Types are passive and are not
a runtime step. A `*{typesSuffix}` file contains only interfaces, type aliases,
`import type`, `export type`, and an optional empty `export {}`. It cannot expose
a runtime value or refer to one through `typeof`, a computed property, or
another value expression. Consume it only through `import type`/`export type`.
UI accepts one named `props` parameter. Its interface may be local or imported
type-only from that same owner's resolved passive Types file.

Treat `SRIJIKA-ARCH-STRICT-OWNER-SHAPE`,
`SRIJIKA-ARCH-MIXED-CAPABILITY-LAYOUT`, and
`SRIJIKA-ARCH-MISSING-CAPABILITY-GATEWAY` as hard failures. Do not work around
them with a barrel, alias, alternate filename, or ad-hoc directory.

Only a matching Connector renders an owner UI. Feature Connectors compose Slot
Connectors; Slot Connectors compose Part Connectors. Do not render a child UI
directly from a parent or sibling. The only cross-owner UI exception is pure UI
composition of a canonical Shared UI Primitive.

Every `*{uiSuffix}` renderer is behavior-free. Do not call identifier Hooks such as
`useHome()` or property Hooks such as `React.useState()`. Do not access
`fetch`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `sessionStorage`, or any
other browser/runtime behavior API. Do not import Connector, Hook, Store,
Logic, API, external state/router/request/query-lifecycle modules, or callable
utilities. External UI imports are limited to type-only contracts,
styles/assets, safe React JSX support, and presentational bindings used only as
JSX tags. Pass all values, event callbacks, and `ReactNode` composition through
typed props.

Keep `*{logicSuffix}` framework-free and deterministic. Logic may own business
rules, pure validation/authorization, deterministic transforms, aggregation,
and orchestration through its matching API. It may use passive Types and pure
utilities. It may not own React/Hook, React Query/query-cache, router, or
client-state lifecycle. Move those concerns to Hook, Connector, or Store and
request transport to API.

Treat these as hard failures everywhere (CLI, VS Code, Studio, and MCP):

```text
SRIJIKA4101  SRIJIKA-ARCH-UI-RUNTIME-IMPORT
SRIJIKA4116  SRIJIKA-ARCH-DIRECT-CHILD-UI
SRIJIKA4117  SRIJIKA-ARCH-PASSIVE-TYPES
SRIJIKA4118  SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN
```

## Ownership

Place a capability at the narrowest owner that needs it:

```text
one Part needs it       → Part root
two Parts need it       → their Slot root
two Slots need it       → their Feature root
two Features need it    → {sharedRoot}
```

Do not import private child code upward, private sibling code sideways, or
Feature-private code across Features.

## Strict shared owners

Never treat `{sharedRoot}` as a freehand `utils` or `common` directory. Resolve
exactly one composite owner before planning:

### Shared UI Primitive

Path: `{sharedRoot}/ui/<name>/`. Required `Owner{uiSuffix}`; optional
`owner{typesSuffix}`; all Connector and runtime files forbidden. All values,
events, and composition arrive through typed props. Its UI is the public
boundary and may be imported by another pure UI.

Plan with:

```text
kind: shared-ui
optionalCapabilities: [] or [types]
```

### Shared Widget

Path: `{sharedRoot}/widgets/<name>/`. UI + Connector required; Hook, Store, Logic,
API, and Types optional. Consumers compose only `OwnerConnector`. Apply the
normal highest-available/no-jump chain and the same mutually-exclusive expanded
Hook/Store gateway rules.

Plan with:

```text
kind: shared-widget
optionalCapabilities: any canonical Hook/Store/Logic/API/Types subset
```

### Shared Headless Capability

Path: `{sharedRoot}/capabilities/<name>/`. UI and Connector forbidden. Hook,
Store, Logic, API, and Types are selectable, but at least one runtime layer is
required. Types alone is invalid. The public boundary is Hook, otherwise Store,
otherwise Logic, otherwise API; consumers never import a lower private layer.

Plan with:

```text
kind: shared-capability
optionalCapabilities: at least one of hook/store/logic/api; types optional
```

Shared never imports `{featuresRoot}`. A Feature, Slot, or Part imports only the
public shared boundary. Shared owners may use another shared owner only through
its public boundary and must not form a runtime cycle; type-only dependency
edges are passive and do not create runtime cycles. Reject freehand Shared root
files, `utils`, `common`, arbitrary nested folders, barrels, alternate suffixes,
noncanonical owner spellings, and private shared imports.

Treat these shared diagnostics as hard failures:

```text
SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY
SRIJIKA-ARCH-SHARED-PRIVATE-IMPORT
SRIJIKA-ARCH-SHARED-MISSING-RUNTIME-GATEWAY
```

Examples: Button is Shared UI; UserMenu is a Shared Widget; Auth/session and a
common HTTP API boundary are Shared Headless Capabilities.

## Responsibilities

- UI: pure typed JSX, props, event callbacks, and composition slots.
- Connector: public runtime gateway and mapping to UI props.
- Hook: React lifecycle and optional TanStack Query server cache, retry, effects, and mutations.
- Store: shared client state, selectors, transitions, and owner actions.
- Logic: business rules, validation, transformation, and orchestration.
- API: HTTP transport and request/response parsing.

The default scaffold does not include TanStack Query. Use
`srijika create <directory> --react-query` only when the project needs it. Do
not duplicate one server entity in both TanStack Query and Zustand.

## Safe custom configuration

Read custom roots, structural directory names, and canonical suffixes only from
the `architecture` object in `srijika.config.json`. Roots must be normalized
project-relative paths of no more than 10 segments and Feature/Shared roots must
not overlap. Slot/Part/Hook/Store directory names must be distinct single
segments. UI/Connector suffixes must be distinct basename-only `.tsx` values;
Store/Logic/API/Types suffixes must be distinct basename-only `.ts` values and
must not end in `.d.ts`.

Reject NUL bytes, absolute/drive paths, backslashes, empty/`.`/`..` segments,
traversal, root overlap, or duplicate directory/suffix values before discovery
or planning. Filesystem adapters also reject symlinked project/config/source
roots and symlinked scope ancestors before reading or writing. Never normalize
an unsafe input into an accepted location or recreate a plan with ad hoc paths.

The complete config also requires exact `sourceOfTruth: "tsx"` and a normalized
project-relative `entry` of at most 32 segments ending in the resolved UI
suffix. The optional architecture block exposes twelve overrides exactly:
`featuresRoot`, `sharedRoot`, `slotsDirectory`, `partsDirectory`,
`hooksDirectory`, `storesDirectory`, `uiSuffix`, `connectorSuffix`,
`storeSuffix`, `logicSuffix`, `apiSuffix`, and `typesSuffix`.

The `architecture` block itself is optional. If absent, resolve canonical
defaults. If present, require exact profile `feature-slot-part-v1`; a missing or
unsupported profile fails closed on generated validation, CLI, VS Code, Studio,
and MCP. Never recover an explicit invalid block by substituting defaults.

`scripts/srijika-validate.mjs` reads the current project configuration whenever
it runs; it does not retain a baked generation-time architecture snapshot.
`srijika check --watch` uses one filtered project-root watcher for config,
`tsconfig.json`, entry, resolved roots, and future-root ancestors. It reloads
configuration and recovers after temporarily invalid edits. VS Code and Studio
exact-file, safe-move, and safe-rewire previews are direct canonical
planner output under the resolved configuration, never paths reconstructed by
the form.

Root `tsconfig.json` is JSONC and is the only custom-alias authority. Reject
`extends`; allow `references` only when absent or empty; and require
`compilerOptions.baseUrl` to be omitted. Accept exact or slash-delimited
terminal `/*` `compilerOptions.paths`, use the first target, and keep it inside
the project. Generated `@/`,
`@features/`, and `@shared/` aliases are recognized. Unresolved reserved `~/`,
`#...`, `@app`, and `@src` imports fail with `SRIJIKA4120`; a Vite-only alias is
unsupported until it is also declared in `tsconfig.json`. Computed `import()`
or `require()` inside an ownership root fails with `SRIJIKA4119`.
Every governed relative or `src/...` source import must resolve to a scanned
source inside the configured Feature/Shared roots or fail with `SRIJIKA4121`.
CSS and static-asset imports are exempt; external packages use bare specifiers.

The configured `entry` is always included in validation and the source-file
budget even when it is outside both ownership roots. It remains a pure UI and
receives `SRIJIKA4119`–`SRIJIKA4121` import checks. Reads fail closed at exact limits: 64 KiB config, 1 MiB `tsconfig.json`, 4,096
source files, 32,768 entries, 4,096 directories, depth 32, 4 MiB per source,
and 24 MiB aggregate. Flat-to-folder Hook/Store migration scans that complete
safe TS/JS project corpus, not only ownership roots, before moving the gateway
or rewriting any import. Studio live preview likewise uses the configured
entry, UI suffix, and Connector suffix.

## Deterministic v1 recommendations

These are non-blocking guidance. Ownership and no-jump violations remain
errors.

- `SRIJIKA-ARCH-RECOMMEND-LOGIC`: direct API work has at least two endpoint calls, business branching, validation, authorization, transformation, aggregation, or multi-step orchestration.
- `SRIJIKA-ARCH-RECOMMEND-HOOK`: behavior needs cache/retry/polling/cancellation/subscription/pagination/mutation lifecycle, at least two async handlers, or at least three React lifecycle Hooks.
- `SRIJIKA-ARCH-RECOMMEND-STORE`: state serves at least two descendants, crosses at least two ownership boundaries, or an owner Connector has at least four related local fields.
- `SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE`: a Connector consumes at least five Store selectors/actions, or Store actions own async lifecycle/cache.
- `SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER`: a private Hook/Store/Logic/API crosses an owner boundary. It is emitted with `owner-consumers=2` evidence and attached to the blocking ownership diagnostic; move the capability to the nearest common Part → Slot → Feature → Shared owner.
- `SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER`: UI function exceeds 200 meaningful lines, UI file exceeds 300, or public contract exceeds 16 top-level members. It is emitted as non-blocking `SRIJIKA4202` only above those exact limits (201/301/17).

Before a code-first write, determine the owner, list the available capabilities
for the behavior, choose the first available capability in the resolution
table, and check whether the capability must be promoted to a common owner.

For filesystem creation, use the shared Studio/VS Code form or `srijika add`.
The CLI public composite kinds are `shared-ui`, `shared-widget`, and
`shared-capability`. CLI, VS Code, Studio, and MCP use the same planner and
no-overwrite contract; do not recreate owner templates with ad hoc shell writes.
