import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/coverage/**',
      '**/target/**',
      '**/release-bundles/**',
      '**/src-tauri/gen/**',
      'crates/studio-core/assets/live-preview-bridge.ts',
      '**/node_modules/**',
      '.srijika/**',
      'playwright-report/**',
      'test-results/**',
      'tests/e2e/**/*.mjs',
      'packages/mcp-server/scripts/**',
      'plugins/srijika-studio/mcp-server/**',
      'plugins/srijika-studio/scripts/**',
      'eslint.config.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  { files: ['**/*.config.{ts,mts}'], rules: { '@typescript-eslint/no-unsafe-assignment': 'off' } },
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
