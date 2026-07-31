# Component authoring

A Sutra component separates serializable metadata from its React implementation. The manifest drives palette labels, default nodes, Inspector controls, binding compatibility, slot validation, semantic diagnostics, and editor behavior.

```ts
interface ComponentManifest {
  id: string; // namespaced, for example sutra.button
  version: number;
  displayName: string;
  category: string;
  props: Record<string, PropSpec>;
  events: Record<string, EventSpec>;
  slots: Record<string, SlotSpec>;
  editor: EditorBehavior;
}
```

Registry insertion validates the namespaced ID, positive version, and JavaScript-compatible prop/event names. The registry rejects duplicate components. Each definition also supplies a `createNode` factory and a React implementation.

## Runtime and Inspector contract

Props and events are stored as `ValueExpression` objects, not raw JSX snippets. A prop can accept a literal or a symbol whose type is assignable to the manifest's `PropSpec`. Events look like familiar React props in the Inspector, but internally they are typed event ports; a string/number prop and an event callback are not interchangeable.

Slots are named in the AST. The semantic analyzer checks unknown slots, minimum/maximum child counts, and accepted component IDs before committing a document. The renderer passes each resolved slot to the implementation, so a future multi-slot component does not need to flatten all children into one array.

Core manifest-backed components are:

- Page
- Container
- Stack
- Grid
- Text
- Heading
- Button
- Input

Fragment, `If`, `Repeat`, expression, and slot nodes are JSX-compatible structural nodes managed by the document engine, not ordinary component manifests.

## Adding a component today

An in-repository core component needs:

1. a manifest and node factory in `packages/core-components`;
2. its React implementation and editor-safe styles;
3. registration in `apps/studio/src/lib/registry.ts`;
4. a TSX mapping in `packages/react-codegen`; and
5. registry, renderer, Inspector, and generated-TSX tests as appropriate.

The runtime renderer is registry-driven, but TSX generation currently contains explicit adapters for the core set and throws for an unknown component. A public third-party package loader and pluggable code-generation adapter API are deliberate post-MVP work; registering only a React implementation is not enough to make a custom component releasable.

## Styling contract

Component CSS handles the component's built-in semantics and variants. Instance base styles and `classRefs` come from the document. Studio-only selection/drop CSS stays outside component output. A centralized project token/class registry and an Inspector for breakpoint/pseudo-state styles are not implemented yet; components should not assume those future registries exist.

## Versioning

Persisted elements record both `componentId` and `componentVersion`. Changing a manifest contract requires a component migration rather than silently interpreting old props under a new version. The semantic analyzer reports version mismatches; an automated component migration runner is future work.
