# Srijika CLI

The Srijika CLI is the fast, scriptable adapter for the same Feature → Slot → Part contract used by Studio and the VS Code extension.

```bash
npx @srijika/cli create my-app
npx @srijika/cli doctor
npx @srijika/cli add feature Dashboard --hook --logic --types
npx @srijika/cli check
npx @srijika/cli dev
npx @srijika/cli dev --runtime bun
```

`create` is the complete CLI-first onboarding path. It scaffolds the pinned app,
installs dependencies, validates the architecture, installs/recommends Srijika
Language Support when VS Code is available, and opens the exact project folder.
Srijika Studio is detected independently: an installed copy receives the same
project, while a missing copy is silently skipped. Use `--no-install`,
`--no-vscode`, `--no-extension`, `--no-studio`, or `--no-open` for automation.

Every generated project includes portable validation plus VS Code Run App, Check
Architecture, and Build App tasks, so Studio is never required.

Node compatibility mode is the default. Bun turbo mode is optional and is selected only for a detected Vite project. React continues to execute in the browser in either mode.
