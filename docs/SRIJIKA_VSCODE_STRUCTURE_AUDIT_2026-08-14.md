# Srijika VS Code Structure Creation Audit

Date: 2026-08-14

## Delivered behavior

| Surface               | Verified behavior                                                                                           | Result |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| Activity Bar          | A dedicated Srijika container contributes the Structure view                                                | Pass   |
| Structure hierarchy   | Shows only canonical `src/features -> Feature -> Slot -> Part` owners                                       | Pass   |
| Inline Add            | Every owner row exposes the same `+` creation command                                                       | Pass   |
| Explorer context      | Exact ownership folders retain the right-click creation command                                             | Pass   |
| Visual form           | Opens in the editor area with owner-valid actions, required files, optional checks, and exact paths         | Pass   |
| Required contract     | New Feature, Slot, and Part always contain UI + Connector                                                   | Pass   |
| Optional contract     | Hook, Store, Logic, API, and Types are independently selectable                                             | Pass   |
| Existing capabilities | Created files remain visible as checked/disabled; only missing files are selectable                         | Pass   |
| Batch completion      | One or all missing owner files can be created together with a final-chain preview                           | Pass   |
| Child-owner choice    | `New Slot` and `New Part` remain separate choices while owner files are incomplete                          | Pass   |
| Focus stability       | Path preview updates in the webview DOM while typing; the extension does not rebuild the form per keystroke | Pass   |
| Strict naming         | Only normalized PascalCase owner names and derived kebab-case folders are accepted                          | Pass   |
| Write safety          | Current disk state is re-read before creation; duplicate files and overwrites are rejected                  | Pass   |
| Durable save          | Every created or rewired document is explicitly saved; generated files do not remain as zero-byte buffers   | Pass   |
| Progressive insertion | Adding Hook, Store, Logic, API, or Types safely rewires the nearest canonical senior in the same edit       | Pass   |
| Custom-code safety    | A noncanonical senior file is never silently rewritten; creation stops with reviewed-edit guidance          | Pass   |
| Refresh               | A successful scaffold refreshes the Structure tree and architecture diagnostics                             | Pass   |
| Webview security      | Script and style execution use a per-render nonce CSP; messages are validated again by the extension host   | Pass   |

Both entry points use `buildSrijikaOwnershipCreationPlan`; the sidebar does not
contain a second or weaker scaffold implementation.

## Verification

| Gate                                              | Result                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| Extension TypeScript typecheck                    | Pass                                                     |
| Extension tests                                   | 11 files, 35 tests passed                                |
| Architecture rules tests                          | 3 files, 30 tests passed                                 |
| Extension ESLint                                  | Pass with zero warnings                                  |
| Extension production bundle                       | Pass                                                     |
| Prettier and `git diff --check`                   | Pass                                                     |
| Windows extension registration                    | `srijika.srijika-language-support@0.1.0` found           |
| WSL extension registration                        | `srijika.srijika-language-support@0.1.0` found           |
| Installed bundle, manifest, and Activity Bar icon | Verified in Windows, WSL, and WSL-server extension roots |

## Real VS Code UI audit

A disposable WSL project was exercised through the actual VS Code window, not
only through unit tests:

1. The Activity Bar `+` created Feature `AuditDashboard` with UI, Connector,
   Hook, Store, Logic, API, and Types.
2. The Feature `+` created Slot `Navigation` with UI, Connector, Hook, and
   Logic.
3. Explorer right-click on the Slot created Part `UserMenu` with UI,
   Connector, Store, and Types.
4. A duplicate Part request was rejected and SHA-256 checks confirmed that all
   existing Part files were unchanged.
5. The Part `+` added the recommended Hook. Its preview listed the new Hook and
   `[safe rewire] UserMenu.connector.tsx`; creation saved both files and changed
   the Connector from Store to Hook.
6. Reopening Part Add marked Hook, Store, and Types as `Created` and enabled
   only the remaining Logic and API checkboxes.
7. The real `srijika-app` Home form showed UI, Connector, and Types as Created;
   Hook, Store, Logic, and API as selectable missing files; and `New Slot` as a
   separate choice. Select-all produced four new paths plus one safe Connector
   rewire without writing the preview.
8. The real Slot `New` form showed API and Types as missing while keeping
   `New Part` visible. Selecting New Part opened its independent name and
   optional-file controls.

The final generated tree contained 16 TypeScript files, all 16 were non-empty,
the browser-safe architecture validator returned zero diagnostics and zero
recommendations, and the extension-host log contained the Srijika activation
entry with no Srijika error.

## Bugs found and fixed during the UI audit

- VS Code accepted the initial WorkspaceEdit but left created files dirty and
  zero bytes on disk. The writer now explicitly saves every generated document
  and reports the exact file if persistence fails.
- Adding a senior capability later used to leave the next senior file importing
  the old junior layer. Standalone capability creation now plans the new file
  and its canonical senior rewire together, previews both operations, and
  refuses unsafe rewrites when custom code is present.
- A custom Connector caused every missing Feature capability to be silently
  hidden. Availability now reflects the filesystem, and multi-file completion
  can preserve a custom Connector while inserting its Hook boundary.

## User-visible flow

1. Reload VS Code once after the local extension update.
2. Open the Srijika icon in the Activity Bar.
3. Expand **Structure**.
4. Select the inline `+` beside Features, a Feature, a Slot, or a Part.
5. For the selected owner, tick one missing file or **Select all missing
   files**. Created files remain visible and protected.
6. To create a child, choose **New Slot** or **New Part**, enter its PascalCase
   name, and tick any optional files.
7. Review the exact paths in the editor form and create the validated files.

The normal Explorer right-click flow opens the same visual form and runs the
same final validation and writer.
