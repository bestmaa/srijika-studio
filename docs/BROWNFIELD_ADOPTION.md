# Staged brownfield ownership adoption

Srijika can govern an existing React or Next.js repository one owner at a time. The transition is explicit, versioned, read-only by default, and does not weaken the canonical Feature → Slot → Part model.

```json
{
  "sourceOfTruth": "tsx",
  "entry": "src/features/auth/Auth.ui.tsx",
  "architecture": { "profile": "feature-slot-part-v1" },
  "adoption": {
    "ownership": {
      "version": 1,
      "profile": "brownfield-ownership-v1",
      "managedRoots": ["src"],
      "include": ["src/features"],
      "exclude": [
        { "path": "src/features/catalog/server", "category": "server" },
        { "path": "src/features/catalog/services", "category": "service" },
        { "path": "src/features/catalog/domain", "category": "domain" },
        { "path": "src/features/catalog/tests", "category": "test" }
      ],
      "adoptedOwners": ["src/features/auth"],
      "directories": {
        "ui": ["ui"],
        "connectors": ["connectors"],
        "hooks": ["hooks"]
      }
    }
  }
}
```

`managedRoots` bounds discovery. `include` selects paths whose coverage must be reported. `adoptedOwners` enables strict architecture and UI validation for complete owner subtrees. `exclude` is only for explicit server, service, domain, and test paths that remain normal project code; it cannot overlap an adopted owner. The three directory lists recognize existing layouts without changing canonical destination names.

Every path is normalized, project-relative, at most 32 segments, and checked through the same no-symlink filesystem boundary as ordinary architecture source. Path arrays contain at most 128 entries, directory lists contain at most eight distinct single-segment names, adopted owners cannot overlap, and unknown versions or profiles fail closed.

## Coverage and planning

The resolved plan assigns every included source one status:

- `governed`: canonical source inside an adopted owner;
- `pending`: report-only source whose owner has not been adopted;
- `blocked`: an adopted source still needs a canonical move, or a move would collide/overwrite;
- `excluded`: explicitly categorized normal project code outside adopted owners.

Partial coverage never sets `fullProjectSuccess` to true. `srijika check` strictly validates adopted owners plus the authoritative entry while pending source remains runnable. A blocked adopted owner fails the check. `srijika adoption plan [project] --json` prints the immutable plan, deterministic no-overwrite moves, and exact static import rewires; it never writes source.

The CLI, incremental developer engine, workspace checks, MCP inspection/check tools, VS Code diagnostics and Structure Graph, and generated standalone validator all reload the current project contract. Workspace and MCP results distinguish strict success from full-project adoption, and the Structure Graph displays governed/pending/blocked/excluded totals.

Promote one complete owner at a time by moving/reviewing the reported files, applying the exact rewires, adding that owner to `adoptedOwners`, and running `srijika check`. Existing architecture diagnostics continue to provide deterministic Slot, Part, and Shared promotion guidance when a dependency belongs at a wider owner boundary.
