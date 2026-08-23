import { buildSrijikaTestContract } from '@srijika/architecture-rules';
import { describe, expect, it } from 'vitest';

import { buildSrijikaTestEvidenceManifest, buildSrijikaViteTestAdapterPlan } from '../src';

describe('Srijika owner evidence and repair scope', () => {
  it('fails closed without reports and maps a browser failure to only its owner files', () => {
    const contract = buildSrijikaTestContract([
      {
        fileName: 'src/features/home/Home.ui.tsx',
        source: 'export function HomeUI() { return <main>Home</main>; }',
      },
      {
        fileName: 'src/features/home/Home.connector.tsx',
        source:
          "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }",
      },
    ]);
    const adapter = buildSrijikaViteTestAdapterPlan(contract);
    expect(buildSrijikaTestEvidenceManifest(contract, adapter).status).toBe('not-run');

    const manifest = buildSrijikaTestEvidenceManifest(contract, adapter, {
      architecturePassed: true,
      typecheckPassed: true,
      vitest: {
        testResults: [
          {
            name: '/project/tests/srijika/owners/feature--home.component.test.tsx',
            status: 'passed',
          },
        ],
      },
      playwright: {
        suites: [
          {
            specs: [
              {
                file: 'feature--home.spec.ts',
                tests: [{ results: [{ status: 'failed', message: 'visual mismatch' }] }],
              },
            ],
          },
        ],
      },
    });
    expect(manifest.status).toBe('failed');
    expect(manifest.owners[0]?.repair).toMatchObject({
      allowedSourceFiles: ['src/features/home/Home.connector.tsx', 'src/features/home/Home.ui.tsx'],
      failingArtifacts: ['tests/srijika/owners/feature--home.spec.ts'],
      failureMessages: ['visual mismatch'],
    });
  });
});
