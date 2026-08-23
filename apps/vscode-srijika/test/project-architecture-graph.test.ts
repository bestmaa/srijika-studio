import { describe, expect, it } from 'vitest';

import {
  resolveSrijikaArchitectureConfig,
  type SrijikaArchitectureDiagnostic,
} from '@srijika/architecture-rules';

import { buildSrijikaProjectArchitectureGraph } from '../src/project-architecture-graph';
import { renderSrijikaProjectArchitectureWebview } from '../src/project-architecture-webview';

const root = '/workspace/product';
const architecture = resolveSrijikaArchitectureConfig();

const files = [
  {
    fileName: `${root}/src/features/home/home.ui.tsx`,
    source: "import { useHome } from './home.connector'; export function HomeUi() { return null; }",
  },
  {
    fileName: `${root}/src/features/home/home.connector.tsx`,
    source:
      "import { useProfile } from './hooks/useProfile'; import { useCartStore } from '@/shared/capabilities/cart/cart.store'; export const useHome = () => ({ useProfile, useCartStore });",
  },
  {
    fileName: `${root}/src/features/home/hooks/useProfile.ts`,
    source: "export function useProfile() { return 'profile'; }",
  },
  {
    fileName: `${root}/src/features/home/slots/hero/hero.ui.tsx`,
    source: 'export const HeroUi = () => null;',
  },
  {
    fileName: `${root}/src/shared/capabilities/cart/cart.store.ts`,
    source: "export const useCartStore = () => 'cart';",
  },
] as const;

function violation(): SrijikaArchitectureDiagnostic {
  return {
    code: 'SRIJIKA4118',
    ruleId: 'SRIJIKA-ARCH-LAYER-JUMP',
    severity: 'error',
    fileName: `${root}/src/features/home/home.ui.tsx`,
    targetFileName: `${root}/src/features/home/home.connector.tsx`,
    span: { start: 0, end: 6, line: 0, column: 0 },
    message: 'Home UI imports runtime behavior directly.',
    guidance: 'Keep UI props-only and route behavior through its allowed boundary.',
  };
}

describe('current project architecture graph', () => {
  it('builds App → Feature → Slot/File ownership and exact import directions', () => {
    const graph = buildSrijikaProjectArchitectureGraph({
      projectName: '@example/product',
      projectRoot: root,
      entry: 'src/features/home/home.ui.tsx',
      architecture,
      aliases: { '@/': 'src/' },
      files,
      diagnostics: [violation()],
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'app', label: '@example/product' }),
        expect.objectContaining({ id: 'owner:feature:home', ownerKind: 'feature' }),
        expect.objectContaining({ id: 'owner:slot:home/hero', parentId: 'owner:feature:home' }),
        expect.objectContaining({
          id: 'file:src/features/home/home.connector.tsx',
          capability: 'connector',
          ownerId: 'owner:feature:home',
          exports: ['useHome'],
        }),
        expect.objectContaining({
          id: 'file:src/features/home/hooks/useProfile.ts',
          capability: 'hook',
        }),
        expect.objectContaining({
          id: 'file:src/shared/capabilities/cart/cart.store.ts',
          capability: 'store',
          ownerKind: 'shared-capability',
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'file:src/features/home/home.ui.tsx',
          target: 'file:src/features/home/home.connector.tsx',
          kind: 'forbidden',
        }),
        expect.objectContaining({
          source: 'file:src/features/home/home.connector.tsx',
          target: 'file:src/features/home/hooks/useProfile.ts',
          kind: 'same-owner',
        }),
        expect.objectContaining({
          source: 'file:src/features/home/home.connector.tsx',
          target: 'file:src/shared/capabilities/cart/cart.store.ts',
          kind: 'shared',
        }),
      ]),
    );
    expect(graph.violations[0]).toMatchObject({
      ruleId: 'SRIJIKA-ARCH-LAYER-JUMP',
    });
    expect(graph.violations[0]?.nodeIds).toEqual(
      expect.arrayContaining([
        'file:src/features/home/home.ui.tsx',
        'file:src/features/home/home.connector.tsx',
      ]),
    );
    expect(graph.stats).toMatchObject({ owners: 3, files: 5, imports: 3, violations: 1 });
  });

  it('records packages, unresolved local imports, re-exports, and escaped HTML safely', () => {
    const graph = buildSrijikaProjectArchitectureGraph({
      projectName: '<unsafe>',
      projectRoot: root,
      entry: 'src/features/home/home.ui.tsx',
      architecture,
      files: [
        {
          fileName: `${root}/src/features/home/home.ui.tsx`,
          source:
            "import React from 'react'; import './missing'; export { thing } from './missing-too'; export default function Home() { return null; }",
        },
      ],
      diagnostics: [],
    });
    const file = graph.nodes.find(({ kind }) => kind === 'file');
    expect(file?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: 'react', kind: 'package', packageName: 'react' }),
        expect.objectContaining({ specifier: './missing', kind: 'unresolved' }),
        expect.objectContaining({ specifier: './missing-too', kind: 'unresolved' }),
      ]),
    );
    expect(file?.exports).toEqual(['default', 'thing']);
    expect(graph.stats).toMatchObject({ packages: 1, unresolvedImports: 2 });

    const html = renderSrijikaProjectArchitectureWebview({ nonce: 'test-nonce', graph });
    expect(html).toContain('Structure Graph');
    expect(html).toContain('Switch project');
    expect(html).toContain('current workspace ownership and import graph');
    expect(html).not.toContain('<unsafe>');
    expect(html).toContain('\\u003cunsafe>');
  });
});
