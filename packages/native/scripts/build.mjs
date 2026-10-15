import { chmod, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(`${root}dist`, { recursive: true });
for (const entry of ['index', 'editor', 'cli', 'check']) {
  await build({
    entryPoints: [`${root}src/${entry}.ts`],
    outfile: `${root}dist/${entry}.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['typescript'],
    ...(['index', 'editor'].includes(entry) ? {} : { banner: { js: '#!/usr/bin/env node' } }),
    minify: entry === 'check',
    legalComments: 'none',
  });
}
await chmod(`${root}dist/cli.mjs`, 0o755);
