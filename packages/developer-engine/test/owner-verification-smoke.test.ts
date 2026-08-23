import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { verifySrijikaOwnerTests } from '../src/index.js';

const smoke = process.env['SRIJIKA_RUN_OWNER_VERIFICATION_SMOKE'] === '1' ? it : it.skip;

smoke(
  'verifies a visual owner through the real Vite adapter',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-vite-verification-'));
    try {
      await mkdir(join(root, 'src/features/home'), { recursive: true });
      await writeFile(
        join(root, 'src/features/home/Home.ui.tsx'),
        `export function HomeUI() {
  return <main><h1>Vite owner</h1></main>;
}
`,
      );
      await writeFile(
        join(root, 'src/features/home/Home.connector.tsx'),
        `import { HomeUI } from './Home.ui';
export function HomeConnector() {
  return <HomeUI />;
}
`,
      );
      await writeFile(
        join(root, 'srijika.config.json'),
        `${JSON.stringify(
          {
            version: 1,
            sourceOfTruth: 'tsx',
            entry: 'src/features/home/Home.ui.tsx',
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(root, 'package.json'),
        `${JSON.stringify(
          {
            name: 'srijika-vite-verification',
            private: true,
            type: 'module',
            packageManager: 'pnpm@11.18.0',
            scripts: { dev: 'vite' },
            dependencies: { react: '19.2.8', 'react-dom': '19.2.8' },
            devDependencies: {
              '@types/node': '26.1.2',
              '@types/react': '19.2.18',
              '@types/react-dom': '19.2.4',
              typescript: '6.0.3',
              vite: '8.2.0',
            },
            srijika: { sourceOfTruth: 'tsx' },
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(root, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              lib: ['dom', 'dom.iterable', 'esnext'],
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              isolatedModules: true,
              jsx: 'react-jsx',
            },
            include: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
          },
          null,
          2,
        )}\n`,
      );

      const result = await verifySrijikaOwnerTests({ project: root });
      expect(result, JSON.stringify(result, null, 2)).toMatchObject({
        framework: 'vite',
        status: 'passed',
        gates: [
          { name: 'install', status: 'passed' },
          { name: 'architecture', status: 'passed' },
          { name: 'typecheck', status: 'passed' },
          { name: 'vitest', status: 'passed' },
          { name: 'playwright-browser', status: 'passed' },
          { name: 'playwright', status: 'passed' },
        ],
        evidence: {
          manifest: {
            status: 'passed',
            owners: [{ ownerId: 'feature:home', status: 'passed' }],
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  240_000,
);

smoke(
  'verifies an async Server Component through the real Next App Router adapter',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-next-verification-'));
    try {
      await mkdir(join(root, 'src/features/home'), { recursive: true });
      await writeFile(
        join(root, 'src/features/home/Home.ui.tsx'),
        `export function HomeUI() {
  return <main><h1>Async Next owner</h1></main>;
}
`,
      );
      await writeFile(
        join(root, 'src/features/home/Home.connector.tsx'),
        `import { HomeUI } from './Home.ui';
export async function HomeConnector() {
  await Promise.resolve();
  return <HomeUI />;
}
`,
      );
      await writeFile(
        join(root, 'srijika.config.json'),
        `${JSON.stringify(
          {
            version: 1,
            sourceOfTruth: 'tsx',
            entry: 'src/features/home/Home.ui.tsx',
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(root, 'package.json'),
        `${JSON.stringify(
          {
            name: 'srijika-next-verification',
            private: true,
            type: 'module',
            packageManager: 'pnpm@11.18.0',
            scripts: { dev: 'next dev' },
            dependencies: { next: '16.3.2', react: '19.2.8', 'react-dom': '19.2.8' },
            devDependencies: {
              '@types/node': '26.1.2',
              '@types/react': '19.2.18',
              '@types/react-dom': '19.2.4',
              typescript: '6.0.3',
            },
            srijika: { sourceOfTruth: 'tsx' },
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(root, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              lib: ['dom', 'dom.iterable', 'esnext'],
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: 'preserve',
            },
            include: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
          },
          null,
          2,
        )}\n`,
      );

      const result = await verifySrijikaOwnerTests({ project: root });
      expect(result, JSON.stringify(result, null, 2)).toMatchObject({
        framework: 'next-app-router',
        status: 'passed',
        gates: [
          { name: 'install', status: 'passed' },
          { name: 'architecture', status: 'passed' },
          { name: 'typecheck', status: 'passed' },
          {
            name: 'vitest',
            status: 'passed',
            message: 'No Vitest artifacts are required by this owner contract.',
          },
          { name: 'playwright-browser', status: 'passed' },
          { name: 'playwright', status: 'passed' },
        ],
        evidence: {
          manifest: {
            status: 'passed',
            owners: [{ ownerId: 'feature:home', status: 'passed' }],
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  240_000,
);
