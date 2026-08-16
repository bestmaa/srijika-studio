import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env['GITHUB_ACTIONS'] !== 'true') {
  throw new Error('npm publishing is restricted to the reviewed GitHub Actions workflow.');
}

const root = resolve(import.meta.dirname, '..');
const directories = ['packages/cli', 'packages/mcp-server', 'packages/create-srijika'];
const publishWithProvenance = process.env['NPM_CONFIG_PROVENANCE'] === 'true';

for (const relativeDirectory of directories) {
  const directory = resolve(root, relativeDirectory);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const specifier = `${manifest.name}@${manifest.version}`;
  const existing = spawnSync('npm', ['view', specifier, 'version', '--json'], {
    encoding: 'utf8',
  });
  if (existing.status === 0) {
    console.log(`Skipping ${specifier}; it is already published.`);
    continue;
  }
  if (!`${existing.stderr}\n${existing.stdout}`.includes('E404')) {
    throw new Error(existing.stderr || `Unable to query ${specifier}.`);
  }
  console.log(
    `Publishing ${specifier}${publishWithProvenance ? ' with npm provenance' : ' from the reviewed GitHub Actions workflow'}.`,
  );
  const publishArguments = ['publish', '--access', 'public'];
  if (publishWithProvenance) publishArguments.push('--provenance');
  const published = spawnSync('npm', publishArguments, {
    cwd: directory,
    stdio: 'inherit',
  });
  if (published.status !== 0) throw new Error(`Publishing ${specifier} failed.`);
}
