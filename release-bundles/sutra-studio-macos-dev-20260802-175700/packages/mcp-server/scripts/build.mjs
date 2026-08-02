import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(
  new URL('../../../plugins/sutra-studio/mcp-server/', import.meta.url),
);

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [`${packageRoot}src/cli.ts`],
  outfile: `${outputDirectory}sutra-mcp.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
});
