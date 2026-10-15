import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  assertNativePreviewContext,
  assertNativePreviewPackage,
  nativePreviewVersion,
} from './native-npm-preview.mjs';

const context = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'bestmaa/srijika-studio',
  GITHUB_WORKFLOW: 'Release npm packages',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_NUMBER: '42',
  GITHUB_RUN_ATTEMPT: '1',
};

test('uses a unique next-patch preview for each workflow attempt', () => {
  assert.equal(nativePreviewVersion('0.7.1', context), '0.7.2-preview.42.1');
  assert.equal(
    nativePreviewVersion('0.7.1', { ...context, GITHUB_RUN_ATTEMPT: '2' }),
    '0.7.2-preview.42.2',
  );
});

test('rejects local, fork, pull-request, tag, and wrong-workflow publication', () => {
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: 'false',
    GITHUB_REPOSITORY: 'someone/srijika-studio',
    GITHUB_WORKFLOW: 'Other workflow',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/tags/v0.7.1',
    GITHUB_RUN_NUMBER: '../42',
    GITHUB_RUN_ATTEMPT: '0',
  })) {
    assert.throws(() => assertNativePreviewContext({ ...context, [name]: value }), /require/);
  }
});

test('rejects invalid and already-prerelease base versions', () => {
  for (const version of ['0.7.1-preview.1', 'latest', '01.7.1', '0.7.9007199254740991']) {
    assert.throws(() => nativePreviewVersion(version, context));
  }
});

test('publishes only the Native package at the prepared preview version', () => {
  const version = nativePreviewVersion('0.7.1', context);
  const environment = { ...context, SRIJIKA_NATIVE_PREVIEW_VERSION: version };
  assertNativePreviewPackage({ name: '@srijika/native', version }, environment);
  for (const manifest of [
    { name: '@srijika/cli', version },
    { name: '@srijika/native', version: '0.7.1' },
    { name: '@srijika/native', version: '0.7.2-preview.42.2' },
  ]) {
    assert.throws(() => assertNativePreviewPackage(manifest, environment), /prepared/);
  }
});

test('coordinated preview stamping keeps package, CLI and documentation markers usable', async () => {
  const repository = resolve(import.meta.dirname, '..');
  const script = 'scripts/set-npm-release-version.mjs';
  const source = await readFile(resolve(repository, script), 'utf8');
  const files = new Set(
    [...source.matchAll(/'([^'\n]+\.(?:json|ts|md|mdx|astro|mjs))'/g)]
      .map((match) => match[1])
      .filter((file) => /^(?:packages|apps|docs|plugins|scripts)\//.test(file)),
  );
  files.add(script);
  const temporary = await mkdtemp(join(tmpdir(), 'srijika-release-version-test-'));
  try {
    for (const file of files) {
      const destination = resolve(temporary, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(resolve(repository, file), destination);
    }
    const version = nativePreviewVersion('0.7.1', context);
    const stamped = spawnSync(process.execPath, [resolve(temporary, script), version], {
      cwd: temporary,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(stamped.status, 0, stamped.stderr || stamped.stdout);
    for (const name of ['native', 'cli', 'mcp-server', 'create-srijika']) {
      const manifest = JSON.parse(
        await readFile(resolve(temporary, `packages/${name}/package.json`), 'utf8'),
      );
      assert.equal(manifest.version, version);
    }
    const cli = await readFile(resolve(temporary, 'packages/native/src/cli.ts'), 'utf8');
    assert.ok(cli.includes(`export const SRIJIKA_NATIVE_VERSION = '${version}';`));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
