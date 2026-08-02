# Sutra Studio: macOS development and Codex plugin setup

This archive contains the complete Sutra Studio source needed for macOS development and the local
Sutra Studio Codex plugin. Generated Linux/Windows dependencies and build output are intentionally
excluded; install and compile them fresh on the Mac.

## What is included

- The React/TypeScript workspace and Tauri desktop application.
- The Rust workspace and pinned Rust toolchain.
- The prebuilt Sutra MCP JavaScript bundle.
- A macOS-ready plugin launcher at `plugins/sutra-studio/.mcp.json`.
- The repo-local Codex marketplace at `.agents/plugins/marketplace.json`.

The Codex plugin is distributed alongside the source, but it is not embedded in the Tauri `.app`.
Install it separately in Codex by following the steps below.

## 1. Extract and open the project

Move the extracted `sutra-studio-macos-dev-*` folder to a normal writable location, for example:

```bash
mkdir -p ~/Developer
mv ~/Downloads/sutra-studio-macos-dev-* ~/Developer/sutra-studio
cd ~/Developer/sutra-studio
```

Open this exact folder as a local project in Codex in the ChatGPT desktop app.

## 2. Install or verify macOS prerequisites

For desktop-only Tauri development, install Apple's command-line developer tools:

```bash
xcode-select --install
```

The project requires:

- macOS with Xcode Command Line Tools;
- Node.js 22.13.0 or newer;
- pnpm 11.18.0;
- Rust through `rustup` (the repo pins Rust 1.97.1).

One straightforward setup is:

```bash
brew install node
npm install --global pnpm@11.18.0
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"
```

If Homebrew is not installed, follow <https://brew.sh/>. Tauri's official prerequisite guide is
<https://v2.tauri.app/start/prerequisites/>.

Verify the tools:

```bash
xcode-select -p
node --version
pnpm --version
rustc --version
cargo --version
```

## 3. Install dependencies and verify the source

Run from the extracted project root:

```bash
pnpm install --frozen-lockfile
pnpm plugin:build
pnpm test:mcp
pnpm test:mcp:stdio
```

## 4. Start Sutra Studio in development mode

```bash
pnpm tauri dev
```

Keep that terminal and the Sutra Studio window open. The development command starts the Vite
frontend and native Tauri shell together. The first Rust build can take several minutes.

For a local macOS application bundle or DMG later, use:

```bash
pnpm tauri build
```

Public distribution needs Apple signing and notarization. Local development does not require a
Developer ID certificate.

## 5. Install the Sutra Studio plugin in Codex

The marketplace is repo-local, so add the extracted project root as a marketplace source. Replace
the example path if the folder is elsewhere:

```bash
codex plugin marketplace add "$HOME/Developer/sutra-studio"
codex plugin add sutra-studio@sutra-studio-local
```

Alternatively, after adding the marketplace, open **Plugins** in Codex, select **Sutra Studio
Local**, and install **Sutra Studio**. Plugins are supported in Codex in the ChatGPT desktop app and
Codex CLI; they are not installed through the IDE extension.

After installation:

1. Fully restart the ChatGPT desktop app, or reload plugins/MCP servers if that control is shown.
2. Start a new Codex task with this project open.
3. Keep `pnpm tauri dev` running.
4. Ask Codex: `Use $sutra-studio to inspect the active Sutra Studio page.`
5. Confirm the Studio status bar changes to `Codex connected` after the first tool call.

Official plugin packaging and installation guidance:

- <https://developers.openai.com/plugins/build/plugins>
- <https://learn.chatgpt.com/docs/plugins>

## Copy/paste prompt for Codex on the Mac

```text
Set up this Sutra Studio source archive for macOS development. Read MAC_SETUP.md completely first.
Verify Xcode Command Line Tools, Node >=22.13, pnpm 11.18, rustup, Rust and Cargo. Install only the
missing prerequisites, asking me when macOS needs a password or system confirmation. Run pnpm
install --frozen-lockfile, rebuild and test the bundled MCP plugin, and start the app with pnpm
tauri dev. Add this repository as a local Codex marketplace, install
sutra-studio@sutra-studio-local, then tell me to restart/start a new task if required. Finally use
$sutra-studio to inspect the running app and confirm the Studio status bar reports Codex connected.
Do not delete or rewrite project source files to solve environment-only setup issues.
```

## Troubleshooting

- **`xcrun` or linker error:** finish `xcode-select --install`, then reopen Terminal.
- **`pnpm: command not found`:** run `corepack enable`, or install the pinned pnpm version.
- **Plugin says Node is missing:** install Node with Homebrew. The launcher checks
  `/opt/homebrew/bin/node`, `/usr/local/bin/node`, common NVM installs, and Codex's bundled runtime.
- **No `sutra_*` tools appear:** reinstall the plugin, then start a new Codex task.
- **Tools exist but Studio is not running:** start `pnpm tauri dev` and wait for the editor window.
- **Studio is ready but not connected:** make one explicit `$sutra-studio` request so the MCP server
  contacts the local authenticated bridge.
