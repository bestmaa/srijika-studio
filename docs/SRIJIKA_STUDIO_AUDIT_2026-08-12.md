# Srijika Studio native-first product audit — 2026-08-12

## Executive result

Srijika Studio was audited as a real Tauri desktop application first, using native Windows mouse and keyboard input against the running Linux/WSL window. Browser parity was checked only after the desktop workflow. The audit created a real project, wrote and reopened files, scaffolded every ownership capability, edited static and dynamic props and an event, ran and built the generated application, exercised settings and preview controls, and then repeated the supported browser-only flows.

Seven product defects were fixed during this audit. The final automated verification is green: 71 Vitest files / 406 tests, 37 Rust `studio-core` tests, workspace TypeScript, the production workspace build, and focused zero-warning ESLint for every audit-changed TypeScript file.

Legend: ✅ verified; ⚠️ verified with a documented limitation; ➖ intentionally unavailable in that environment.

## Native desktop checkmark matrix

| Workflow                       | Native evidence                                                                                                                                       | Result                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Launch and workspace recovery  | Tauri window launched after WSL restart; old port collision was cleared by stopping the stale process                                                 | ✅                                                                       |
| New Project                    | Created `/home/beste/project/SRIJIKA-NATIVE-AUDIT` with the native GTK folder chooser; 24 initial files were generated                                | ✅                                                                       |
| Save visual edits              | Added a section, set `aria-label`, saved, and confirmed the exact TSX on disk                                                                         | ✅                                                                       |
| Reopen project                 | Opened the same folder again from the native chooser; saved TSX and source list persisted                                                             | ✅                                                                       |
| Open standalone UI file        | Opened `AuditCard.ui.tsx` with the native file chooser; derived preview and Inspector loaded with zero issues                                         | ✅                                                                       |
| UI source switching            | Switched among page, feature, slot, part, and component sources; Source, UI Nodes, preview, Inspector, and OPEN marker stayed synchronized            | ✅                                                                       |
| Rapid source switching         | Repeated fast selections; the final selected source won instead of an older async reload                                                              | ✅ after fix                                                             |
| Create Feature                 | Created `AuditDashboard` with connector, store, and first behavior hook                                                                               | ✅                                                                       |
| Create Slot                    | Created `AuditNavigation` plus connector, store, and behavior hook                                                                                    | ✅                                                                       |
| Create Part                    | Created `AuditNavigationMenu` plus connector, store, and behavior hook                                                                                | ✅                                                                       |
| Canonical page / feature roots | Legacy loose component creation was retired; pages use `src/pages`, features use `src/features/<feature>`, and both require a Connector               | ✅ superseded and verified                                               |
| Create Store / Hook            | Generated in the correct owner scope and appeared immediately in the project tree                                                                     | ✅                                                                       |
| Creation-dialog typing         | Feature and behavior names retained focus through runtime refreshes; all-option dialog footer remained accessible                                     | ✅ after fixes                                                           |
| Palette insertion by click     | Inserted a semantic section into the selected `<main>`; TSX, node tree, preview, and diagnostics updated                                              | ✅                                                                       |
| Palette insertion by drag/drop | HTML5 data-transfer path and hierarchy drop rules pass integration tests; raw Windows pointer automation did not reliably emit the browser drag event | ⚠️ logic verified; physical gesture needs one human desktop confirmation |
| UI Nodes / layer selection     | Selecting created nodes updated Inspector and source context; panels collapse and restore correctly                                                   | ✅                                                                       |
| Static prop                    | Authored `id={"audit-card-native"}` on the selected section                                                                                           | ✅                                                                       |
| Dynamic props                  | Authored typed `label` and `supportingText` public props and saw them in the contract                                                                 | ✅                                                                       |
| Event                          | Connected `onClick={props.onActivate}` and preserved a connector-safe optional callback signature                                                     | ✅ after fix                                                             |
| Connector boundary             | Feature, slot, part, and component connector files were generated at their canonical owner paths                                                      | ✅                                                                       |
| Zustand store                  | Feature/slot/part stores were generated and project dependencies synchronized                                                                         | ✅                                                                       |
| Behavior hook                  | Feature/slot/part hooks were generated under owner-local `hooks/` folders                                                                             | ✅                                                                       |
| Source hide/show               | Hid the source viewer and restored it without losing selected UI or edits                                                                             | ✅                                                                       |
| Settings                       | Entered accent `#5B8CFF`; focus remained stable, value applied live, and survived closing/reopening Settings                                          | ✅                                                                       |
| Fullscreen selected-UI preview | Selected `AuditCard`, opened responsive fullscreen, switched exact/responsive sizing, and exited successfully                                         | ✅ after fix                                                             |
| Install / Sync                 | Dependency readiness completed and reported `Ready to run`                                                                                            | ✅                                                                       |
| Run App                        | Managed Vite app started on an assigned loopback port and rendered in Embedded Preview                                                                | ✅                                                                       |
| Open App                       | Opened the running generated application in the system browser                                                                                        | ✅                                                                       |
| Stop App                       | Managed development process stopped from Studio                                                                                                       | ✅                                                                       |
| Build App                      | Generated project production build completed and emitted `dist/index.html` plus assets                                                                | ✅                                                                       |
| Diagnostics                    | Final audit project showed zero Srijika architecture problems after invalid audit artifacts were removed                                              | ✅                                                                       |

## Real project artifacts

The audit project deliberately exercised owner boundaries instead of placing every file in one folder.

```text
src/
├── components/
│   ├── AuditCard.ui.tsx
│   └── AuditCard.connector.tsx
├── features/audit-dashboard/
│   ├── AuditDashboard.ui.tsx
│   ├── AuditDashboard.connector.tsx
│   ├── auditDashboard.store.ts
│   └── hooks/useAuditDashboardData.ts
└── slots/audit-navigation/
    ├── AuditNavigation.ui.tsx
    ├── AuditNavigation.connector.tsx
    ├── auditNavigation.store.ts
    ├── hooks/useAuditNavigationBehavior.ts
    └── parts/audit-navigation-menu/
        ├── AuditNavigationMenu.ui.tsx
        ├── AuditNavigationMenu.connector.tsx
        ├── auditNavigationMenu.store.ts
        └── hooks/useAuditNavigationMenuBehavior.ts
```

### What static, dynamic, event, and connector mean in the verified output

- A static prop is written directly on one node, for example `id={"audit-card-native"}`. It belongs to that exact rendered instance.
- A dynamic prop is declared in the UI contract, for example `label: string`, and referenced as `props.label`. A caller or connector supplies its runtime value.
- An event is behavior, not display data. The audited element uses `onClick={props.onActivate}` and the authored callback is optional so a just-created connector remains compilable until it supplies the handler.
- A connector is the owner-level integration boundary. It imports the pure `.ui.tsx` contract, reads store/hook/router/service state where needed, and passes values and callbacks into the UI.
- A store holds shared owner state. A behavior hook owns reusable local or data-fetching behavior. Both remain inside the feature/slot/part that owns them.

## Defects found and fixed

### 1. UI source selection race

- Symptom: `D.ui.tsx` could be highlighted while the source viewer still showed `Home.ui.tsx`.
- Cause: a background project refresh could supersede a newer explicit user selection.
- Fix: an explicit selected-path load now wins over stale background work; same-source recompiles preserve a still-valid selected node.
- Regression: rapid selection and delayed background-refresh cases are covered.

### 2. Structure and Settings-style inputs lost focus

- Symptom: text appeared to disappear or typing stopped after a few characters.
- Cause: polling changed an inline parent callback identity, rerunning the dialog focus effect and moving focus to the close button.
- Fix: the latest callback is held in a ref while focus/Escape setup runs only for the dialog lifetime.
- Regression: changing-parent-callback rerenders while typing feature and behavior names.

### 3. Structure dialog actions could be clipped

- Symptom: selecting all optional files made the create action difficult or impossible to reach at the bottom.
- Fix: the dialog action footer is sticky and remains visible while the body scrolls.
- Regression: CSS contract checks the scroll/body/footer layout.

### 4. Invalid component creation at a feature root

- Symptom: Project Explorer offered a generic Component action directly under `src/features`, then architecture validation correctly rejected the created file with `SRIJIKA4108`.
- Cause: frontend creation choices and backend ownership rules disagreed.
- Fix: feature/slot/part owner folders expose only their valid capabilities; generic `src` folders retain UI/Component actions. Rust also rejects generic UI creation directly under `src/features`.
- Regression: contextual Project Explorer tests plus real-filesystem Rust validation.

### 5. Inspector-authored event broke a fresh connector

- Symptom: adding `onActivate` made the callback required, while the already-created connector did not yet pass it, causing the generated project compile to fail.
- Fix: newly authored Inspector callbacks are emitted as optional typed callbacks, formatted as `onActivate?: () => void;`.
- Regression: compiler and Studio integration assertions cover signature and binding.

### 6. Fullscreen preview was blank for code-first sources

- Symptom: a selected `.ui.tsx` source opened a white fullscreen screen.
- Causes: fullscreen read the unrelated design-store document, and dynamic symbols from the selected compiled source had no preview values.
- Fix: fullscreen accepts the current code-first document and computed symbol values; the control is disabled when no valid document exists.
- Regression: selected-source fullscreen rendering, responsive/exact switching, and Escape exit.

### 7. Browser import invited the wrong kind of selection

- Symptom: users tried to open a project folder in browser mode and received an operating-system/browser file-not-found style message such as “shared query file not found”.
- Cause: a browser cannot attach the desktop project folder, while labels and the broad `.tsx` file filter implied that it could import more than one authoritative UI file.
- Fix: browser copy now says `Import One .ui.tsx File`, explains that folders require the desktop app, and the chooser accepts only `.ui.tsx`.
- Regression: browser welcome and in-memory project tests verify the exact capability boundary.

## Browser parity result

The browser build at `http://127.0.0.1:5173/` was tested after the native application.

| Browser workflow                        | Result                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Import one real `AuditCard.ui.tsx` file | ✅ source, hierarchy, preview, Inspector, zero issues                                       |
| Create Demo Project                     | ✅ complete in-memory explorer with two UI sources                                          |
| Switch Home/Navigation sources          | ✅ selected source, code, Inspector, and OPEN marker synchronized                           |
| Browser console                         | ✅ zero errors during the audited flow                                                      |
| Attach/open a real project folder       | ➖ browser security model does not support it; desktop-only action is now stated explicitly |

The reported “shared query file not found” phrase does not exist in the Srijika source tree. It is consistent with the host file chooser being asked for an unavailable or folder-like target. The product now prevents the misleading broad import path and states the supported single-file contract before the chooser opens.

## Automated verification

- `pnpm test`: ✅ 71 files, 406 tests.
- `cargo test -p studio-core`: ✅ 37 tests.
- `pnpm typecheck`: ✅ all 14 participating workspace projects.
- `pnpm build`: ✅ portal, extension, MCP server, and Studio production builds.
- Focused ESLint over every audit-changed TypeScript/test file: ✅ zero warnings/errors.
- Full repository `pnpm lint`: ⚠️ still fails on 43 pre-existing generated Astro `.astro/*` and portal `sync-docs.mjs` findings. The single audit-introduced unused import was fixed.
- Generated audit application: ✅ dependency sync, live run, browser open, stop, and production `dist` build.

## Known follow-ups and honest limits

1. One physical native drag/drop should be manually confirmed with a human-held mouse. Native click insertion and the exact HTML5 `dataTransfer` drop path are green; raw system-pointer automation did not reliably generate a webview drag event, so this row is not falsely marked fully verified.
2. A newly created folder did not immediately appear in GTK Recent during the same session. Manual folder navigation worked and reopen/persistence passed, but Recent-folder refresh is a small native chooser UX follow-up.
3. The full-app preview intentionally renders the project entry application. Isolated selected-source rendering belongs to Derived Preview and Fullscreen Preview; both now work.
4. The production Studio bundle is correct but the main minified JavaScript chunk remains about 4.25 MB. Code splitting is a performance follow-up.
5. After WSL restart, the already-open Codex task retained a stale authenticated local MCP descriptor even though the native Studio bridge restarted. A new task reloads the descriptor; credentials should never be copied manually between runs.

## Reusable release audit checklist

Run this list for every release and append the date/result below it.

- [ ] Cold launch; detect and explain stale Vite/WSL process failures.
- [ ] New Project with a unique folder; verify initial file tree.
- [ ] Save a visual edit; compare exact disk TSX; close and reopen.
- [ ] Import one standalone `.ui.tsx`; verify preview, tree, Inspector, diagnostics.
- [ ] Create Feature with connector/store/hook.
- [ ] Create Slot and nested Part with connector/store/hook.
- [ ] Create valid shared Component; confirm invalid ownership actions are unavailable.
- [ ] Type slowly and rapidly in every modal field; hold focus through at least one runtime refresh.
- [ ] Switch every UI source slowly and rapidly; confirm source/tree/preview/Inspector identity.
- [ ] Insert each palette category by click and at least one item by physical drag/drop.
- [ ] Select nested layers; add/edit/remove a static prop.
- [ ] Add a dynamic public prop, default, and node binding.
- [ ] Add an event, connect it, and compile the existing connector.
- [ ] Hide/show/minimize every panel.
- [ ] Change Settings, close/reopen, and restart to verify persistence.
- [ ] Check Derived, Fullscreen responsive/exact, Embedded, and system-browser previews.
- [ ] Install/Sync, Run, Open, Stop, Build; inspect user-visible errors at every failure boundary.
- [ ] Browser: import exactly one `.ui.tsx`, create demo, switch sources, check console.
- [ ] Run TypeScript, Rust, unit/integration/contract, lint, and production-build gates.

### Audit history

- 2026-08-12: native-first audit completed; seven defects fixed; all correctness gates green; physical pointer drag/drop and repository-wide generated-file lint remain documented follow-ups.
