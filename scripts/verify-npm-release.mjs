import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repository = 'git+https://github.com/bestmaa/srijika-studio.git';
const requiredNodeEngine = '>=22.13.0';
const releasePackages = [
  {
    directory: 'packages/cli',
    name: '@srijika/cli',
    binName: 'srijika',
    binPath: 'dist/cli.mjs',
    files: ['dist/cli.mjs'],
  },
  {
    directory: 'packages/mcp-server',
    name: '@srijika/mcp-server',
    binName: 'srijika-mcp',
    binPath: 'dist/cli.mjs',
    files: ['dist/cli.mjs', 'dist/index.mjs'],
  },
  {
    directory: 'packages/create-srijika',
    name: 'create-srijika',
    binName: 'create-srijika',
    binPath: 'bin/create-srijika.mjs',
    files: ['bin/create-srijika.mjs'],
  },
];

const manifests = [];
for (const releasePackage of releasePackages) {
  const directory = resolve(root, releasePackage.directory);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (manifest.name !== releasePackage.name) {
    throw new Error(`${releasePackage.directory} must publish as ${releasePackage.name}.`);
  }
  if (manifest.private === true) throw new Error(`${manifest.name} must not be private.`);
  if (manifest.publishConfig?.access !== 'public') {
    throw new Error(`${manifest.name} must publish with public access.`);
  }
  if (manifest.license !== 'Apache-2.0') {
    throw new Error(`${manifest.name} must declare the repository Apache-2.0 license.`);
  }
  if (manifest.repository?.url !== repository) {
    throw new Error(`${manifest.name} repository URL must match the GitHub OIDC repository.`);
  }
  if (manifest.engines?.node !== requiredNodeEngine) {
    throw new Error(`${manifest.name} must require Node.js ${requiredNodeEngine}.`);
  }
  if (manifest.bin?.[releasePackage.binName] !== releasePackage.binPath) {
    throw new Error(
      `${manifest.name} must expose ${releasePackage.binName} as ${releasePackage.binPath} without a leading ./ so npm 11 preserves it.`,
    );
  }
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: directory,
    encoding: 'utf8',
  });
  if (packed.status !== 0) throw new Error(packed.stderr || `${manifest.name} pack failed.`);
  const report = JSON.parse(packed.stdout)[0];
  const files = new Set(report.files.map((file) => file.path));
  for (const expected of releasePackage.files) {
    if (!files.has(expected)) throw new Error(`${manifest.name} tarball is missing ${expected}.`);
  }
  manifests.push(manifest);
}

const versions = new Set(manifests.map((manifest) => manifest.version));
if (versions.size !== 1) throw new Error('All public Srijika npm packages must share one version.');
const [version] = versions;
const createManifest = manifests.find((manifest) => manifest.name === 'create-srijika');
if (createManifest.dependencies?.['@srijika/cli'] !== version) {
  throw new Error('create-srijika must depend on the exact release version of @srijika/cli.');
}

const rawTag = process.env['RELEASE_TAG']?.trim();
if (rawTag) {
  const tagVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
  if (tagVersion !== version) {
    throw new Error(`Release tag ${rawTag} does not match package version ${version}.`);
  }
}

console.log(
  `Srijika npm release ${version} verified: ${manifests.map((item) => item.name).join(', ')}.`,
);
