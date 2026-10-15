import { spawnSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { nativePreviewVersion } from './native-npm-preview.mjs';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'packages/native/package.json'), 'utf8'));
const version = nativePreviewVersion(manifest.version, process.env);
if (!process.env.GITHUB_ENV) throw new Error('Native preview preparation needs GITHUB_ENV.');
const readmePath = resolve(root, 'packages/native/README.md');
const stableReadme = await readFile(readmePath, 'utf8');

const prepared = spawnSync(
  process.execPath,
  [resolve(root, 'scripts/set-npm-release-version.mjs'), version],
  { cwd: root, stdio: 'inherit' },
);
if (prepared.status !== 0) throw new Error('Native preview version preparation failed.');

await writeFile(
  readmePath,
  `> Native preview ${version}, published under the native-preview npm tag. Stable installation uses latest.\n\n${stableReadme}`,
);

await appendFile(
  process.env.GITHUB_ENV,
  `SRIJIKA_NATIVE_PREVIEW_VERSION=${version}\nRELEASE_TAG=v${version}\n`,
);
console.log(`Prepared ${version} in the temporary CI checkout; publish only @srijika/native.`);
