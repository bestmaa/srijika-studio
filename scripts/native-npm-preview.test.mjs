import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  assertNativePreviewContext,
  assertNativePreviewPackage,
  nativePreviewLockfile,
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

test('changes only the local CLI lockfile specifier and rejects unexpected resolutions', async () => {
  const lockfile = await readFile(resolve(import.meta.dirname, '../pnpm-lock.yaml'), 'utf8');
  const stableVersion = JSON.parse(
    await readFile(resolve(import.meta.dirname, '../packages/native/package.json'), 'utf8'),
  ).version;
  const version = nativePreviewVersion(stableVersion, context);
  assert.equal(
    nativePreviewLockfile(lockfile, stableVersion, context),
    lockfile.replace(
      `specifier: ${stableVersion}\n        version: link:../cli`,
      `specifier: ${version}\n        version: link:../cli`,
    ),
  );
  for (const invalid of [
    '',
    lockfile.replace('version: link:../cli', 'version: 0.7.1'),
    `${lockfile}\n${lockfile}`,
  ]) {
    assert.throws(() => nativePreviewLockfile(invalid, stableVersion, context), /exact/);
  }
});

test('pnpm frozen offline install accepts the synchronized preview workspace', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'srijika-preview-lockfile-test-'));
  try {
    const version = nativePreviewVersion('0.7.1', context);
    const files = {
      'package.json': JSON.stringify({ private: true, packageManager: 'pnpm@11.18.0' }),
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\nlinkWorkspacePackages: true\n',
      'packages/cli/package.json': JSON.stringify({ name: '@srijika/cli', version }),
      'packages/create-srijika/package.json': JSON.stringify({
        name: 'create-srijika',
        version,
        dependencies: { '@srijika/cli': version },
      }),
    };
    for (const [file, content] of Object.entries(files)) {
      const destination = resolve(temporary, file);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    const lockfile = [
      "lockfileVersion: '9.0'",
      '',
      'settings:',
      '  autoInstallPeers: true',
      '  excludeLinksFromLockfile: false',
      '',
      'importers:',
      '  .: {}',
      '  packages/cli: {}',
      '  packages/create-srijika:',
      '    dependencies:',
      "      '@srijika/cli':",
      '        specifier: 0.7.1',
      '        version: link:../cli',
      '',
    ].join('\n');
    const lockfilePath = resolve(temporary, 'pnpm-lock.yaml');
    await writeFile(lockfilePath, lockfile);
    const install = () =>
      spawnSync('pnpm', ['install', '--frozen-lockfile', '--offline', '--ignore-scripts'], {
        cwd: temporary,
        encoding: 'utf8',
        timeout: 30_000,
      });
    const stale = install();
    assert.notEqual(stale.status, 0);
    assert.match(`${stale.stdout}\n${stale.stderr}`, /ERR_PNPM_OUTDATED_LOCKFILE/);
    await writeFile(lockfilePath, nativePreviewLockfile(lockfile, '0.7.1', context));
    const installed = install();
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.equal(
      await readFile(lockfilePath, 'utf8'),
      nativePreviewLockfile(lockfile, '0.7.1', context),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
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
