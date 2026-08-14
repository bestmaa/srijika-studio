# Srijika CLI

The Srijika CLI is the fast, scriptable adapter for the same Feature → Slot → Part contract used by Studio and the VS Code extension.

```bash
npx @srijika/cli doctor
npx @srijika/cli add feature Dashboard --hook --logic --types
npx @srijika/cli check
npx @srijika/cli dev
npx @srijika/cli dev --runtime bun
```

Node compatibility mode is the default. Bun turbo mode is optional and is selected only for a detected Vite project. React continues to execute in the browser in either mode.
