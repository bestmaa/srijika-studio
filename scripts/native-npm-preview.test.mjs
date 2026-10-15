import assert from 'node:assert/strict';
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
