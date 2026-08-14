import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packageOutputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const pluginOutputDirectory = fileURLToPath(
  new URL('../../../plugins/srijika-studio/mcp-server/', import.meta.url),
);

await Promise.all([
  mkdir(packageOutputDirectory, { recursive: true }),
  mkdir(pluginOutputDirectory, { recursive: true }),
]);
const sharedBuild = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['typescript'],
  sourcemap: false,
  minify: false,
};
await Promise.all([
  build({
    ...sharedBuild,
    entryPoints: [`${packageRoot}src/cli.ts`],
    outfile: `${packageOutputDirectory}cli.mjs`,
    banner: { js: '#!/usr/bin/env node' },
  }),
  build({
    ...sharedBuild,
    entryPoints: [`${packageRoot}src/index.ts`],
    outfile: `${packageOutputDirectory}index.mjs`,
  }),
]);
await copyFile(`${packageOutputDirectory}cli.mjs`, `${pluginOutputDirectory}srijika-mcp.mjs`);
await Promise.all([
  chmod(`${packageOutputDirectory}cli.mjs`, 0o755),
  chmod(`${pluginOutputDirectory}srijika-mcp.mjs`, 0o755),
]);
