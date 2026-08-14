import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [`${packageRoot}src/extension.ts`],
  outfile: `${outputDirectory}extension.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: false,
});
