import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../bin/create-srijika.mjs', import.meta.url));

test('forwards version and help to the published Srijika CLI', () => {
  const version = spawnSync(process.execPath, [executable, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), '0.4.0');

  const help = spawnSync(process.execPath, [executable, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /srijika create \[directory\]/);
});

test('forwards create options such as --react-query without filtering them', () => {
  const source = readFileSync(executable, 'utf8');

  assert.match(source, /\['create', \.\.\.arguments_\]/);
  assert.doesNotMatch(source, /react-query/);
});
