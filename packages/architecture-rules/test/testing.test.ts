import { describe, expect, it } from 'vitest';

import {
  affectedSrijikaTestPlan,
  buildSrijikaTestContract,
  SRIJIKA_TEST_CONTRACT_VERSION,
  type SrijikaArchitectureSourceFile,
} from '../src';

function source(fileName: string, contents = 'export {};'): SrijikaArchitectureSourceFile {
  return { fileName, source: contents };
}

const ownerGraphFiles = [
  source('src/styles/theme.ts', 'export const accent = "violet";'),
  source(
    'src/shared/ui/action-button/ActionButton.ui.tsx',
    `
      import { accent } from '../../../styles/theme';
      export function ActionButtonUI() {
        return <button data-accent={accent}>Continue</button>;
      }
    `,
  ),
  source(
    'src/features/home/slots/navigation/Navigation.ui.tsx',
    `
      import { ActionButtonUI } from '@/shared/ui/action-button/ActionButton.ui';
      export function NavigationUI() { return <ActionButtonUI />; }
    `,
  ),
  source(
    'src/features/home/slots/navigation/Navigation.connector.tsx',
    `
      import { NavigationUI } from './Navigation.ui';
      export function NavigationConnector() { return <NavigationUI />; }
    `,
  ),
  source('src/features/home/Home.ui.tsx', 'export function HomeUI() { return <main>Home</main>; }'),
  source('src/features/home/home.types.ts', 'export interface HomeCopy { title: string }'),
  source(
    'src/features/home/Home.connector.tsx',
    `
      import type { HomeCopy } from './home.types';
      import { NavigationConnector } from './slots/navigation/Navigation.connector';
      export function HomeConnector(props: HomeCopy) {
        return <><NavigationConnector />{props.title}</>;
      }
    `,
  ),
  source(
    'src/features/home/slots/navigation/parts/search-box/SearchBox.ui.tsx',
    'export function SearchBoxUI() { return <input aria-label="Search" />; }',
  ),
  source(
    'src/features/home/slots/navigation/parts/search-box/SearchBox.connector.tsx',
    `
      import { SearchBoxUI } from './SearchBox.ui';
      export function SearchBoxConnector() { return <SearchBoxUI />; }
    `,
  ),
  source(
    'src/shared/capabilities/auth/useAuth.ts',
    'export function useAuth() { return { signedIn: false }; }',
  ),
  source(
    'src/shared/capabilities/auth/auth.api.ts',
    'export async function signIn() { return true; }',
  ),
] as const;

const options = { aliases: { '@/': 'src/' } } as const;

describe('framework-neutral Srijika test contract', () => {
  it('turns every visual Feature, Slot, Part, and Shared owner into browser evidence requirements', () => {
    const contract = buildSrijikaTestContract(ownerGraphFiles, options);

    expect(contract.version).toBe(SRIJIKA_TEST_CONTRACT_VERSION);
    expect(contract.owners.map(({ id }) => id)).toEqual([
      'feature:home',
      'part:home/navigation/search-box',
      'shared-capability:auth',
      'shared-ui:action-button',
      'slot:home/navigation',
    ]);
    for (const ownerId of [
      'feature:home',
      'part:home/navigation/search-box',
      'shared-ui:action-button',
      'slot:home/navigation',
    ]) {
      const owner = contract.owners.find(({ id }) => id === ownerId);
      expect(owner?.requirements.map(({ layer }) => layer)).toEqual([
        'architecture',
        'typecheck',
        'component',
        'browser',
        'visual',
        'accessibility',
      ]);
      expect(owner?.requirements.filter(({ adapter }) => adapter === 'framework')).toHaveLength(4);
    }

    const headless = contract.owners.find(({ id }) => id === 'shared-capability:auth');
    expect(headless?.capabilities).toEqual(['api', 'hook']);
    expect(headless?.requirements.map(({ layer }) => layer)).toEqual([
      'architecture',
      'typecheck',
      'unit',
      'component',
    ]);
    expect(headless?.requirements.map(({ layer }) => layer)).not.toContain('browser');
  });

  it('builds runtime and type file edges and expands a change through every transitive consumer', () => {
    const contract = buildSrijikaTestContract(ownerGraphFiles, options);
    expect(
      contract.fileDependencies.find(
        ({ fromFile, toFile }) =>
          fromFile === 'src/features/home/Home.connector.tsx' &&
          toFile === 'src/features/home/home.types.ts',
      ),
    ).toMatchObject({
      kind: 'type',
      fromOwnerId: 'feature:home',
      toOwnerId: 'feature:home',
    });

    const affected = affectedSrijikaTestPlan(contract, ['src/styles/theme.ts']);
    expect(affected.directOwnerIds).toEqual([]);
    expect(affected.affectedOwnerIds).toEqual([
      'feature:home',
      'shared-ui:action-button',
      'slot:home/navigation',
    ]);
    expect(affected.affectedFiles).toEqual([
      'src/features/home/Home.connector.tsx',
      'src/features/home/slots/navigation/Navigation.connector.tsx',
      'src/features/home/slots/navigation/Navigation.ui.tsx',
      'src/shared/ui/action-button/ActionButton.ui.tsx',
      'src/styles/theme.ts',
    ]);
    expect(affected.requirementIds).toContain('slot:home/navigation:browser');
    expect(affected.requirementIds).not.toContain('part:home/navigation/search-box:browser');
  });

  it('is deterministic across input ordering and honors custom architecture roots', () => {
    const defaultContract = buildSrijikaTestContract(ownerGraphFiles, options);
    expect(buildSrijikaTestContract([...ownerGraphFiles].reverse(), options)).toEqual(
      defaultContract,
    );

    const custom = buildSrijikaTestContract(
      [
        source(
          'app/modules/catalog/regions/summary/Summary.ui.tsx',
          'export function SummaryUI() { return <section />; }',
        ),
        source(
          'app/modules/catalog/regions/summary/Summary.connector.tsx',
          `import { SummaryUI } from './Summary.ui'; export const SummaryConnector = SummaryUI;`,
        ),
      ],
      {
        architecture: {
          profile: 'feature-slot-part-v1',
          featuresRoot: 'app/modules',
          slotsDirectory: 'regions',
        },
      },
    );
    expect(custom.owners).toHaveLength(1);
    expect(custom.owners[0]).toMatchObject({
      id: 'slot:catalog/summary',
      ownerPath: 'app/modules/catalog/regions/summary',
      capabilities: ['connector', 'ui'],
    });
  });
});
