import { beforeEach, describe, expect, it } from 'vitest';

import {
  createSrijikaProjectFileMap,
  createSrijikaUiSourcePair,
} from '@srijika/project-scaffold/templates';

import { compileCodeProjectSource } from '../../apps/studio/src/store/code-project-store';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

describe('starter and active Studio compatibility', () => {
  beforeEach(() => useStudioStore.getState().resetProject());

  it('publishes the configured starter entry through the semantic Studio boundary', () => {
    const files = createSrijikaProjectFileMap();
    const config = JSON.parse(files['srijika.config.json'] ?? '{}') as { entry?: unknown };
    const entry = String(config.entry);
    const source = files[entry];
    if (!source) throw new Error(`Starter entry ${entry} is missing`);

    const result = compileCodeProjectSource({ fileName: entry, source });

    expect({ result, notice: useStudioStore.getState().notice }).toMatchObject({
      result: { compileStatus: 'valid', previewStale: false },
      notice: null,
    });
  });

  it.each([
    ['page', 'AccountPage'],
    ['component', 'ProfileCard'],
  ] as const)('publishes a newly scaffolded %s UI immediately', (kind, componentName) => {
    const pair = createSrijikaUiSourcePair({ kind, componentName });

    const result = compileCodeProjectSource({
      fileName: pair.uiFileName,
      source: pair.uiSource,
    });

    expect({ result, notice: useStudioStore.getState().notice }).toMatchObject({
      result: { compileStatus: 'valid', previewStale: false, diagnostics: [] },
      notice: null,
    });
  });
});
