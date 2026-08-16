# Code-first Srijika TSX

## One authority

Every visual component is authored in a file ending in the resolved UI suffix (canonical default `.ui.tsx`). That source file is canonical. Srijika Studio, the VS Code extension, the hierarchy, the Inspector, and the preview all consume it; none of those projections can silently become a second source of truth.

```text
{uiSuffix} → restricted parser → diagnostics + source map + UiDocument → renderer
    ↑              │
    └── source edits from safe quick fixes and supported Studio controls
```

If compilation fails, diagnostics update immediately and Studio continues to show the last successful document with a **last valid preview** label. Fixing the source re-enters the same pipeline.

## Generated project layout

`@srijika/project-scaffold` creates a complete React project without overwriting an existing directory:

```text
srijika-app/
├── srijika.config.json
├── srijika.toolchain.json
├── pnpm-lock.yaml
├── vite.config.ts                 # React Compiler enabled
├── .vscode/extensions.json        # recommends Srijika language support
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── shared/                     # strict UI/Widget/Headless owners only
    └── features/
        └── home/
            ├── Home.ui.tsx
            ├── Home.connector.tsx
            ├── useHome.ts
            ├── home.store.ts
            └── slots/navigation/
                ├── Navigation.ui.tsx
                └── Navigation.connector.tsx
```

The default starter has no TanStack Query dependency or `src/app` Provider
folder. `--react-query` opts into `src/app/AppProviders.tsx` and
`src/app/query-client.ts`; ordinary Hooks, Stores, Logic, and API boundaries do
not require that integration.

Pure UI files accept typed props and render them. Connector files may use hooks, stores, resources, routing, and actions. The starter demonstrates connector-owned state, normalized typed events, and a typed ReactNode navigation slot while remaining one page. A parent connector can supply child connectors as typed slots, so the parent UI does not drill unrelated child data:

```tsx
export function HomeConnector() {
  return <HomeUI navigationSlot={<NavigationSlot />} />;
}
```

This is called the **Connector + UI Slot** pattern. React Compiler is the separate **React Compiler policy**: generated projects enable it globally, while individual measured exceptions may use React's supported opt-out directive.

## Restricted UI rules (v1)

A file ending in the resolved UI suffix must:

- export exactly one named function component;
- accept zero props or one named `props` parameter;
- reference a named interface declared in the UI file or resolved through an
  owner-local relative `import type` from its passive Types file;
- keep the component body to directives plus one JSX return;
- use supported intrinsic JSX elements and explicit attributes;
- bind button interaction through a local `() => void` props callback, for example `onClick={props.onLaunch}`;
- use prop references, literals, supported binary expressions, `&&`, nullish fallback (`??`), or ternaries in JSX;
- keep hooks, stores, requests, mutations, local business logic, and effects in a connector.

### Complexity policy

Srijika applies one compiler-owned complexity policy to every file ending in
the resolved UI suffix (canonical default `.ui.tsx`):

- the exported UI function may contain at most **200 meaningful lines**;
- the complete UI source file may contain at most **300 meaningful lines**;
- the local or resolved owner Types props interface may declare at most **16 top-level members**.

Meaningful-line counting ignores blank lines and comments. The 200-line function
limit starts at the exported function and therefore excludes the colocated props
interface and imports; the 300-line file limit includes all real syntax in the file.
Every top-level data prop, event callback, ReactNode slot, and optional prop counts
toward the 16-member contract limit.

Crossing any maximum produces a compiler error while preserving the safely derived
document for inspection. The same `SRIJIKA3001`–`SRIJIKA3003` diagnostics appear in
Studio and the Srijika VS Code extension because both consume `@srijika/tsx-compiler`.

The intrinsic set includes `main`, `div`, `header`, `nav`, `section`, `footer`, `article`, `aside`, `form`, `figure`, lists, `label`, `span`, `p`, headings, `img`, `button`, and typed `input` controls. The Studio Components panel emits only this compiler-supported subset. A click inserts into the selected (or nearest ancestor) container; drag/drop can target UI Nodes, the derived canvas, or a bridge-enabled live project. Every insertion is an AST-validated TSX edit and is compiled again before the derived document is published. Spread attributes, inline event logic, native event forwarding, and arbitrary custom components are rejected rather than executed. Prop contracts may use valid TypeScript types including primitives, `unknown`, arrays, tuples, literal unions, nested objects, local aliases/interfaces, and imported/custom type references. Inspector preserves and displays the exact authored type text; structurally understood types also produce precise `ValueShape` metadata, while unresolved project types safely derive as `unknown`. `any` remains usable TypeScript but produces a Srijika safety warning. Events and ReactNode slots remain separate contract categories.

Example:

```tsx
export interface ProfileUIProps {
  name: string;
  avatarUrl: string;
  isActive: boolean;
}

export function ProfileUI(props: ProfileUIProps) {
  return (
    <div className="profile">
      <img src={props.avatarUrl} alt="" />
      <span>{props.name}</span>
      {props.isActive && <span>Online</span>}
    </div>
  );
}
```

The compiler never evaluates the module. Unsupported syntax produces a `SRIJIKA…` diagnostic with a UTF-16 source span and, when safe, a machine-readable quick fix.

## Two-way behavior

“Two-way” does not mean keeping TSX and JSON synchronized as equal documents. It means both authoring surfaces write the same TSX authority:

- VS Code edits TSX directly; Studio notices the changed content hash and recompiles.
- Studio quick fixes and supported visual controls produce bounded AST source edits, then recompile.
- Inspector can add common presets or one validated custom TypeScript type expression; it writes only a local props interface. Imported owner Types contracts remain read-only until an atomic multi-file action edits their source file.
- A stale expected hash prevents Studio from overwriting newer VS Code work.
- Unsupported visual mutations stay read-only until a lossless source writer exists for them.

Comments, imports, formatting, helper types, and unrelated developer code must survive Studio edits. Regenerating a complete TSX file from `UiDocument` is forbidden.

## Project Explorer and external editing

Desktop Studio treats the selected directory as one independent React workspace.
It scans a bounded tree without following symlinks or entering `.git`,
`node_modules`, `dist`, or `build`. Project Explorer shows those real files, while
UI Nodes shows the derived hierarchy for the selected file ending in the
project's configured UI suffix (`.ui.tsx` by default).

The source pane is read-only. Selecting a diagnostic reveals its exact range;
double-clicking a file or node validates the destination stays under the active
project root and opens VS Code at the corresponding file, line, and column. A
project-wide hash refresh marks inactive UI files changed by an external editor and
loads their newest source when selected.

Browser mode builds the same Explorer from an in-memory scaffold. It cannot expose
filesystem paths, launch VS Code, or run package-manager processes.

### Creating and switching visual sources

Creation is project-scoped. After creating or opening a project, use **New UI** for a
route page under `src/pages`, or **New Feature** for an owned UI under
`src/features/<feature>`. There is no second `src/components` feature root. Studio
validates the PascalCase name, refuses existing files, and always creates the UI with
its required Connector. The new UI becomes active immediately, so Source, UI Nodes,
diagnostics, and Inspector all show the same file. If the desktop app runtime is
running, its matching Connector becomes the center live view without restarting
Vite. When the app is stopped, the center shows only the explicit **Start App**
action.

The UI Sources list is a quick switcher over every indexed configured-UI file;
the full
Project Explorer keeps the surrounding React workspace visible. A single click on a
UI source switches the derived Studio views. Double-clicking a file or node opens its
validated source location in VS Code. General code files are intentionally created in
VS Code rather than the read-only Studio source viewer.

Opening a standalone file ending in the resolved UI suffix is a preview-only detached workflow:
there is no
project tree, sibling creation, runtime, or VS Code project link until its containing
Srijika project is opened. Browser mode mirrors creation in memory and labels that
limitation explicitly; desktop mode writes to the selected independent project folder.

## Browser derived preview versus desktop live app

Browser-mode projects and detached standalone sources require no project install.
Their restricted TSX compiles to derived IR and renders with Studio's bundled React
renderer. Connectors and arbitrary project imports are not executed in that fallback
path. The bounded `preview.styles` and
`preview.assets` entries from `srijika.config.json` are loaded directly from the
validated project root and applied inside an isolated preview document, so global
selectors such as `:root`, `body`, and `button` cannot restyle the Studio shell.
Studio polls those resources with the project index, so a saved CSS change in VS Code
appears in Design Preview without installing or restarting the Full App.

`preview.props` supplies explicit design-time values for Connector-owned inputs such
as a root `pageClassName`; these values affect only the derived preview and do not
become application logic. Older generated projects remain compatible: Studio falls
back to `src/styles.css`, `public/srijika-mark.svg`, and a CSS class-name preview value
when those explicit preview fields are absent. Stylesheets and SVG assets are
UTF-8-only, size-bounded, containment-checked, and symlinks are rejected.

For an attached desktop project, Studio does not show the derived renderer in the
center panel. It shows **Start App** until the independent application is running;
it does not present compiled UI as though the app were alive. The independent app
uses the generated `package.json`, exact versions,
`packageManager`, `pnpm-lock.yaml`, and `srijika.toolchain.json`. Full Run/Build first
checks runtime status, performs `pnpm install --frozen-lockfile` when required, then
starts the pinned Vite application or production build. Studio tracks the dev child
and its loopback readiness. `Open App` becomes available only when that tracked
server accepts connections, then opens the native-derived URL in the system browser;
the frontend never supplies an arbitrary URL. Studio also exposes an explicit stop
action. For an attached desktop project, `Browser preview` uses the same lifecycle:
it synchronizes dependencies when needed, builds and starts the managed Vite process,
waits for loopback readiness, then navigates Srijika's dedicated preview webview to that
exact tracked URL. Therefore the browser preview executes the real project CSS,
dependencies, assets, Connector logic, and Vite HMR. The derived `/preview` route is
retained only for browser-mode and detached standalone UI previews. Project creation
never waits for a network install. Once ready, that same validated loopback URL is
embedded in Studio's center preview panel. Selecting a configured-UI source sends its
validated relative path to the running app, which resolves and renders the required
sibling using the configured Connector suffix. The Connector therefore executes inside the real
project with its Providers, CSS, dependencies, Hook, Store, Logic, API, and HMR
graph. Source switching does not restart Vite. Run App, the embedded panel, Browser
Preview, and Open App never create competing renderers or project processes.

During `vite serve` only, the generated `srijika-preview-source-locations` transform
adds a relative configured-UI source location to each rendered JSX element. The embedded
app's tiny preview bridge exchanges versioned `postMessage` events only with its
parent frame. The bridge uses a development-only `import.meta.glob` registry of
Connector modules and reports `loading`, `ready`, or `error` for the selected UI.
Studio validates the managed loopback origin and message shape, resolves
the relative source through the indexed project, maps the source position through the
compiler source map, and selects the stable node. The reverse message outlines the
currently selected Studio node in the live app. A recognizable older generated
bridge is atomically upgraded before the required start-time build; custom
application-owned files are preserved. Production builds contain neither the
source-location attributes nor an active bridge.

## Diagnostics

The Studio problems console and right Inspector share compiler diagnostics. Selecting a problem reveals its exact source range. Contract fixes can create a props interface, add a missing prop, or add a missing type. The VS Code extension uses the same compiler and edit payloads, so editor and Studio rules do not drift.

## Filesystem guarantees

Desktop project creation accepts an explicit new target and never overwrites an existing path. Source operations are size-bounded, restricted to the resolved UI suffix, and atomic. Saves include the last-read hash; a mismatch returns a source conflict instead of discarding external edits.

Opening a project selects its directory, reads a regular `srijika.config.json`
capped at 64 KiB, requires `sourceOfTruth: "tsx"`, resolves the optional exact
`feature-slot-part-v1` architecture profile, validates the normalized relative
entry ends in the configured UI suffix, and opens that source. Root
`tsconfig.json` is read as bounded JSONC (1 MiB) for deterministic project alias
analysis. `extends`, nonempty `references`, and any explicit
`compilerOptions.baseUrl` are rejected; empty references are valid, and only
exact or slash-delimited terminal `/*` `paths` aliases are accepted. The
configured entry remains an authoritative strict UI and is counted even when it
sits outside the Feature/Shared roots. Configuration, entry, source, and
ancestor symlinks are rejected at the native boundary.

The browser build offers an in-memory source workspace plus resolved-UI-suffix upload/download. Native project directory and hash semantics are tested at the Rust boundary.
