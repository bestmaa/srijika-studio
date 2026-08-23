import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = resolve(import.meta.dirname, '..', 'dist', 'assets');
const files = (await readdir(assets)).filter((file) => file.endsWith('.js'));

async function bytes(file) {
  return (await stat(resolve(assets, file))).size;
}

function exactlyOne(prefix) {
  const matches = files.filter((file) => file.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${prefix} JavaScript chunk, found ${matches.length}.`);
  }
  return matches[0];
}

const entry = exactlyOne('index-');
const preview = exactlyOne('PreviewApp-');
const studio = exactlyOne('StudioApp-');
const sized = await Promise.all(files.map(async (file) => ({ file, bytes: await bytes(file) })));
const sizeByFile = new Map(sized.map((item) => [item.file, item.bytes]));

const budgets = [
  { label: 'entry', file: entry, maximum: 256 * 1024 },
  { label: 'preview', file: preview, maximum: 32 * 1024 },
  { label: 'Studio editor', file: studio, maximum: 4_250 * 1024 },
];

for (const budget of budgets) {
  const actual = sizeByFile.get(budget.file);
  if (actual === undefined || actual > budget.maximum) {
    throw new Error(
      `${budget.label} chunk ${budget.file} is ${actual ?? 'missing'} bytes; budget is ${budget.maximum}.`,
    );
  }
}

const previewPathBytes = sized
  .filter(({ file }) => file !== studio)
  .reduce((total, item) => total + item.bytes, 0);
const totalBytes = sized.reduce((total, item) => total + item.bytes, 0);
if (previewPathBytes > 512 * 1024) {
  throw new Error(`Preview JavaScript path is ${previewPathBytes} bytes; budget is 524288.`);
}
if (totalBytes > 4_750 * 1024) {
  throw new Error(`Studio JavaScript output is ${totalBytes} bytes; budget is 4864000.`);
}

console.log(
  `Studio bundle budgets passed: entry ${sizeByFile.get(entry)}, preview path ${previewPathBytes}, editor ${sizeByFile.get(studio)}, total ${totalBytes} bytes.`,
);
