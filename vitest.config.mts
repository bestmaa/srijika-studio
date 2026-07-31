import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const source = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const aliases = {
  '@sutra/contracts': source('./packages/contracts/src/index.ts'),
  '@sutra/document-engine': source('./packages/document-engine/src/index.ts'),
  '@sutra/component-registry': source('./packages/component-registry/src/index.ts'),
  '@sutra/core-components': source('./packages/core-components/src/index.tsx'),
  '@sutra/react-renderer': source('./packages/react-renderer/src/index.tsx'),
  '@sutra/react-codegen': source('./packages/react-codegen/src/index.ts'),
};

const sharedProjectConfig = {
  globals: false,
  clearMocks: true,
  mockReset: true,
  restoreMocks: true,
  passWithNoTests: false,
  testTimeout: 5_000,
} as const;

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias: aliases },
        test: {
          ...sharedProjectConfig,
          name: 'contracts',
          environment: 'node',
          include: ['tests/contracts/**/*.contract.test.ts'],
        },
      },
      {
        extends: true,
        resolve: { alias: aliases },
        test: {
          ...sharedProjectConfig,
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.unit.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        resolve: { alias: aliases },
        test: {
          ...sharedProjectConfig,
          name: 'integration',
          environment: 'jsdom',
          environmentOptions: {
            jsdom: {
              url: 'http://localhost/',
            },
          },
          include: ['tests/integration/**/*.integration.test.{ts,tsx}'],
          setupFiles: ['./tests/setup/vitest.integration.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // The V8 report covers the framework packages exercised in this process.
      // The Studio shell is covered by Playwright, visual, and Axe browser gates;
      // counting it here without browser coverage would under-report executed UI paths.
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/index.ts', '**/index.tsx', '**/*.config.{ts,tsx}'],
      thresholds: {
        lines: 75,
        functions: 75,
        statements: 75,
        branches: 60,
      },
    },
  },
});
