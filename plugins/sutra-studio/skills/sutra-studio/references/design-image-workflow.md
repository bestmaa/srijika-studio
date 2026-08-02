# Design image workflow

## Contents

- Inspect
- Decompose
- Plan
- Apply
- Normalize repeated structure
- Add responsive behavior
- Verify

## Inspect

Read the supplied image at original detail when available. Record its exact pixel width and height, aspect ratio, major colors, typography hierarchy, repeated units, fixed/sticky regions, and responsive clues. Source dimensions are a hard rendering target, not informational metadata. Do not infer invisible interactions without labeling the assumption.

Before writing, create a visible-region inventory with stable names and expected counts. Include every header, sidebar, section, card group, table/list row, chart, footer, overlay, and asset visible in the source. A page is incomplete while any required region is absent or unverified.

## Decompose

Build a layout tree from outside inward:

1. Page shell and global background
2. Header, sidebar, main, and footer regions
3. Flex/grid containers and spacing rules
4. Repeated cards, rows, or navigation items
5. Text, media, controls, and event ports

Query `sutra_get_component_catalog` in summary mode, then request `detail: "manifest"` only for the component IDs selected for the plan. Use literal children while matching fixed screenshot content. Introduce `repeat` for genuinely dynamic data after geometry parity, or earlier only when edit and preview geometry remain equivalent.

Never accept emoji or Unicode approximations as final icons when a deterministic Icon, SVG, image, or shape component is available.
For dashboards, prefer the manifest-backed `sutra.icon`, `sutra.chart`, `sutra.progress`, `sutra.badge`, `sutra.avatar`, and `sutra.divider` primitives. Request their detailed manifests instead of guessing prop names.
For `sutra.input`, style the actual control through `controlStyle`, the visible label through `labelStyle`, and use `hideLabel` for search bars while retaining an accessible label. Do not expect the outer node style to target the nested native input.

## Plan

Call `sutra_get_project_summary` and capture the revision. Create a compact plan containing:

- Source name and viewport dimensions
- A stable `planId` and current phase (`geometry`, `content`, `styling`, `correction`, or `final`)
- Required region inventory and expected instance counts
- Region node IDs and explicit acceptance flags for exact viewport, visibility, and horizontal overflow
- Layout assumptions
- Ordered operations with stable `operationId` values
- Public props, event ports, and responsive changes encoded as ordered operations
- Known visual limitations recorded in `assumptions`

Use `sutra_import_design_plan`; its source width and height set the custom Studio viewport. Codex performs image understanding; the local bridge receives structured JSON only. This keeps the bridge offline and avoids a second vision model or API key. `requiredRegions` and `acceptance` are caller-tracked metadata echoed in the result; Codex must enforce them with validation, layout, and capture reads.

The top-level payload is limited to this shape; put props, events, components, and breakpoint styles inside `operations`:

```json
{
  "pageId": "page_home",
  "expectedRevision": 7,
  "planId": "dashboard-pass-1",
  "phase": "geometry",
  "source": { "name": "dashboard.png", "width": 1440, "height": 1000 },
  "requiredRegions": [
    { "id": "shell", "label": "Application shell", "expectedInstances": 1, "nodeIds": [] }
  ],
  "acceptance": {
    "exactViewport": true,
    "noHorizontalOverflow": true,
    "allRegionsVisible": true
  },
  "assumptions": ["Mobile navigation collapses below 640px."],
  "operations": [
    {
      "kind": "insertComponent",
      "operationId": "shell",
      "parentId": "root",
      "componentId": "sutra.container",
      "name": "Application shell"
    }
  ]
}
```

## Apply

Prefer dependency-safe passes with stable explicit IDs:

1. Exact viewport, page shell, and major geometry
2. Nested content, assets, and fixed repeated units
3. Typography, colors, borders, effects, props, and events
4. Visual corrections based on measured evidence

Each phase must be atomic and revision-checked. Stop if validation fails; do not stack more operations onto an invalid document.

## Normalize repeated structure

Do this after the exact source viewport is visually stable. Call `sutra_analyze_repetitions` for deterministic repeated-sibling candidates instead of guessing from names. Review the reported parent, ordered sibling IDs, confidence, template kind/depth, and differing literal field locators/shapes. Convert only a high-confidence candidate with the `convertRepeatedSiblings` operation in one revision-checked write.

The result must contain one Repeat node, one retained template subtree, a typed array public prop, and the current rows as its default/design value. Validate instance count, order, source-viewport bounds, and events; then call `sutra_get_generated_code` in `summary` mode to verify the typed default metadata and generated `.map(...)` signature. Request full TSX only when the compact evidence is insufficient. Leave intentional one-off cards literal.

## Add responsive behavior

Keep the exact source-frame styles in `style.base`. Add only breakpoint overrides to existing stable nodes:

1. Collapse fixed shell columns or hide nonessential sidebars on mobile.
2. Change multi-column grids to two columns on tablet and one column on mobile.
3. Stack dense horizontal rows, enable wrapping where appropriate, and set `minWidth: 0` on shrinkable children.
4. Reduce edge padding and gaps without changing typography hierarchy.
5. Preserve intentional local scrollers, but reject document-level horizontal overflow.

Render and inspect at 390px mobile, 768px tablet, the exact source width, and at least 1440px wide. Breakpoint styles must override fixed grid-track component props when both are present.

## Verify

Run validation and diagnostics, render at the exact source dimensions, inspect layout, then capture a clean PNG. Never compare the Studio shell, dotted workspace, selection outline, Repeat/If label, or any other edit overlay to the source.

Use this correction loop until the declared acceptance checks pass. Stop only after two consecutive captures show no measurable improvement or after six passes, then report the remaining blockers precisely:

1. `sutra_validate_document` and `sutra_get_diagnostics`
2. `sutra_render_preview` with exact `width` and `height`
3. `sutra_get_layout_snapshot` for all required regions; fix clipping, overflow, missing instances, and wrong bounds
4. `sutra_capture_preview`; visually compare the returned image with the source
5. Patch the largest structural mismatch, then repeat
6. After exact parity, repeat steps 1–5 for mobile, tablet, and wide viewports. For layout results, confirm `viewport.scrollWidth <= viewport.actual.width + 1`; local scrolling regions may intentionally have a larger per-instance scroll width.

Compare in this order:

1. Overall geometry and overflow
2. Alignment, gaps, and container sizes
3. Typography and wrapping
4. Colors, borders, radius, and shadows
5. Repeated content and conditional branches
6. Event and prop bindings

Fix structural causes before pixel polish. A successful document validation is not visual verification. Do not report a close match unless capture succeeded and every required region is visible. Re-check desktop, tablet, and mobile only when the user expects responsive output.
