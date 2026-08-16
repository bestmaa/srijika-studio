import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const packageOutputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const pluginOutputDirectory = fileURLToPath(
  new URL('../../../plugins/srijika-studio/mcp-server/', import.meta.url),
);
const selfContainedPluginBanner = [
  '#!/usr/bin/env node',
  "import { createRequire as __srijikaCreateRequire } from 'node:module';",
  "import { fileURLToPath as __srijikaFileURLToPath } from 'node:url';",
  "import { dirname as __srijikaDirname } from 'node:path';",
  'const require = __srijikaCreateRequire(import.meta.url);',
  'const __filename = __srijikaFileURLToPath(import.meta.url);',
  'const __dirname = __srijikaDirname(__filename);',
].join('\n');

await Promise.all([
  mkdir(packageOutputDirectory, { recursive: true }),
  mkdir(pluginOutputDirectory, { recursive: true }),
]);
const sharedBuild = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
};
await Promise.all([
  build({
    ...sharedBuild,
    external: ['typescript'],
    entryPoints: [`${packageRoot}src/cli.ts`],
    outfile: `${packageOutputDirectory}cli.mjs`,
    banner: { js: '#!/usr/bin/env node' },
  }),
  build({
    ...sharedBuild,
    external: ['typescript'],
    entryPoints: [`${packageRoot}src/index.ts`],
    outfile: `${packageOutputDirectory}index.mjs`,
  }),
  build({
    ...sharedBuild,
    entryPoints: [`${packageRoot}src/cli.ts`],
    outfile: `${pluginOutputDirectory}srijika-mcp.mjs`,
    banner: { js: selfContainedPluginBanner },
  }),
]);
await Promise.all(
  [
    `${packageOutputDirectory}cli.mjs`,
    `${packageOutputDirectory}index.mjs`,
    `${pluginOutputDirectory}srijika-mcp.mjs`,
  ].map(async (output) => {
    const source = await readFile(output, 'utf8');
    await writeFile(output, source.replace(/[\t ]+$/gm, ''), 'utf8');
  }),
);
await Promise.all([
  chmod(`${packageOutputDirectory}cli.mjs`, 0o755),
  chmod(`${pluginOutputDirectory}srijika-mcp.mjs`, 0o755),
]);
