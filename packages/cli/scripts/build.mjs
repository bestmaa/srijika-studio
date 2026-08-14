import { chmod, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const outputFile = `${outputDirectory}cli.mjs`;

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [`${packageRoot}src/cli.ts`],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['typescript'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  minify: false,
});
await chmod(outputFile, 0o755);
