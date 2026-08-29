# Next.js framework adapter

Srijika compiles supported Next.js UI primitives through the versioned
`srijika.next-app-router` adapter. The compiler reads TypeScript syntax and
produces safe core-component preview nodes; it never imports or executes
`next/link`, `next/image`, or a project component module.

## Built-in primitives

Version 1 recognizes only exact default imports from `next/link` and
`next/image`.

- `Link` requires a statically provable string `href` and children. Its preview
  is an anchor and may forward `target`, `rel`, `className`, `style`, and
  `aria-label`. Next navigation options are validated but not executed.
- `Image` requires static `src` and `alt` values plus either numeric `width` and
  `height` or `fill`. Its preview is a normal image. Optimization, priority, and
  loader behavior are never executed by Studio.

Aliased imports remain valid because resolution uses the exact module specifier
and export name. Namespace imports, `require`, dynamic `import()`, unregistered
modules, spreads, and values that cannot be proved by the restricted compiler
fail closed.

## Explicit project components

Pure shared presentation components can be registered in
`srijika.config.json`. Registration is source-only: it declares the prop
contract and safe preview projection, not an implementation loader.

```json
{
  "sourceOfTruth": "tsx",
  "entry": "src/features/home/Home.ui.tsx",
  "framework": {
    "version": 1,
    "profile": "next-app-router-v1",
    "components": [
      {
        "id": "project.shared.card",
        "version": 1,
        "moduleSpecifier": "@/shared/Card",
        "exportName": "Card",
        "displayName": "Shared Card",
        "props": {
          "title": {
            "type": "string",
            "required": true,
            "previewProp": "ariaLabel"
          }
        },
        "children": "optional",
        "preview": { "kind": "container", "element": "section" }
      }
    ]
  }
}
```

Component IDs must be namespaced and unique. Imports must be exact project-local
`./...` or `@/...` specifiers without traversal. Exports and props must be
unambiguous identifiers. A config may register at most 128 components and each
component at most 64 props. Supported prop types are `string`, `number`,
`boolean`, `array`, `object`, and `unknown`; previews are bounded to `container`,
`image`, or `text`. `previewProp` is also allowlisted for the chosen preview kind;
event handlers, `dangerouslySetInnerHTML`, and arbitrary DOM attributes are
rejected.

## Server and client boundaries

App Router files are server components unless their directive prologue contains
`"use client"`. Server pages and layouts receive targeted errors for React
client hooks, browser globals, JSX event handlers, and non-serializable props
passed to a resolved Srijika UI component. Route handlers are analyzed as
server-owned code, not compiled as UI documents.

The shared analyzer powers CLI project checks, MCP inspection, VS Code
diagnostics, and Studio compilation. The compiler returns adapter ID/version,
boundary, directives, exact import span, and derived node IDs so diagnostics and
source selection remain stable across surfaces.

## Stable diagnostics

- `SRIJIKA5001`: unsupported or unregistered framework primitive/import.
- `SRIJIKA5002`: dynamic or otherwise unprovable component usage.
- `SRIJIKA5003`: invalid framework primitive props or children.
- `SRIJIKA5004`: server component uses client-only behavior.
- `SRIJIKA5005`: a server-to-client UI boundary receives an unknown or
  non-serializable prop.

Fix the source or add an explicit safe project manifest; do not suppress these
diagnostics by loading arbitrary runtime modules into preview.
