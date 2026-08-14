# Command and history system

> This document describes the retained `UiDocument` command engine used by legacy component tests, migrations, and derived-IR tooling. The active code-first Studio does not use these commands for authoring. It edits `.ui.tsx`, recompiles, and replaces the derived read model only after successful validation.

Every legacy IR change is represented by a serializable `DocumentCommand` and dispatched through a versioned envelope:

```ts
interface CommandEnvelope {
  commandVersion: 1;
  commandId: string;
  documentId: string;
  baseRevision: number;
  origin: 'user' | 'ai' | 'migration';
  command: DocumentCommand;
}
```

The document ID must match the active document and `baseRevision` must equal its current revision. These checks make stale UI, future migration, and future AI callers obey the same concurrency boundary.

## Implemented commands

- insert one node;
- atomically insert a repeat node with its item/index symbols;
- move a node;
- remove a subtree;
- set or clear a prop, event, or base-style property;
- rename a node;
- set element visibility, an `If` condition, or a `Repeat` source;
- replace class references;
- add or remove a public prop and its canonical symbol; and
- replace a complete document, used by import and history snapshots.

Subtree removal also removes scope symbols owned by deleted repeaters. Removing a referenced public prop, moving the root, introducing duplicate IDs, or moving a node into its descendant is rejected.

## Transaction path

```text
check envelope preconditions
  → clone current document
  → apply one semantic mutation
  → advance revision for content-edit commands
  → validate graph
  → validate component/document semantics
  → commit document and history entry
  → publish projections
```

Failure at any validation stage leaves the active document unchanged. Whole-document replacement retains the imported/snapshot revision instead of incrementing it. `insertRepeat` is intentionally one command because inserting the structural node and its two scoped symbols as separate edits would create invalid intermediate states.

## Undo and redo

The current history implementation stores complete before/after snapshots for a safe MVP inverse. It retains at most 250 entries. Repeated edits to the same prop, event, style field, node name, or class list coalesce for 650 ms so typing does not create one undo step per keystroke. A new command clears redo history.

Undo/redo is editor session history; it is not persisted into the UI document. Imported/reset documents create a new history instance.

## Persisted versus transient changes

Selection, hover, panel sizes, viewport preset, drop target, and `activeIfBranches` do not use document commands because they must not alter generated application behavior. Choosing the false authoring branch changes only session state; adding a child to that branch is a normal persisted command.

Code-first project save atomically writes the active `.ui.tsx` with an expected disk hash. The preview's localStorage snapshot is a browser synchronization cache, not an autosave replacement for source.

## Future callers

The `origin` field remains useful for migrations. New AI and visual-authoring callers must produce reviewable TSX source edits rather than dispatching IR commands; compilation and semantic validation remain the acceptance boundary.
