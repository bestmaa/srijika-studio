# Code-first architecture

## Owner contract

Every Feature, Slot, and Part has two required public files:

```text
Owner.ui.tsx
Owner.connector.tsx
```

It may add only the capabilities it needs:

```text
useOwner.ts
owner.store.ts
owner.logic.ts
owner.api.ts
owner.types.ts
```

The flat `useOwner.ts` file is the owner's public Hook gateway. Additional
owner-private helper Hooks may live under `hooks/`.

## Strict creation matrix

Resolve the selected folder before any filesystem write. Only these actions are
valid:

```text
src/features
  -> New Feature

Feature root
  -> Feature Connector, Hook, Store, Logic, API, Types, or New Slot

Slot root
  -> Slot Connector, Hook, Store, Logic, API, Types, or New Part

Part root
  -> Part Connector, Hook, Store, Logic, API, or Types
```

Creating a new Feature, Slot, or Part is one composite request. Its normalized
PascalCase name derives the kebab-case owner folder and all file names. Always
create `Owner.ui.tsx` and `Owner.connector.tsx`; create Hook, Store, Logic, API,
and Types only when selected. Preflight every target path, never overwrite, and
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
return through the same chain as typed UI props. Types are type-only and are not
a runtime step.

Only a matching Connector renders an owner UI. Feature Connectors compose Slot
Connectors; Slot Connectors compose Part Connectors. Do not render a child UI
directly from its parent.

## Ownership

Place a capability at the narrowest owner that needs it:

```text
one Part needs it       → Part root
two Parts need it       → their Slot root
two Slots need it       → their Feature root
two Features need it    → src/shared
```

Do not import private child code upward, private sibling code sideways, or
Feature-private code across Features.

## Responsibilities

- UI: pure typed JSX, props, event callbacks, and composition slots.
- Connector: public runtime gateway and mapping to UI props.
- Hook: React lifecycle, TanStack Query, server cache, retry, effects, and mutations.
- Store: shared client state, selectors, transitions, and owner actions.
- Logic: business rules, validation, transformation, and orchestration.
- API: HTTP transport and request/response parsing.

Do not duplicate one server entity in both TanStack Query and Zustand.

## Deterministic v1 recommendations

These are non-blocking guidance. Ownership and no-jump violations remain
errors.

- `SRIJIKA-ARCH-RECOMMEND-LOGIC`: direct API work has at least two endpoint calls, business branching, validation, authorization, transformation, aggregation, or multi-step orchestration.
- `SRIJIKA-ARCH-RECOMMEND-HOOK`: behavior needs cache/retry/polling/cancellation/subscription/pagination/mutation lifecycle, at least two async handlers, or at least three React lifecycle Hooks.
- `SRIJIKA-ARCH-RECOMMEND-STORE`: state serves at least two descendants, crosses at least two ownership boundaries, or an owner Connector has at least four related local fields.
- `SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE`: a Connector consumes at least five Store selectors/actions, or Store actions own async lifecycle/cache.
- `SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER`: siblings duplicate or import one private capability.
- `SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER`: UI function exceeds 200 meaningful lines, UI file exceeds 300, or public contract exceeds 16 top-level members.

Before a code-first write, determine the owner, list the available capabilities
for the behavior, choose the first available capability in the resolution
table, and check whether the capability must be promoted to a common owner.

For filesystem creation, use the shared Studio/VS Code form or `srijika add`.
The CLI and visual forms use the same planner and no-overwrite contract; do not
recreate owner templates with ad hoc shell writes.
