import { createSrijikaProjectFileMap } from './templates.js';
import { createSrijikaNextLivePreviewFileMap } from './next-live-preview.js';
import type { SrijikaNextProjectScaffoldOptions, SrijikaProjectFileMap } from './types.js';

const SAFE_PACKAGE_VERSION =
  /^(?!\s)(?!.*\s$)(?!(?:file:|link:|workspace:|\.{1,2}\/|\/|https?:|git(?:\+|:)|github:|gitlab:|bitbucket:|ssh:)).{1,128}$/iu;

const sourceFile = (source: string): string => `${source.trim()}\n`;
const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Produces the canonical Next App Router migration target without touching the
 * filesystem. The source framework version and app root are inventory facts,
 * never inferred from caller-authored migration output.
 */
export function createSrijikaNextProjectFileMap(
  options: SrijikaNextProjectScaffoldOptions,
): SrijikaProjectFileMap {
  if (!SAFE_PACKAGE_VERSION.test(options.nextVersion)) {
    throw new TypeError('nextVersion must be a bounded registry package version.');
  }
  if (options.appRoot !== 'app' && options.appRoot !== 'src/app') {
    throw new TypeError('appRoot must be either "app" or "src/app".');
  }

  const files: Record<string, string> = { ...createSrijikaProjectFileMap(options) };
  delete files['index.html'];
  delete files['pnpm-lock.yaml'];
  delete files['src/App.tsx'];
  delete files['src/main.tsx'];
  delete files['src/srijika/preview-bridge.ts'];
  delete files['src/vite-env.d.ts'];
  delete files['vite.config.ts'];

  const packageMetadata = JSON.parse(files['package.json'] ?? '{}') as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  packageMetadata.scripts = {
    dev: 'next dev',
    'validate:srijika': 'node scripts/srijika-validate.mjs',
    'mcp:srijika': 'npx -y @srijika/mcp-server@0.5.0 --project .',
    build: 'pnpm run validate:srijika && tsc -p tsconfig.json --noEmit && next build',
    start: 'next start',
    typecheck: 'pnpm run validate:srijika && tsc -p tsconfig.json --noEmit',
  };
  packageMetadata.dependencies = {
    ...packageMetadata.dependencies,
    next: options.nextVersion,
  };
  for (const dependency of [
    '@babel/core',
    '@rolldown/plugin-babel',
    '@types/babel__core',
    '@vitejs/plugin-react',
    'babel-plugin-react-compiler',
    'vite',
  ]) {
    delete packageMetadata.devDependencies[dependency];
  }
  files['package.json'] = jsonFile(packageMetadata);

  const routeImport = options.appRoot === 'app' ? '../src' : '..';
  const stylesImport = options.appRoot === 'app' ? '../src/styles.css' : '../styles.css';
  files[`${options.appRoot}/layout.tsx`] = sourceFile(`
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '${stylesImport}';

export const metadata: Metadata = {
  title: ${JSON.stringify(options.displayName ?? 'Srijika App')},
  description: 'A code-first Srijika application running on the Next.js App Router.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`);
  files[`${options.appRoot}/page.tsx`] = sourceFile(`
import { HomeConnector } from '${routeImport}/features/home/Home.connector';

export default function HomePage() {
  return <HomeConnector />;
}
`);
  files['next-env.d.ts'] = sourceFile(`
/// <reference types="next" />
/// <reference types="next/image-types/global" />

`);
  files['next.config.ts'] = sourceFile(`
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      '**/*.ui.tsx': {
        loaders: ['./src/srijika/next-preview-loader.cjs'],
        as: '*.tsx',
      },
    },
  },
};

export default nextConfig;
`);
  Object.assign(files, createSrijikaNextLivePreviewFileMap(options.appRoot));
  files['tsconfig.json'] = jsonFile({
    compilerOptions: {
      target: 'ES2022',
      lib: ['DOM', 'DOM.Iterable', 'ES2022'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  });

  files['src/features/home/Home.connector.tsx'] = sourceFile(`
'use client';

${files['src/features/home/Home.connector.tsx'] ?? ''}
`);
  files['src/features/home/slots/navigation/Navigation.connector.tsx'] = sourceFile(`
'use client';

${files['src/features/home/slots/navigation/Navigation.connector.tsx'] ?? ''}
`);
  if (files['src/app/AppProviders.tsx']) {
    files['src/app/AppProviders.tsx'] = sourceFile(`
'use client';

${files['src/app/AppProviders.tsx']}
`);
  }

  const toolchain = JSON.parse(files['srijika.toolchain.json'] ?? '{}') as Record<string, unknown>;
  toolchain['install'] = {
    strategy: 'package-manager',
    command: 'pnpm install --lockfile=false',
  };
  toolchain['execution'] = {
    defaultRuntime: 'node',
    optionalRuntimes: ['bun'],
    runtimeSelection: 'explicit',
    devServer: 'next',
    hmr: true,
  };
  toolchain['compiler'] = {
    typescript: packageMetadata.devDependencies['typescript'],
    next: options.nextVersion,
  };
  files['srijika.toolchain.json'] = jsonFile(toolchain);
  files['README.md'] = (files['README.md'] ?? '').replaceAll(
    'pnpm install --frozen-lockfile',
    'pnpm install --lockfile=false',
  );
  files['.gitignore'] = sourceFile(`
node_modules
.next
out
.DS_Store
*.local
`);

  return Object.freeze(
    Object.fromEntries(
      Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
}
