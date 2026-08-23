import { describe, expect, it } from 'vitest';

import type {
  CollectSrijikaTestEvidenceResult,
  SynchronizeSrijikaViteTestsResult,
} from '@srijika/developer-engine';

import { formatSrijikaTestEvidence, summarizeSrijikaTestSync } from '../src/testing-presentation';

describe('VS Code owner-test presentation', () => {
  it('summarizes synchronized files, required commands, and dependencies', () => {
    const result = {
      contract: { owners: [{ id: 'feature:Home' }] },
      adapter: {
        framework: 'vite',
        artifacts: [{ relativePath: 'tests/srijika/home.test.ts' }],
        scripts: { 'test:srijika': 'vitest run' },
        devDependencies: [{ name: 'vitest', version: '4.1.10' }],
      },
      write: { created: ['a'], updated: ['b'], unchanged: ['c'], preserved: ['fixture'] },
    } as unknown as SynchronizeSrijikaViteTestsResult;

    expect(summarizeSrijikaTestSync(result)).toEqual({
      framework: 'vite',
      owners: 1,
      artifacts: 1,
      created: 1,
      updated: 1,
      unchanged: 1,
      preserved: 1,
      packageScriptsAdded: 0,
      packageDependenciesAdded: 0,
      commands: ['test:srijika: vitest run'],
      dependencies: ['vitest@4.1.10'],
    });
  });

  it('keeps missing gates visible instead of presenting false-green evidence', () => {
    const result = {
      reportFiles: { vitestJson: 'vitest.json', playwrightJson: 'playwright.json' },
      manifest: {
        framework: 'next-app-router',
        status: 'not-run',
        owners: [
          {
            ownerId: 'feature:Home',
            status: 'not-run',
            requirements: [
              { requirementId: 'feature:Home:architecture', status: 'not-run' },
              { requirementId: 'feature:Home:typecheck', status: 'not-run' },
            ],
          },
        ],
      },
    } as unknown as CollectSrijikaTestEvidenceResult;

    expect(formatSrijikaTestEvidence(result)).toEqual(
      expect.arrayContaining([
        'Overall: not-run',
        '· feature:Home: not-run',
        '  - feature:Home:architecture: not-run',
        '  - feature:Home:typecheck: not-run',
      ]),
    );
  });
});
