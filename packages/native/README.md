# Srijika Native

`@srijika/native` is an independent React Native + Expo toolchain. Its compiler,
read model, scaffold, standalone validator and `srijika-native` CLI live in this
package. The existing React/Vite and Next.js compilers, renderer, runtimes,
scaffolds and desktop preview are unchanged.

Only the framework-neutral `@srijika/architecture-rules` package is shared.
Expo and React Native are installed in generated mobile applications, not in the
Studio workspace. A generated `pnpm-workspace.yaml` creates a separate dependency
boundary even when the application is created inside another workspace.

## Create and run

From the repository:

```bash
pnpm native:build
pnpm srijika-native create /absolute/path/my-mobile --name my-mobile --display-name "My Mobile"
cd /absolute/path/my-mobile
pnpm install --frozen-lockfile
pnpm verify
pnpm start
```

Install Expo Go on a physical Android phone and scan the terminal QR code. For LAN
preview, the computer and phone must be on the same reachable Wi-Fi network.
For WSL, firewalls or blocked LAN access:

```bash
pnpm start:tunnel
```

The scaffold includes the pinned tunnel dependency. Expo CLI owns QR codes,
Metro and Fast Refresh. Both launch commands explicitly use `--go`; they never
request an emulator, web preview, prebuild or local native compilation. Android
Studio, Android SDK, JDK and Gradle are unnecessary for this workflow.

The independent repository CLI also supports:

```bash
pnpm srijika-native check /absolute/path/my-mobile --json
pnpm srijika-native compile /absolute/path/my-mobile/src/features/home/Home.ui.tsx --json
pnpm srijika-native dev /absolute/path/my-mobile --tunnel --port 8081
```

The current release also provides `srijika-native-0.7.1.tgz` on its GitHub Release.
Run it without a repository checkout:

```bash
npm exec --yes --package=https://github.com/bestmaa/srijika-studio/releases/download/v0.7.1/srijika-native-0.7.1.tgz -- srijika-native create my-mobile
```

The package is prepared for public npm distribution; the new package's first
publication requires its own npm bootstrap. Use the GitHub release download
while that is pending. Generated apps include a self-contained
`.srijika/native/check.mjs` and do not depend on a workspace checkout.

## Source and ownership

`srijika.config.json` retains the existing TSX-first Feature → Slot → Part
ownership contract. `srijika.native.json` separately selects the strict
`expo-go-v1` profile and Android/iOS platforms. Native commands reject web
framework/adoption profiles. Use the Native CLI for these projects; the existing
web CLI and Studio do not interpret Native sources.

Every visual owner has a pure `.ui.tsx` and its matching `.connector.tsx`.
Hook, Store, Logic, API and Types remain optional. UI receives values and callback
props, and receives child Connector composition through typed `ReactNode` slots.
Private boundaries cannot be bypassed. Business Logic additionally rejects Native
and Expo runtime imports.

The scaffold demonstrates a Home Feature and private Counter Slot. Name changes,
increment and reset happen in their Connectors. UI remains behavior-free.

## VS Code integration

The Srijika Language Support extension detects `srijika.native.json` and routes
Native sources through the static `@srijika/native/editor` entry point. Native
diagnostics and graph findings use the same compiler and Logic rules as the CLI.
Open the entire Native project folder to get live diagnostics, the ownership
sidebar and the Native-labelled Structure Graph. Expo's TypeScript base is
accepted only within the explicit Native profile.

Run App targets Expo Go; choose `srijika.nativeConnection: "tunnel"` for WSL.
New scaffolds recommend the extension and provide Native preview settings.
The extension does not install mobile SDKs or mix Native code into the web
compiler/renderer. See [extension usage](../../apps/vscode-srijika/README.md).

## Initial compiler profile

Supported runtime imports from `react-native`:

- `View`, `Text`, `Pressable`, `TextInput`, `Image`, `ScrollView` and
  `ActivityIndicator`, including named import aliases;
- supported native props, direct declared callback props, and inline native style
  objects/arrays or typed style props;
- literals, declared props references and bounded value expressions;
- fragments, JSX conditional branches and `ReactNode` slots; and
- one named exported pure function with a local typed props contract.

Compilation is static: project imports are never evaluated. The derived
`srijika-native-ui-v1` read model includes hierarchy, contracts and source spans;
it is never written over TSX. HTML, CSS classes/grid/units, raw text outside `Text`,
hooks, arbitrary calls, inline behavior, spreads and unknown components/props
produce diagnostics and no document. Actual React Native prop and callback types
are checked separately by the generated app's TypeScript gate.

This milestone deliberately does not support `StyleSheet.create`, local
`require` assets, `FlatList` render callbacks, third-party component registration,
platform-specific UI suffixes or the desktop-to-phone Inspector bridge. Expo Go
supports only the native modules included in its installed SDK. Custom native
modules and APK/AAB builds require a later development/cloud-build profile.

## Toolchain and verification

The scaffold pins Expo SDK 57 (`expo@57.0.28`), `react-native@0.86.3` and
`react@19.2.3`, matching Expo's blank TypeScript template. It ships a complete
pnpm lockfile and pins TypeScript, React types and the Expo tunnel dependency.
An installed Expo Go version must support the scaffold's SDK.

```bash
pnpm --filter @srijika/native test
pnpm --filter @srijika/native typecheck
pnpm exec eslint packages/native --max-warnings 0
```

Tests cover static compilation, ownership violations, standalone checking,
non-overwriting creation, symlink rejection and Expo Go launch planning. Runtime
validation additionally needs a generated-app install, TypeScript checks and
Android/iOS Metro bundle compilation. Actual device rendering, touch behavior,
keyboard interaction and Fast Refresh must be verified on a physical phone;
successful bundling alone does not establish those results.

Official references:

- [Expo project creation](https://docs.expo.dev/get-started/create-a-project/)
- [Expo CLI, Expo Go and tunneling](https://docs.expo.dev/more/expo-cli/)
- [Expo Go limitations](https://docs.expo.dev/faq/)
- [React Native components](https://reactnative.dev/docs/intro-react-native-components)
