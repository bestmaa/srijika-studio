export function assertNativePreviewContext(environment) {
  const expected = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'bestmaa/srijika-studio',
    GITHUB_WORKFLOW: 'Release npm packages',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) {
      throw new Error(`Native previews require ${name}=${value}.`);
    }
  }
  for (const name of ['GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT']) {
    if (!/^[1-9]\d*$/.test(environment[name] ?? '')) {
      throw new Error(`Native previews require a positive ${name}.`);
    }
  }
}

export function nativePreviewVersion(stableVersion, environment) {
  assertNativePreviewContext(environment);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(stableVersion)) {
    throw new Error('Prepare a Native preview from a stable coordinated release.');
  }
  const [major, minor, patch] = stableVersion.split('.');
  const nextPatch = Number(patch) + 1;
  if (!Number.isSafeInteger(nextPatch)) throw new Error('Native patch version is too large.');
  return `${major}.${minor}.${nextPatch}-preview.${environment.GITHUB_RUN_NUMBER}.${environment.GITHUB_RUN_ATTEMPT}`;
}

export function nativePreviewLockfile(source, stableVersion, environment) {
  const version = nativePreviewVersion(stableVersion, environment);
  const importer = [
    '  packages/create-srijika:',
    '    dependencies:',
    "      '@srijika/cli':",
    `        specifier: ${stableVersion}`,
    '        version: link:../cli',
    '',
  ].join('\n');
  if (source.split(importer).length !== 2) {
    throw new Error('Native preview needs one exact create-srijika workspace lockfile entry.');
  }
  return source.replace(
    importer,
    importer.replace(`specifier: ${stableVersion}`, `specifier: ${version}`),
  );
}

export function assertNativePreviewPackage(manifest, environment) {
  assertNativePreviewContext(environment);
  const suffix = `-preview.${environment.GITHUB_RUN_NUMBER}.${environment.GITHUB_RUN_ATTEMPT}`;
  if (
    manifest.name !== '@srijika/native' ||
    manifest.version !== environment.SRIJIKA_NATIVE_PREVIEW_VERSION ||
    !/^\d+\.\d+\.\d+-preview\.\d+\.\d+$/.test(manifest.version ?? '') ||
    !manifest.version.endsWith(suffix)
  ) {
    throw new Error('Native preview publishing requires the prepared Native prerelease.');
  }
}
