import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';

import type { NativeScaffoldOptions } from './types.js';

export const NATIVE_EXPO_TOOLCHAIN = Object.freeze({
  expo: '57.0.28',
  react: '19.2.3',
  reactNative: '0.86.3',
  typescript: '6.0.3',
  reactTypes: '19.2.18',
  pnpm: '11.18.0',
  ngrok: '4.1.3',
});

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function createNativeProjectFileMap(
  options: NativeScaffoldOptions,
  validatorSource: string,
  lockfileSource: string,
): Readonly<Record<string, string>> {
  const projectName = options.projectName ?? 'srijika-native-app';
  const displayName = options.displayName ?? 'Srijika Native';
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(projectName) || projectName.length > 64)
    throw new Error('Native project names must be lowercase kebab-case, up to 64 characters.');
  if (
    !displayName.trim() ||
    displayName.length > 100 ||
    [...displayName].some((character) => character.codePointAt(0)! < 32)
  )
    throw new Error('Native display names must contain 1–100 printable characters.');
  if (!validatorSource.trim() || !lockfileSource.trim())
    throw new Error(
      'The bundled Native validator and lockfile are required. Build @srijika/native first.',
    );
  return Object.freeze({
    'package.json': json({
      name: projectName,
      version: '0.1.0',
      private: true,
      main: 'index.ts',
      packageManager: `pnpm@${NATIVE_EXPO_TOOLCHAIN.pnpm}`,
      engines: { node: '>=22.13.0' },
      scripts: {
        start: 'pnpm check && expo start --go --lan',
        'start:tunnel': 'pnpm check && expo start --go --tunnel',
        check: 'node .srijika/native/check.mjs',
        typecheck: 'tsc --noEmit',
        verify: 'pnpm check && pnpm typecheck',
      },
      dependencies: {
        expo: NATIVE_EXPO_TOOLCHAIN.expo,
        react: NATIVE_EXPO_TOOLCHAIN.react,
        'react-native': NATIVE_EXPO_TOOLCHAIN.reactNative,
      },
      devDependencies: {
        '@expo/ngrok': NATIVE_EXPO_TOOLCHAIN.ngrok,
        '@types/react': NATIVE_EXPO_TOOLCHAIN.reactTypes,
        typescript: NATIVE_EXPO_TOOLCHAIN.typescript,
      },
    }),
    'pnpm-lock.yaml': lockfileSource,
    'pnpm-workspace.yaml': "packages:\n  - '.'\nallowBuilds:\n  '@expo/ngrok-bin': true\n",
    'srijika.config.json': json({
      sourceOfTruth: 'tsx',
      entry: 'src/features/home/Home.ui.tsx',
      architecture: { profile: 'feature-slot-part-v1' },
    }),
    'srijika.native.json': json({
      version: 1,
      profile: 'expo-go-v1',
      platforms: ['android', 'ios'],
    }),
    'app.json': json({
      expo: {
        name: displayName,
        slug: projectName,
        version: '1.0.0',
        platforms: ['android', 'ios'],
        orientation: 'portrait',
        userInterfaceStyle: 'light',
      },
    }),
    'tsconfig.json': json({
      extends: 'expo/tsconfig.base',
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        types: ['react', 'react-native'],
      },
      include: ['index.ts', 'App.tsx', 'src'],
    }),
    '.gitignore': 'node_modules/\n.expo/\ndist/\nandroid/\nios/\n*.log\n.env\n',
    '.vscode/extensions.json': json({ recommendations: ['srijika.srijika-language-support'] }),
    '.vscode/settings.json': json({
      'srijika.nativeConnection': 'tunnel',
      'srijika.nativeDevPort': 8081,
      'typescript.preferences.importModuleSpecifier': 'relative',
    }),
    'index.ts':
      "import { registerRootComponent } from 'expo';\nimport App from './App';\n\nregisterRootComponent(App);\n",
    'App.tsx':
      "import { SafeAreaView, StatusBar } from 'react-native';\nimport { HomeConnector } from './src/features/home/Home.connector';\n\nexport default function App() {\n  return (\n    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f6fb' }}>\n      <StatusBar barStyle=\"dark-content\" />\n      <HomeConnector />\n    </SafeAreaView>\n  );\n}\n",
    'src/features/home/Home.ui.tsx': `import type { ReactNode } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

export interface HomeProps {
  title: string;
  name: string;
  onNameChange: (value: string) => void;
  counter: ReactNode;
}

export function HomeUI(props: HomeProps) {
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 32, fontWeight: '700', color: '#18213b' }}>{props.title}</Text>
        <Text style={{ fontSize: 16, color: '#59647c' }}>React Native + Expo Go</Text>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>Your name</Text>
        <TextInput
          accessibilityLabel="Your name"
          value={props.name}
          onChangeText={props.onNameChange}
          placeholder="Enter your name"
          style={{ padding: 16, borderWidth: 1, borderColor: '#ccd3e2', borderRadius: 12, backgroundColor: '#ffffff', fontSize: 16 }}
        />
        <Text style={{ fontSize: 18, color: '#18213b' }}>Hello, {props.name}!</Text>
      </View>
      <View>{props.counter}</View>
      <Text style={{ color: '#59647c', fontSize: 14 }}>Edit Home.ui.tsx to see Fast Refresh on your phone.</Text>
    </ScrollView>
  );
}
`,
    'src/features/home/Home.connector.tsx': `import { useState } from 'react';
import { HomeUI } from './Home.ui';
import { CounterConnector } from './slots/counter/Counter.connector';

export function HomeConnector() {
  const [name, setName] = useState('friend');
  return <HomeUI title={${JSON.stringify(displayName)}} name={name} onNameChange={setName} counter={<CounterConnector />} />;
}
`,
    'src/features/home/slots/counter/Counter.ui.tsx': `import { Pressable, Text, View } from 'react-native';

export interface CounterProps {
  count: number;
  onIncrement: () => void;
  onReset: () => void;
}

export function CounterUI(props: CounterProps) {
  return (
    <View style={{ padding: 24, gap: 16, borderRadius: 20, backgroundColor: '#ffffff' }}>
      <Text style={{ fontSize: 16, color: '#59647c' }}>Native interactions</Text>
      <Text accessibilityLabel="Counter value" style={{ fontSize: 48, fontWeight: '700', color: '#18213b' }}>{props.count}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Increment counter" onPress={props.onIncrement} style={{ padding: 16, borderRadius: 12, backgroundColor: '#455de8' }}>
        <Text style={{ color: '#ffffff', textAlign: 'center', fontWeight: '600', fontSize: 16 }}>Increment</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={props.onReset} style={{ padding: 12 }}>
        <Text style={{ color: '#455de8', textAlign: 'center', fontSize: 16 }}>Reset</Text>
      </Pressable>
    </View>
  );
}
`,
    'src/features/home/slots/counter/Counter.connector.tsx':
      "import { useState } from 'react';\nimport { CounterUI } from './Counter.ui';\n\nexport function CounterConnector() {\n  const [count, setCount] = useState(0);\n  return <CounterUI count={count} onIncrement={() => setCount((value) => value + 1)} onReset={() => setCount(0)} />;\n}\n",
    'src/shared/.gitkeep': '',
    '.srijika/native/check.mjs': validatorSource,
    'README.md': `# ${displayName.replaceAll('#', '').replaceAll('<', '').replaceAll('>', '')}\n\nA native Android/iOS starter using React Native and Expo Go.\n\n\`\`\`bash\npnpm install --frozen-lockfile\npnpm verify\npnpm start\n\`\`\`\n\nScan the terminal QR code with Expo Go on your phone. Use the same Wi-Fi network. For WSL or a blocked LAN connection, use \`pnpm start:tunnel\`. Both modes explicitly target Expo Go and never launch an emulator or perform native compilation.\n\nUI source lives in \`src/features\` and \`src/shared\`, following Feature → Slot → Part ownership. UI receives typed values, callbacks and ReactNode slots from its matching Connector. Hooks, state and behavior stay outside UI.\n\nThe bundled \`pnpm check\` runs ownership checks and the independent Native compiler. \`pnpm typecheck\` checks actual React Native types. Run \`pnpm verify\` before shipping changes.\n\nThe initial compiler supports View, Text, Pressable, TextInput, Image, ScrollView, ActivityIndicator, props, ReactNode slots, fragments and JSX conditions. Use inline native style objects or typed style props. StyleSheet calls, arbitrary callbacks in UI, FlatList, local require assets and third-party UI registrations need a later profile.\n\nAndroid Studio and JDK are unnecessary for Expo Go. Custom native modules require a development build; APK/AAB compilation is a separate cloud-build milestone. Studio's desktop Native Inspector bridge is not part of this starter.\n`,
  });
}

export async function writeNativeProject(directory: string, options: NativeScaffoldOptions = {}) {
  if (!isAbsolute(directory))
    throw new Error('Native scaffold targets must be explicit absolute paths.');
  const target = resolve(directory);
  if (target === parse(target).root)
    throw new Error('Cannot scaffold a Native project at a filesystem root.');
  const validatorSource = await readFile(new URL('../dist/check.mjs', import.meta.url), 'utf8');
  const lockfileSource = await readFile(
    new URL('../templates/pnpm-lock.yaml', import.meta.url),
    'utf8',
  );
  const files = createNativeProjectFileMap(options, validatorSource, lockfileSource);
  let ancestor = target;
  for (;;) {
    try {
      const metadata = await lstat(ancestor);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (process.platform !== 'win32' && (await realpath(ancestor)) !== ancestor)
      )
        throw new Error('Native scaffold paths must not pass through symbolic links or files.');
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      ancestor = dirname(ancestor);
    }
  }
  try {
    const metadata = await lstat(target);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await readdir(target)).length > 0)
      throw new Error(
        'Native scaffold targets must be empty; existing projects are never overwritten.',
      );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await mkdir(target, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(target, name);
    const fromTarget = relative(target, path);
    if (fromTarget.startsWith('..') || isAbsolute(fromTarget))
      throw new Error('Unsafe Native scaffold path.');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  }
  return { root: target, files: Object.keys(files) };
}
