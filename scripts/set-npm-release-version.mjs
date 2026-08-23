import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: pnpm release:version <semver>');
}

const root = resolve(import.meta.dirname, '..');
const jsonFiles = [
  'packages/cli/package.json',
  'packages/mcp-server/package.json',
  'packages/create-srijika/package.json',
  'apps/vscode-srijika/package.json',
];

for (const relativePath of jsonFiles) {
  const absolutePath = resolve(root, relativePath);
  const value = JSON.parse(await readFile(absolutePath, 'utf8'));
  value.version = version;
  if (relativePath.endsWith('create-srijika/package.json')) {
    value.dependencies['@srijika/cli'] = version;
  }
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

const replacements = [
  {
    path: 'packages/cli/src/cli.ts',
    pattern: /export const SRIJIKA_CLI_VERSION = '[^']+';/,
    replacement: `export const SRIJIKA_CLI_VERSION = '${version}';`,
  },
  ...[
    'packages/project-scaffold/src/templates.ts',
    'packages/project-scaffold/test/project-scaffold.test.ts',
    'docs/MONOREPO.md',
    'docs/codex-plugin-architecture.md',
    'plugins/srijika-studio/skills/srijika-studio/references/cli-and-runtime.md',
    'apps/portal/src/content/docs/docs/vscode.mdx',
    'apps/portal/src/content/docs/docs/cli-runtime.mdx',
  ].map((path) => ({
    path,
    pattern: /@srijika\/mcp-server@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `@srijika/mcp-server@${version}`,
  })),
  {
    path: 'packages/developer-engine/src/workspace.ts',
    pattern: /const MCP_SERVER_VERSION = '[^']+';/,
    replacement: `const MCP_SERVER_VERSION = '${version}';`,
  },
  {
    path: 'packages/create-srijika/test/create-srijika.test.mjs',
    pattern: /assert\.equal\(version\.stdout\.trim\(\), '[^']+'\);/,
    replacement: `assert.equal(version.stdout.trim(), '${version}');`,
  },
  ...[
    'apps/portal/src/pages/index.astro',
    'apps/portal/src/content/docs/docs/product-status.mdx',
    'apps/portal/src/content/docs/docs/cli-runtime.mdx',
    'docs/VSCODE_RELEASE.md',
  ].map((path) => ({
    path,
    pattern: /v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `v${version}`,
  })),
  {
    path: 'docs/NPM_RELEASE.md',
    pattern: /pnpm release:version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `pnpm release:version ${version}`,
  },
  {
    path: 'docs/NPM_RELEASE.md',
    pattern: /v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `v${version}`,
  },
  {
    path: 'docs/VSCODE_RELEASE.md',
    pattern: /pnpm release:version \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `pnpm release:version ${version}`,
  },
  {
    path: 'docs/VSCODE_RELEASE.md',
    pattern: /srijika-language-support-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.vsix/g,
    replacement: `srijika-language-support-${version}.vsix`,
  },
  {
    path: 'docs/VSCODE_RELEASE.md',
    pattern: /srijika\.srijika-language-support@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `srijika.srijika-language-support@${version}`,
  },
];

for (const replacement of replacements) {
  const absolutePath = resolve(root, replacement.path);
  const source = await readFile(absolutePath, 'utf8');
  if (source.search(replacement.pattern) < 0) {
    throw new Error(`Version marker not found in ${replacement.path}`);
  }
  const updated = source.replace(replacement.pattern, replacement.replacement);
  await writeFile(absolutePath, updated);
}

console.log(`Srijika npm release version set to ${version}.`);
