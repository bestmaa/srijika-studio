import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const portalRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(portalRoot, '../..');
const sourceDirectory = join(repositoryRoot, 'docs');
const destinationDirectory = join(portalRoot, 'src/content/docs/reference');

const titleOverrides = new Map([
  ['CODE_FIRST_TSX.md', 'Code-first Srijika TSX'],
  ['CLI_AND_FAST_RUNTIME.md', 'CLI and Fast Runtime'],
  ['FEATURE_SLOT_PART_ARCHITECTURE.md', 'Feature, Slot, Part, and Shared Architecture'],
  ['MVP_ACCEPTANCE.md', 'UI MVP Acceptance'],
  ['UI_DOCUMENT_FORMAT.md', 'UI Document Format'],
  ['codex-plugin-architecture.md', 'Codex Plugin Architecture'],
]);

/** @param {string} value */
const escapeYaml = (value) => JSON.stringify(value);
/** @param {string} value */
const normalizeBrand = (value) =>
  value
    .replaceAll('SUTRA', 'SRIJIKA')
    .replaceAll('Sutra', 'Srijika')
    .replaceAll('sutra', 'srijika');

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });

const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .sort((left, right) => left.name.localeCompare(right.name));

for (const entry of entries) {
  const sourcePath = join(sourceDirectory, entry.name);
  const source = normalizeBrand(await readFile(sourcePath, 'utf8'));
  const heading = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = titleOverrides.get(entry.name) ?? heading ?? basename(entry.name, '.md');
  const description = `Canonical engineering reference for ${title}.`;
  const withoutFirstHeading = source.replace(/^#\s+.+\r?\n+/, '');
  const frontmatter = [
    '---',
    `title: ${escapeYaml(title)}`,
    `description: ${escapeYaml(description)}`,
    'tableOfContents:',
    '  minHeadingLevel: 2',
    '  maxHeadingLevel: 3',
    '---',
    '',
  ].join('\n');

  await writeFile(join(destinationDirectory, entry.name), `${frontmatter}${withoutFirstHeading}`);
}

const iconSource = join(repositoryRoot, 'apps/studio/src-tauri/icons/icon.png');
const assetTarget = join(portalRoot, 'src/assets/srijika-icon.png');
const faviconTarget = join(portalRoot, 'public/favicon.png');
await mkdir(dirname(assetTarget), { recursive: true });
await mkdir(dirname(faviconTarget), { recursive: true });
await copyFile(iconSource, assetTarget);
await copyFile(iconSource, faviconTarget);
