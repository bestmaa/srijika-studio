# Development setup

## Toolchain

The checked-in workspace currently uses:

- Node.js 22.22.1 in the WSL development environment; `package.json` requires Node.js 22.13 or newer;
- pnpm 11.18.0, pinned by `packageManager`;
- TypeScript 6.0.3;
- React 19.2.8 and Vite 8.2.0; and
- Rust 1.97.1, pinned by `rust-toolchain.toml`.

Install the JavaScript workspace from WSL:

```bash
cd /home/beste/project/sutra-studio
pnpm install --frozen-lockfile
```

The MVP does not bundle a Node sidecar or download alternate Node versions. A future toolchain manager may do that for generated-project compilation; the current editor uses the Node/pnpm installation in the development environment.

## Exact Ubuntu/WSL native prerequisites

Tauri 2 on Linux needs WebKitGTK and native development libraries. The dialog plugin additionally reaches D-Bus through `libdbus-sys`. On this Ubuntu/WSL environment, install:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  file \
  libayatana-appindicator3-dev \
  libdbus-1-dev \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  patchelf \
  pkg-config \
  wget
```

Without `pkg-config` and `libdbus-1-dev`, `cargo check -p sutra-studio --locked` stops in the `libdbus-sys` build script. The other packages cover the Tauri/WebKitGTK Linux shell and bundling prerequisites.

## Browser editor and preview

```bash
pnpm dev
```

Vite binds to `0.0.0.0` on strict port 5173. Open:

- `http://localhost:5173/` for the editor; and
- `http://localhost:5173/preview` for the clean renderer preview.

The preview hydrates from same-origin localStorage and receives live updates through `BroadcastChannel`. Keep the editor and preview on the same origin. This development server is the current port-based browser preview; a packaged desktop loopback server is not implemented.

## Tauri desktop shell

After installing the native packages, WSLg can run the Linux desktop target:

```bash
pnpm tauri dev
```

The Tauri window loads the same React editor. Native Open/Save uses the system dialog plugin and narrow Rust commands; browser mode falls back to upload/download. Saved document paths must be absolute and end in `.json`.

To check or build the entire Rust workspace after native setup:

```bash
cargo check --workspace --all-targets --all-features --locked
cargo test --workspace --all-features --locked
pnpm tauri build
```

## Cross-platform releases

WSL produces a Linux application, not a Windows executable. Windows and macOS artifacts must be built and signed on native runners. Use an older supported Linux/glibc baseline in release CI instead of publishing binaries built directly on Ubuntu 26.04.

A release Tauri application embeds the Vite-built editor assets, so Node is not required merely to launch and use that built editor. Node will become relevant inside Studio only when generated-project dependency installation and TSX compilation are added.
