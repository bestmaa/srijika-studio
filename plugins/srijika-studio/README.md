# Srijika Studio Codex plugin

This package connects Codex to the canonical document engine in a running Srijika Studio desktop process. The bundled MCP server reads compact project state and applies revision-checked UI operations through an authenticated loopback bridge. It can also analyze duplicate siblings, normalize them into typed React Repeat/map structures, inspect compact generated-TSX evidence, write responsive breakpoint overrides, and verify geometry across viewports.

For code-first filesystem work, the plugin also publishes the strict Feature → Slot → Part creation contract. Codex resolves an exact owner boundary before writing, always creates UI + Connector for a new owner, adds only selected Hook/Store/Logic/API/Types files, preflights every canonical path, and never invents alternate folders or overwrites existing files.

## Use

1. Start Srijika Studio with `pnpm tauri dev` (or a packaged desktop build).
2. Add this repository as a local Codex marketplace:

   ```bash
   codex plugin marketplace add /path/to/srijika-studio
   codex plugin add srijika-studio@srijika-studio-local
   ```

3. Start a new Codex task or reload plugins, then ask Codex to use `$srijika-studio`.
4. Confirm the Studio status bar reports `Codex connected` after the first tool call.

The Windows launcher supports a native Windows Studio process and a Studio process started inside WSL. WSL defaults are distribution `Ubuntu` and the Windows username. Override unusual installations with `SRIJIKA_STUDIO_WSL_DISTRO`, `SRIJIKA_STUDIO_WSL_USER`, or `SRIJIKA_STUDIO_WSL_DATA_HOME`.

## Develop and verify

```bash
pnpm plugin:build
pnpm test:mcp
pnpm test:mcp:stdio
pnpm test:mcp:windows
pnpm test:mcp:tauri
```

Run the plugin and skill validators before installation. After changing an already installed local plugin, use the plugin-creator cachebuster script and reinstall it so Codex does not retain an older cached copy.

## Security

Studio listens only on an ephemeral loopback port and creates a fresh bearer token for each process. The token stays in the user-private bridge descriptor and is never returned by MCP tools, health responses, logs, or UI status.

The canonical protocol, tools, recovery rules, and migration policy are documented under `skills/srijika-studio/references`.
