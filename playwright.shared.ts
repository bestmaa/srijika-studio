import { defineConfig, devices } from '@playwright/test';

export const CURRENT_WEB_E2E_PATTERNS = [
  '**/code-first-*.spec.ts',
  '**/code-first/**/*.spec.ts',
  '**/generated/**/*.spec.ts',
];

export function createPlaywrightConfig(selection: { testMatch?: string[]; testIgnore?: string[] }) {
  const port = Number(process.env['SRIJIKA_E2E_PORT'] ?? 4173);
  const baseURL = `http://127.0.0.1:${port}`;

  return defineConfig({
    testDir: './tests/e2e',
    ...selection,
    outputDir: './test-results/playwright',
    fullyParallel: true,
    forbidOnly: Boolean(process.env['CI']),
    retries: process.env['CI'] ? 1 : 0,
    ...(process.env['CI'] ? { workers: 2 } : {}),
    reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    expect: {
      timeout: 5_000,
      toHaveScreenshot: {
        animations: 'disabled',
        maxDiffPixelRatio: 0.001,
      },
    },
    use: {
      baseURL,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'dark',
      contextOptions: {
        reducedMotion: 'reduce',
      },
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    },
    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1440, height: 900 },
        },
      },
    ],
    webServer: {
      command: `pnpm --filter @srijika/studio dev --host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  });
}
