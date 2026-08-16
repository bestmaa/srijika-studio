# create-srijika

Create a complete CLI-first Srijika React project:

```bash
npm create srijika@latest
# Project name: my-app
```

Or provide the project name directly:

```bash
npm create srijika@latest my-app
```

To convert an existing React Vite/CRA project into a separate, resumable Srijika
target while leaving the source untouched:

```bash
npm create srijika@latest my-srijika-app -- --from /absolute/path/to/old-react-app
```

This creates the new target, captures a bounded source inventory and immutable
baseline, and writes the reviewed migration session under
`.srijika/migrations/react/`. Codex/MCP then migrates and verifies the planned
slices; the command never rewrites the source project in place.

The command scaffolds the project, installs its frozen dependency graph, validates
the Feature → Slot → Part architecture, recommends/installs the VS Code extension,
opens the exact folder, and optionally hands the same project to Srijika Studio.

The default starter is minimal: it renders React directly and does not install a
server-state library. Opt in to TanStack React Query when the application needs
request caching, retries, or background refetching:

```bash
npm create srijika@latest my-app -- --react-query
```

That option adds `@tanstack/react-query`, `src/app/AppProviders.tsx`, and
`src/app/query-client.ts`. You can otherwise add your preferred data library later.

Use `--no-open` for CI or a terminal-only setup:

```bash
npm create srijika@latest my-app -- --no-open
```
