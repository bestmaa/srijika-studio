import { describe, expect, it } from 'vitest';

import {
  parseSrijikaProjectConfig,
  planSrijikaBrownfieldAdoption,
  type SrijikaArchitectureSourceFile,
} from '../src';

function adoptionConfig(adoptedOwners: readonly string[] = ['src/features/auth']) {
  return parseSrijikaProjectConfig(
    JSON.stringify({
      sourceOfTruth: 'tsx',
      entry: 'src/features/auth/Auth.ui.tsx',
      adoption: {
        ownership: {
          version: 1,
          profile: 'brownfield-ownership-v1',
          managedRoots: ['src'],
          include: ['src/features'],
          exclude: [
            { path: 'src/features/catalog/server', category: 'server' },
            { path: 'src/features/catalog/services', category: 'service' },
            { path: 'src/features/catalog/domain', category: 'domain' },
            { path: 'src/features/catalog/tests', category: 'test' },
          ],
          adoptedOwners,
          directories: { ui: ['ui'], connectors: ['connectors'], hooks: ['hooks'] },
        },
      },
    }),
  ).adoption!;
}

function source(fileName: string, contents = 'export {};'): SrijikaArchitectureSourceFile {
  return { fileName, source: contents };
}

describe('brownfield ownership adoption planning', () => {
  it('reports honest coverage and deterministic no-write moves and rewires', () => {
    const plan = planSrijikaBrownfieldAdoption(
      [
        source(
          'src/app/catalog-page.tsx',
          "import { ProductCardUI } from '../features/catalog/ui/ProductCard.ui'; void ProductCardUI;",
        ),
        source(
          'src/features/auth/ui/Login.ui.tsx',
          "import { connect } from '../connectors/Login.connector'; export { connect };",
        ),
        source('src/features/auth/connectors/Login.connector.tsx'),
        source('src/features/catalog/ui/ProductCard.ui.tsx'),
        source('src/features/catalog/checkout/ui/Payment.ui.tsx'),
        source('src/features/catalog/checkout/connectors/Payment.connector.tsx'),
        source('src/features/catalog/hooks/useCatalog.ts'),
        source('src/features/catalog/server/load-products.ts'),
        source('src/features/catalog/services/catalog-service.ts'),
        source('src/features/catalog/domain/product.ts'),
        source('src/features/catalog/tests/product.test.ts'),
        source('src/features/catalog/catalog-source.ts'),
      ],
      adoptionConfig(),
    );

    expect(plan.status).toBe('blocked');
    expect(plan.summary).toEqual({
      files: 11,
      governed: 0,
      pending: 5,
      blocked: 2,
      excluded: 4,
      adoptedOwners: 1,
      fullProjectSuccess: false,
    });
    expect(plan.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'src/features/auth/connectors/Login.connector.tsx',
        toRelativePath: 'src/features/auth/slots/login/Login.connector.tsx',
        status: 'ready',
      }),
      expect.objectContaining({
        fromRelativePath: 'src/features/auth/ui/Login.ui.tsx',
        toRelativePath: 'src/features/auth/slots/login/Login.ui.tsx',
        status: 'ready',
      }),
      expect.objectContaining({
        fromRelativePath: 'src/features/catalog/checkout/connectors/Payment.connector.tsx',
        toRelativePath: 'src/features/catalog/slots/checkout/parts/payment/Payment.connector.tsx',
        status: 'ready',
      }),
      expect.objectContaining({
        fromRelativePath: 'src/features/catalog/checkout/ui/Payment.ui.tsx',
        toRelativePath: 'src/features/catalog/slots/checkout/parts/payment/Payment.ui.tsx',
        status: 'ready',
      }),
      expect.objectContaining({
        fromRelativePath: 'src/features/catalog/ui/ProductCard.ui.tsx',
        toRelativePath: 'src/features/catalog/slots/product-card/ProductCard.ui.tsx',
        status: 'ready',
      }),
    ]);
    expect(plan.rewires).toEqual([
      {
        relativePath: 'src/app/catalog-page.tsx',
        sourceAfterMove: 'src/app/catalog-page.tsx',
        importedSourcePath: 'src/features/catalog/ui/ProductCard.ui.tsx',
        importedTargetPath: 'src/features/catalog/slots/product-card/ProductCard.ui.tsx',
        fromSpecifier: '../features/catalog/ui/ProductCard.ui',
        toSpecifier: '../features/catalog/slots/product-card/ProductCard.ui',
      },
      {
        relativePath: 'src/features/auth/ui/Login.ui.tsx',
        sourceAfterMove: 'src/features/auth/slots/login/Login.ui.tsx',
        importedSourcePath: 'src/features/auth/connectors/Login.connector.tsx',
        importedTargetPath: 'src/features/auth/slots/login/Login.connector.tsx',
        fromSpecifier: '../connectors/Login.connector',
        toSpecifier: './Login.connector',
      },
    ]);
    expect(plan.coverage.filter(({ status }) => status === 'excluded')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'server' }),
        expect.objectContaining({ category: 'service' }),
        expect.objectContaining({ category: 'domain' }),
        expect.objectContaining({ category: 'test' }),
      ]),
    );
    expect(plan.strictFiles).toEqual([
      'src/features/auth/connectors/Login.connector.tsx',
      'src/features/auth/ui/Login.ui.tsx',
    ]);
  });

  it('strictly governs only canonical files inside an adopted owner', () => {
    const plan = planSrijikaBrownfieldAdoption(
      [
        source('src/features/auth/Auth.ui.tsx'),
        source('src/features/auth/Auth.connector.tsx'),
        source('src/features/auth/slots/login/parts/form/Form.ui.tsx'),
        source('src/features/auth/slots/login/parts/form/Form.connector.tsx'),
        source('src/features/catalog/Catalog.ui.tsx'),
      ],
      adoptionConfig(),
    );

    expect(plan.status).toBe('partial');
    expect(plan.summary).toMatchObject({ governed: 4, pending: 1, blocked: 0 });
    expect(plan.strictFiles).toEqual([
      'src/features/auth/Auth.connector.tsx',
      'src/features/auth/Auth.ui.tsx',
      'src/features/auth/slots/login/parts/form/Form.connector.tsx',
      'src/features/auth/slots/login/parts/form/Form.ui.tsx',
    ]);
  });

  it('blocks collisions and never proposes an overwrite', () => {
    const plan = planSrijikaBrownfieldAdoption(
      [
        source('src/features/auth/ui/Login.ui.tsx'),
        source('src/features/auth/slots/login/Login.ui.tsx'),
      ],
      adoptionConfig(),
    );

    expect(plan.status).toBe('blocked');
    expect(plan.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'src/features/auth/ui/Login.ui.tsx',
        status: 'blocked',
      }),
    ]);
    expect(plan.moves[0]?.reason).toContain('will not be overwritten');
    expect(plan.rewires).toEqual([]);
  });

  it('is deterministic regardless of source discovery order', () => {
    const files = [
      source('src/features/catalog/ui/ProductCard.ui.tsx'),
      source('src/features/auth/Auth.ui.tsx'),
      source('src/features/catalog/hooks/useCatalog.ts'),
    ];
    const forward = planSrijikaBrownfieldAdoption(files, adoptionConfig());
    const reverse = planSrijikaBrownfieldAdoption([...files].reverse(), adoptionConfig());

    expect(reverse).toEqual(forward);
  });
});
